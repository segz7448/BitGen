import { useCallback } from "react";
import { createStore, useStoreSlice } from "./pubsubStore";
import { connectPriceSocket, ETH_STREAM_URL } from "../network/priceSocket";
import { fetchBtcPrices, fetchBtcOhlc, fetchBtcMarketChart, fetchEthPrices } from "../network/priceFeed";

// FX ratio refresh (usd -> ngn/eur) is genuinely slow-moving compared to
// BTC/USD itself, so it stays on a light REST poll rather than a socket —
// there's no free public WS for fiat cross-rates, and there's no need for
// sub-second precision here anyway.
const FX_REFRESH_MS = 60_000;

export const CHART_RANGES = [
  { label: "1D", days: 1 },
  { label: "7D", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
];

/**
 * connection: "idle" | "connecting" | "open" | "reconnecting" | "closed"
 * ticker:     live BTC/USD (true push) plus derived NGN/EUR (via FX ratio)
 * candles:    per-range OHLC history, keyed by `${days}-usd`, with the
 *             last candle live-patched from the WS trade stream so it
 *             visibly "breathes" between REST refreshes
 * volumes:    per-range volume series, same key shape
 */
export const priceStore = createStore({
  connection: "idle",
  ticker: { usd: null, ngn: null, eur: null, gbp: null, at: 0 },
  candles: {},
  volumes: {},
  // ETH gets its own connection state + ticker, entirely independent of
  // BTC's above — separate Binance stream, separate fallback poll, so
  // one asset's connectivity issues never affect the other's.
  ethConnection: "idle",
  ethTicker: { usd: null, ngn: null, eur: null, gbp: null, at: 0 },
});

let socketHandle = null;
let fxTimer = null;
let usdNgnRatio = null;
let usdEurRatio = null;
let usdGbpRatio = null;
let refCount = 0;
let wsReconnectStreak = 0;
let fallbackTimer = null;
const FALLBACK_AFTER_ATTEMPTS = 3; // ~1s+2s+4s of real retries before giving up on the socket for now
const FALLBACK_POLL_MS = 10_000;

function patchLastCandle(rangeKey, price) {
  const candles = priceStore.getState().candles[rangeKey];
  if (!candles || candles.length === 0) return;
  const last = candles[candles.length - 1];
  const patched = {
    ...last,
    close: price,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
  };
  priceStore.setState({
    candles: { ...priceStore.getState().candles, [rangeKey]: [...candles.slice(0, -1), patched] },
  });
}

async function refreshFxRatios() {
  const prices = await fetchBtcPrices().catch(() => null);
  if (!prices) return;
  if (prices.usd) {
    usdNgnRatio = prices.ngn ? prices.ngn / prices.usd : usdNgnRatio;
    usdEurRatio = prices.eur ? prices.eur / prices.usd : usdEurRatio;
    usdGbpRatio = prices.gbp ? prices.gbp / prices.usd : usdGbpRatio;
  }
  const live = priceStore.getState().ticker.usd ?? prices.usd;
  priceStore.setState({
    ticker: {
      usd: live,
      ngn: usdNgnRatio && live ? live * usdNgnRatio : prices.ngn,
      eur: usdEurRatio && live ? live * usdEurRatio : prices.eur,
      gbp: usdGbpRatio && live ? live * usdGbpRatio : prices.gbp,
      at: Date.now(),
    },
  });
}

/**
 * Load (or reload) OHLC + volume history for one timeframe. Call this
 * when the user switches ranges, or on the light background refresh —
 * NOT on every price tick, since the live socket already keeps the last
 * candle current via patchLastCandle.
 */
export async function loadCandles(days = 1, currency = "usd") {
  const key = `${days}-${currency}`;
  const [candles, market] = await Promise.all([
    fetchBtcOhlc(days, currency),
    fetchBtcMarketChart(days, currency),
  ]);
  priceStore.setState({
    candles: { ...priceStore.getState().candles, [key]: candles },
    volumes: { ...priceStore.getState().volumes, [key]: market.volumes || [] },
  });
  return candles;
}

/**
 * Start the live feed. Reference-counted so multiple screens (Home,
 * Chart) can each call this on focus and call stopPriceStream on blur
 * without stepping on each other — the socket only actually closes once
 * the last interested screen goes away.
 */
export function startPriceStream() {
  refCount++;
  if (socketHandle) return;

  priceStore.setState({ connection: "connecting" });
  refreshFxRatios();
  if (fxTimer) clearInterval(fxTimer);
  fxTimer = setInterval(refreshFxRatios, FX_REFRESH_MS);

  socketHandle = connectPriceSocket({
    onOpen: () => {
      wsReconnectStreak = 0;
      stopFallbackPoll();
      priceStore.setState({ connection: "open" });
    },
    onReconnecting: () => {
      wsReconnectStreak++;
      // A handful of quick retries is normal (a blip, app resuming from
      // background, etc.) — but on some networks Binance's WS endpoint
      // specifically is unreachable (carrier/firewall blocking that one
      // host) while everything else works fine. Rather than leave the
      // price frozen and the UI stuck on "Reconnecting…" forever, fall
      // back to polling the same REST source the FX ratios already use.
      // The socket keeps retrying with backoff in the background; if it
      // ever succeeds, onOpen above stops the fallback poll immediately.
      if (wsReconnectStreak >= FALLBACK_AFTER_ATTEMPTS) {
        startFallbackPoll();
      } else {
        priceStore.setState({ connection: "reconnecting" });
      }
    },
    onClose: () => priceStore.setState({ connection: fallbackTimer ? "polling" : "closed" }),
    onTrade: (price) => {
      const s = priceStore.getState();
      priceStore.setState({ ticker: { ...s.ticker, usd: price, at: Date.now() } });
      if (usdNgnRatio || usdEurRatio || usdGbpRatio) {
        priceStore.setState({
          ticker: {
            usd: price,
            ngn: usdNgnRatio ? price * usdNgnRatio : s.ticker.ngn,
            eur: usdEurRatio ? price * usdEurRatio : s.ticker.eur,
            gbp: usdGbpRatio ? price * usdGbpRatio : s.ticker.gbp,
            at: Date.now(),
          },
        });
      }
      // Live-patch the currently-loaded ranges only — cheap, and the
      // per-range candle patch only notifies components subscribed to
      // that specific range key, not the whole candles slice.
      for (const key of Object.keys(priceStore.getState().candles)) {
        patchLastCandle(key, price);
      }
    },
  });
}

function startFallbackPoll() {
  priceStore.setState({ connection: "polling" });
  if (fallbackTimer) return;
  const tick = async () => {
    const prices = await fetchBtcPrices().catch(() => null);
    if (!prices?.usd) return;
    if (usdNgnRatio || usdEurRatio || usdGbpRatio) {
      priceStore.setState({
        ticker: {
          usd: prices.usd,
          ngn: usdNgnRatio ? prices.usd * usdNgnRatio : prices.ngn,
          eur: usdEurRatio ? prices.usd * usdEurRatio : prices.eur,
          gbp: usdGbpRatio ? prices.usd * usdGbpRatio : prices.gbp,
          at: Date.now(),
        },
      });
    } else {
      priceStore.setState({ ticker: { ...prices, at: Date.now() } });
    }
    for (const key of Object.keys(priceStore.getState().candles)) {
      patchLastCandle(key, prices.usd);
    }
  };
  tick();
  fallbackTimer = setInterval(tick, FALLBACK_POLL_MS);
}

function stopFallbackPoll() {
  if (fallbackTimer) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }
}

