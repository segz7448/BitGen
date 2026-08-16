/**
 * Swap-tradeable token registry for EVM chains — used by the DEX swap
 * screen/engine. Distinct from wallet/assets.js: that file is about
 * "what can this wallet receive/hold," this file is about "what can be
 * swapped via 1inch on a given chain."
 *
 * 1inch represents the native coin (ETH, BNB) with a magic pseudo-address
 * rather than a real ERC20 contract — every EVM chain uses the SAME
 * pseudo-address for this. It is NOT a real contract; never call
 * balanceOf/approve against it. Use getNativeBalance() from evmClient.js
 * for native-coin balances and skip the approval step entirely for it.
 */
export const NATIVE_PSEUDO_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// 1inch/EVM standard chain IDs — these are correct and stable, not
// 1inch-specific, safe to trust.
export const CHAIN_ID = {
  ethereum: 1,
  bsc: 56,
};

/**
 * VERIFY_BEFORE_USE: token contract addresses below are widely-known,
 * commonly-cited mainnet addresses from training data, not fetched live.
 * Cross-check every one of these against Etherscan/BscScan (verified
 * contract, official token page) before the first real swap. A wrong
 * address here doesn't error cleanly — it can approve/send into the
 * wrong contract entirely.
 */
export const DEX_TOKENS = {
  ethereum: {
    ETH: { symbol: "ETH", decimals: 18, address: NATIVE_PSEUDO_ADDRESS, isNative: true },
    WBTC: { symbol: "WBTC", decimals: 8, address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", isNative: false },
    USDT: { symbol: "USDT", decimals: 6, address: "0xdAC17F958D2ee523a2206206994597C13D831ec", isNative: false },
  },
  bsc: {
    BNB: { symbol: "BNB", decimals: 18, address: NATIVE_PSEUDO_ADDRESS, isNative: true },
    BTCB: { symbol: "BTCB", decimals: 18, address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", isNative: false },
    USDT: { symbol: "USDT", decimals: 18, address: "0x55d398326f99059fF775485246999027B3197955", isNative: false },
  },
};

export function getToken(chain, symbol) {
  const t = DEX_TOKENS[chain]?.[symbol];
  if (!t) throw new Error(`Unknown swap token: ${chain}/${symbol}`);
  return t;
}

export function listTokens(chain) {
  const tokens = DEX_TOKENS[chain];
  if (!tokens) throw new Error(`Unknown chain: ${chain}`);
  return Object.values(tokens);
}

export function getChainId(chain) {
  const id = CHAIN_ID[chain];
  if (!id) throw new Error(`Unknown chain: ${chain}`);
  return id;
}
