const CACHE_MS = 15_000;
let cache = { at: 0, prices: null };

// Optional: CoinGecko's fully keyless public endpoint still works, but is
// now heavily rate-limited — enough that back-to-back Home + Chart screen
// loads can trip it. A free Demo key (coingecko.com/en/developers/dashboard)
// raises that ceiling a lot and costs nothing. Entirely optional: every
// call below still works keyless, just with a lower rate-limit budget.
// EXPO_PUBLIC_COINGECKO_API_KEY=your-demo-key-here
const COINGECKO_API_KEY = process.env.EXPO_PUBLIC_COINGECKO_API_KEY || "";
const COINGECKO_HEADERS = COINGECKO_API_KEY ? { "x-cg-demo-api-key": COINGECKO_API_KEY } : {};

// Plain fetch() has no timeout — on a bad connection it can hang far
// longer than a user will wait, leaving the UI stuck on a spinner instead
// of surfacing "no data" with a retry. Cap every CoinGecko call.
const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: COINGECKO_HEADERS, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * BTC price in a few currencies via CoinGecko's public, keyless endpoint.
 * Cached briefly so multiple screens polling in parallel (Home, Chart)
 * dedupe onto one network call instead of each firing their own.
 */
export async function fetchBtcPrices() {
  if (cache.prices && Date.now() - cache.at < CACHE_MS) {
    return cache.prices;
  }
  try {
    const res = await fetchWithTimeout(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,ngn,eur,gbp"
    );
    if (!res.ok) throw new Error(`simple/price ${res.status}`);
    const data = await res.json();
    cache = { at: Date.now(), prices: data.bitcoin };
    return data.bitcoin;
  } catch (e) {
    return cache.prices || null; // stale-but-usable fallback, or null if never fetched
  }
}

let ethCache = { at: 0, prices: null };

/**
 * ETH price in a few currencies — same shape/caching as fetchBtcPrices,
 * kept as a separate cache since it's a different CoinGecko id/response.
 * REST-only (no WS stream for ETH, unlike BTC's Binance socket), so the
 * Market tab shows this without a "Live" badge.
 */
export async function fetchEthPrices() {
  if (ethCache.prices && Date.now() - ethCache.at < CACHE_MS) {
    return ethCache.prices;
  }
  try {
    const res = await fetchWithTimeout(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,ngn,eur,gbp"
    );
    if (!res.ok) throw new Error(`simple/price ${res.status}`);
    const data = await res.json();
    ethCache = { at: Date.now(), prices: data.ethereum };
    return data.ethereum;
  } catch (e) {
    return ethCache.prices || null;
  }
}

export function satsToFiat(sats, btcPrice) {
  if (!btcPrice) return null;
  return (sats / 100_000_000) * btcPrice;
}

export function formatFiat(amount, currency = "usd") {
  if (amount == null) return "—";
  const symbols = { usd: "$", ngn: "₦", eur: "€", gbp: "£" };
  return `${symbols[currency] || ""}${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Historical data for the price chart (candles, line series, volume).
// Two CoinGecko endpoints are used because they serve different shapes:
//  - /ohlc gives true open/high/low/close candles, but no volume
//  - /market_chart gives volume (and a denser price series for the line view)
// Each timeframe is cached separately since they're fetched independently
// when the user switches tabs.
// ---------------------------------------------------------------------------

const OHLC_CACHE_MS = 15_000;
const ohlcCache = new Map(); // key: `${days}-${currency}` -> { at, candles }

const MARKET_CHART_CACHE_MS = 15_000;
const marketChartCache = new Map(); // key: `${days}-${currency}` -> { at, points, volumes }

/**
 * CoinGecko's /ohlc endpoint snaps `days` to one of these buckets and picks
 * a candle granularity accordingly (their rule, not configurable):
 * 1 -> 30min candles, 7/14 -> 4h candles, 30/90/180 -> 4day/daily buckets.
 * We expose a curated set of timeframes that map cleanly onto that.
 */
export const CHART_RANGES = [
  { label: "1D", days: 1 },
  { label: "7D", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
];

/**
 * Fetch OHLC candles for BTC. Returns an array of
 * { time (ms), open, high, low, close }, sorted ascending by time.
 */
export async function fetchBtcOhlc(days = 1, currency = "usd") {
  const key = `${days}-${currency}`;
  const cached = ohlcCache.get(key);
  if (cached && Date.now() - cached.at < OHLC_CACHE_MS) {
    return cached.candles;
  }
  try {
    const res = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=${currency}&days=${days}`
    );
    if (!res.ok) throw new Error(`ohlc ${res.status}`);
    const raw = await res.json();
    const candles = raw
      .map(([time, open, high, low, close]) => ({ time, open, high, low, close }))
      .sort((a, b) => a.time - b.time);
    ohlcCache.set(key, { at: Date.now(), candles });
    return candles;
  } catch (e) {
    return cached?.candles || [];
  }
}

/**
 * Fetch a denser price + volume series (used for the line/area chart mode
 * and for the volume histogram under the candles). Returns
 * { points: [{ time, price }], volumes: [{ time, volume }] }.
 */
export async function fetchBtcMarketChart(days = 1, currency = "usd") {
  const key = `${days}-${currency}`;
  const cached = marketChartCache.get(key);
  if (cached && Date.now() - cached.at < MARKET_CHART_CACHE_MS) {
    return cached;
  }
  try {
    const res = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=${currency}&days=${days}`
    );
    if (!res.ok) throw new Error(`market_chart ${res.status}`);
    const raw = await res.json();
    const points = (raw.prices || []).map(([time, price]) => ({ time, price }));
    const volumes = (raw.total_volumes || []).map(([time, volume]) => ({ time, volume }));
    const result = { at: Date.now(), points, volumes };
    marketChartCache.set(key, result);
    return result;
  } catch (e) {
    return cached || { points: [], volumes: [] };
  }
}

/**
 * Simple moving average over closing prices. Returns an array the same
 * length as `candles`, with `null` for indices before the window fills.
 */
export function sma(candles, period) {
  const out = new Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential moving average over closing prices, seeded with the SMA of
 * the first `period` closes (standard EMA convention). `null` before the
 * window fills, same shape as `sma()`.
 */
export function ema(candles, period) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += candles[i].close;
  seed /= period;
  out[period - 1] = seed;
  let prev = seed;
  for (let i = period; i < candles.length; i++) {
    const next = candles[i].close * k + prev * (1 - k);
    out[i] = next;
    prev = next;
  }
  return out;
}
