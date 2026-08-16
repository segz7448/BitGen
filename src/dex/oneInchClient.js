/**
 * Thin HTTP client for 1inch's Swap API (v6) and Limit Order Protocol
 * API (v4). Both require a free API key from https://portal.1inch.dev.
 *
 * Same env-var pattern as changeNowClient.js / tronClient.js — never
 * hardcode the key, read it from EXPO_PUBLIC_ONEINCH_API_KEY (local
 * .env for dev, GitHub Actions repo secret for CI builds).
 *
 * VERIFY_BEFORE_USE: endpoint paths/params below reflect the 1inch v6
 * Swap API and v4 Limit Order Protocol API shape as documented at the
 * time this was written from training knowledge — this environment has
 * no live network access to 1inch's docs to confirm they haven't
 * changed. Before wiring this to a real wallet, open
 * https://portal.1inch.dev/documentation and diff every endpoint/param
 * name against what's here.
 *
 * IMPORTANT: 1inch's public API generally only serves MAINNET chains —
 * there is no reliable free testnet equivalent for the Swap API or LOP.
 * That means there's no risk-free way to test this end-to-end other
 * than real transactions with small real amounts. Budget for that.
 */

const SWAP_API_BASE = "https://api.1inch.dev/swap/v6.0";
const ORDERBOOK_API_BASE = "https://api.1inch.dev/orderbook/v4.0";

const API_KEY = process.env.EXPO_PUBLIC_ONEINCH_API_KEY || "";

function requireKey() {
  if (!API_KEY) {
    throw new Error(
      "No 1inch API key set. Get a free one at portal.1inch.dev and set " +
        "EXPO_PUBLIC_ONEINCH_API_KEY in your .env / CI secrets before swaps or limit orders will work."
    );
  }
}

async function oneInchFetch(url, options = {}) {
  requireKey();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.description || body?.error || `1inch API error ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

// ---------------------------------------------------------------------
// Swap API (v6) — quotes, swap tx building, allowance/approval helpers
// ---------------------------------------------------------------------

/**
 * Price quote only — no tx data, no wallet address needed. Amount is in
 * the source token's smallest base unit (string/BigInt-safe).
 */
export async function getSwapQuote({ chainId, srcToken, dstToken, amountBaseUnits }) {
  const url = `${SWAP_API_BASE}/${chainId}/quote?${qs({
    src: srcToken,
    dst: dstToken,
    amount: String(amountBaseUnits),
  })}`;
  return oneInchFetch(url);
}

/**
 * Builds a ready-to-sign swap transaction (to/data/value/gas). slippage
 * is a percent number, e.g. 1 for 1%. `from` must be the wallet that will
 * sign — 1inch simulates against it, so an unfunded/unapproved wallet
 * will surface the real error here rather than at broadcast time.
 */
export async function getSwapTx({ chainId, srcToken, dstToken, amountBaseUnits, fromAddress, slippagePercent }) {
  const url = `${SWAP_API_BASE}/${chainId}/swap?${qs({
    src: srcToken,
    dst: dstToken,
    amount: String(amountBaseUnits),
    from: fromAddress,
    slippage: slippagePercent,
    disableEstimate: false,
  })}`;
  return oneInchFetch(url);
}

/** Current allowance the 1inch router contract has for this token/wallet. */
export async function getAllowance({ chainId, tokenAddress, walletAddress }) {
  const url = `${SWAP_API_BASE}/${chainId}/approve/allowance?${qs({
    tokenAddress,
    walletAddress,
  })}`;
  const body = await oneInchFetch(url);
  return BigInt(body.allowance);
}

/**
 * Builds an unsigned approve() tx for the router to spend `amount` of
 * this token. Omit amount for unlimited approval — this codebase always
 * passes an explicit amount (see swapEngine.js) rather than approving
 * unlimited, to cap blast radius if the router is ever compromised.
 */
export async function getApproveTx({ chainId, tokenAddress, amountBaseUnits }) {
  const url = `${SWAP_API_BASE}/${chainId}/approve/transaction?${qs({
    tokenAddress,
    amount: amountBaseUnits !== undefined ? String(amountBaseUnits) : undefined,
  })}`;
  return oneInchFetch(url);
}

/** The router/spender contract address 1inch wants approved for a given chain. */
export async function getSpenderAddress(chainId) {
  const url = `${SWAP_API_BASE}/${chainId}/approve/spender`;
  const body = await oneInchFetch(url);
  return body.address;
}

// ---------------------------------------------------------------------
// Limit Order Protocol API (v4) — off-chain order submission/tracking.
// Order signing (EIP-712) happens in limitOrderEngine.js; this module
// only talks to the orderbook API once an order is already signed.
// ---------------------------------------------------------------------

export async function submitLimitOrder({ chainId, orderPayload }) {
  const url = `${ORDERBOOK_API_BASE}/${chainId}`;
  return oneInchFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderPayload),
  });
}

export async function getLimitOrdersByMaker({ chainId, makerAddress }) {
  const url = `${ORDERBOOK_API_BASE}/${chainId}/address/${makerAddress}`;
  return oneInchFetch(url);
}

export async function getLimitOrderByHash({ chainId, orderHash }) {
  const url = `${ORDERBOOK_API_BASE}/${chainId}/order/${orderHash}`;
  return oneInchFetch(url);
}