export function stopPriceStream() {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  socketHandle?.close();
  socketHandle = null;
  stopFallbackPoll();
  wsReconnectStreak = 0;
  if (fxTimer) {
    clearInterval(fxTimer);
    fxTimer = null;
  }
  priceStore.setState({ connection: "idle" });
}

// ---------------------------------------------------------------------
// ETH — mirrors the BTC stream above (same reconnect-with-fallback
// approach) but fully independent state, socket, and ref count.
// ---------------------------------------------------------------------
let ethSocketHandle = null;
let ethRefCount = 0;
let ethReconnectStreak = 0;
let ethFallbackTimer = null;

export function startEthPriceStream() {
  ethRefCount++;
  if (ethSocketHandle) return;

  priceStore.setState({ ethConnection: "connecting" });

  ethSocketHandle = connectPriceSocket(
    {
      onOpen: () => {
        ethReconnectStreak = 0;
        stopEthFallbackPoll();
        priceStore.setState({ ethConnection: "open" });
      },
      onReconnecting: () => {
        ethReconnectStreak++;
        if (ethReconnectStreak >= FALLBACK_AFTER_ATTEMPTS) {
          startEthFallbackPoll();
        } else {
          priceStore.setState({ ethConnection: "reconnecting" });
        }
      },
      onClose: () => priceStore.setState({ ethConnection: ethFallbackTimer ? "polling" : "closed" }),
      onTrade: (price) => {
        const s = priceStore.getState().ethTicker;
        // Live trade price is USD; keep the other currencies' last-known
        // cross-rate ratio (from the periodic REST fetch below) rather
        // than freezing them until the next poll.
        const ratio = s.usd ? price / s.usd : 1;
        priceStore.setState({
          ethTicker: {
            usd: price,
            ngn: s.ngn ? s.ngn * ratio : s.ngn,
            eur: s.eur ? s.eur * ratio : s.eur,
            gbp: s.gbp ? s.gbp * ratio : s.gbp,
            at: Date.now(),
          },
        });
      },
    },
    ETH_STREAM_URL
  );

  if (ethFxTimer) clearInterval(ethFxTimer);
  refreshEthPrices();
  ethFxTimer = setInterval(refreshEthPrices, FX_REFRESH_MS);
}

