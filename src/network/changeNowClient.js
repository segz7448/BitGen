const API_BASE = "https://api.changenow.io/v2";

// Free at https://changenow.io/affiliate — required for /exchange and
// /exchange/estimated-amount to work at all past a handful of anonymous
// calls.
//
// Set via an EXPO_PUBLIC_ env var rather than hardcoded here — Expo inlines
// EXPO_PUBLIC_* vars at build time (see babel-preset-expo), and keeping the
// literal out of source avoids GitHub's secret-scanning push protection
// flagging it. Put it in a local, gitignored .env for dev:
//   EXPO_PUBLIC_CHANGENOW_API_KEY=your-key-here
// and in the GitHub Actions workflow it's written from a repo secret
// (see .github/workflows/build-android.yml).
const API_KEY = process.env.EXPO_PUBLIC_CHANGENOW_API_KEY || "";

// ChangeNow's ticker naming for each asset this wallet supports.
const CHANGENOW_TICKER = {
  BTC: "btc",
  USDT_TRC20: "usdttrc20",
  USDT_ERC20: "usdterc20",
  USDT_BEP20: "usdtbsc",
};

async function cnFetch(path, options = {}) {
  if (!API_KEY) {
    throw new Error(
      "No ChangeNow API key set. Get a free one at changenow.io/affiliate and paste it into " +
        "src/network/changeNowClient.js (API_KEY) before swaps will work."
    );
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-changenow-api-key": API_KEY,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `ChangeNow error (${res.status})`);
  return data;
}

function tickerFor(assetId) {
  const t = CHANGENOW_TICKER[assetId];
  if (!t) throw new Error(`No ChangeNow ticker mapping for ${assetId}`);
  return t;
}

/** Quote only — no exchange is created, nothing is committed. */
export async function getEstimatedExchangeAmount(fromAssetId, toAssetId, fromAmount) {
  const params = new URLSearchParams({
    fromCurrency: tickerFor(fromAssetId),
    toCurrency: tickerFor(toAssetId),
    fromAmount: String(fromAmount),
    flow: "standard",
  });
  return cnFetch(`/exchange/estimated-amount?${params.toString()}`);
}

/**
 * Creates the exchange order on ChangeNow's side and returns a deposit
 * address to send `fromAmount` of `fromAssetId` to. ChangeNow does the
 * actual swap once the deposit confirms — this wallet never holds both
 * sides itself. payoutAddress is where the converted asset gets sent.
 */
export async function createExchange({ fromAssetId, toAssetId, fromAmount, payoutAddress, refundAddress }) {
  return cnFetch(`/exchange`, {
    method: "POST",
    body: JSON.stringify({
      fromCurrency: tickerFor(fromAssetId),
      toCurrency: tickerFor(toAssetId),
      fromAmount: String(fromAmount),
      address: payoutAddress,
      refundAddress,
      flow: "standard",
    }),
  });
}

/** status: new|waiting|confirming|exchanging|sending|finished|failed|refunded|verifying */
export async function getExchangeStatus(exchangeId) {
  return cnFetch(`/exchange/by-id?id=${encodeURIComponent(exchangeId)}`);
}
