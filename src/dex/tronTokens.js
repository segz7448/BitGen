/**
 * Swap-tradeable token registry for Tron — mirrors src/dex/tokens.js but
 * for SunSwap V2 (a Uniswap-V2-style AMM on Tron) instead of 1inch/EVM.
 *
 * VERIFY_BEFORE_USE: contract addresses below (router, WTRX, USDT) are
 * widely-cited Tron mainnet addresses from training knowledge, not
 * fetched live — this environment has no network access to Tron
 * explorers or sun.io's docs to re-confirm them right now. Check each
 * one on https://tronscan.org (verified contract, official token page)
 * before the first real swap. A wrong router address doesn't fail
 * loudly — it can approve/send TRC20 tokens into a contract that never
 * gives them back.
 */

// SunSwap V2 Router — Uniswap V2 fork, same swapExactX-for-Y function
// shapes you'd recognize from any Uniswap V2 clone.
export const SUNSWAP_V2_ROUTER = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";

// Wrapped TRX — needed in swap `path` arrays whenever TRX is one leg,
// same role WETH plays on Ethereum Uniswap V2. The router's
// swapExactTRXForTokens/swapExactTokensForTRX functions handle the
// wrap/unwrap internally; you never hold WTRX yourself, it's just the
// address used to identify the pair.
export const WTRX_ADDRESS = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";

export const TRON_PSEUDO_NATIVE = "TRX_NATIVE"; // not a real address, just a sentinel this app uses internally

export const TRON_TOKENS = {
  TRX: { symbol: "TRX", decimals: 6, address: TRON_PSEUDO_NATIVE, pathAddress: WTRX_ADDRESS, isNative: true },
  USDT: {
    symbol: "USDT",
    decimals: 6,
    address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", // same official USDT TRC20 contract already used in wallet/assets.js
    pathAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    isNative: false,
  },
};

export function getTronToken(symbol) {
  const t = TRON_TOKENS[symbol];
  if (!t) throw new Error(`Unknown Tron swap token: ${symbol}`);
  return t;
}

export function listTronTokens() {
  return Object.values(TRON_TOKENS);
}