let ethFxTimer = null;

async function refreshEthPrices() {
  const prices = await fetchEthPrices().catch(() => null);
  if (!prices) return;
  const live = priceStore.getState().ethTicker.usd ?? prices.usd;
  const ratio = prices.usd ? live / prices.usd : 1;
  priceStore.setState({
    ethTicker: {
      usd: live,
      ngn: prices.ngn ? prices.ngn * ratio : prices.ngn,
      eur: prices.eur ? prices.eur * ratio : prices.eur,
      gbp: prices.gbp ? prices.gbp * ratio : prices.gbp,
      at: Date.now(),
    },
  });
}

function startEthFallbackPoll() {
  priceStore.setState({ ethConnection: "polling" });
  if (ethFallbackTimer) return;
  const tick = async () => {
    const prices = await fetchEthPrices().catch(() => null);
    if (!prices?.usd) return;
    priceStore.setState({ ethTicker: { ...prices, at: Date.now() } });
  };
  tick();
  ethFallbackTimer = setInterval(tick, FALLBACK_POLL_MS);
}

function stopEthFallbackPoll() {
  if (ethFallbackTimer) {
    clearInterval(ethFallbackTimer);
    ethFallbackTimer = null;
  }
}

export function stopEthPriceStream() {
  ethRefCount = Math.max(0, ethRefCount - 1);
  if (ethRefCount > 0) return;
  ethSocketHandle?.close();
  ethSocketHandle = null;
  stopEthFallbackPoll();
  ethReconnectStreak = 0;
  if (ethFxTimer) {
    clearInterval(ethFxTimer);
    ethFxTimer = null;
  }
  priceStore.setState({ ethConnection: "idle" });
}

// ---------------------------------------------------------------------
// Selector hooks — each one subscribes a component to exactly the slice
// it needs, so a tick that only moves `ticker.usd` never re-renders a
// component that only reads `connection`, and vice versa.
// ---------------------------------------------------------------------

export function useConnectionStatus() {
  return useStoreSlice(priceStore, (s) => s.connection);
}

export function useTicker() {
  return useStoreSlice(priceStore, (s) => s.ticker);
}

export function useEthConnectionStatus() {
  return useStoreSlice(priceStore, (s) => s.ethConnection);
}

export function useEthTicker() {
  return useStoreSlice(priceStore, (s) => s.ethTicker);
}

export function useCandles(days, currency = "usd") {
  const key = `${days}-${currency}`;
  return useStoreSlice(
    priceStore,
    useCallback((s) => s.candles[key] || [], [key])
  );
}

export function useVolumes(days, currency = "usd") {
  const key = `${days}-${currency}`;
  return useStoreSlice(
    priceStore,
    useCallback((s) => s.volumes[key] || [], [key])
  );
}
