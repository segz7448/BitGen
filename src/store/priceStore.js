import { useCallback } from "react";
import { createStore, useStoreSlice } from "./pubsubStore";
import { connectPriceSocket } from "../network/priceSocket";
import { fetchBtcPrices, fetchBtcOhlc, fetchBtcMarketChart } from "../network/priceFeed";

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
});

let socketHandle = null;
let fxTimer = null;
let usdNgnRatio = null;
let usdEurRatio = null;
let usdGbpRatio = null;
let refCount = 0;

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
    onOpen: () => priceStore.setState({ connection: "open" }),
    onReconnecting: () => priceStore.setState({ connection: "reconnecting" }),
    onClose: () => priceStore.setState({ connection: "closed" }),
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

export function stopPriceStream() {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  socketHandle?.close();
  socketHandle = null;
  if (fxTimer) {
    clearInterval(fxTimer);
    fxTimer = null;
  }
  priceStore.setState({ connection: "idle" });
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
