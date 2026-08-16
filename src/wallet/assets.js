/**
 * Central asset registry. Every screen, repo, and tx builder should look
 * an asset up here rather than hardcoding "BTC" or a derivation path.
 *
 * `implemented: false` means the asset is registered (shows in asset
 * pickers as "coming soon") but has no signing/broadcast code wired up
 * yet — attempting to send will throw. Flip it to true only once that
 * asset's txBuilder + network client exist and have been tested.
 */

export const ASSET_IDS = {
  BTC: "BTC",
  USDT_TRC20: "USDT_TRC20",
  USDT_ERC20: "USDT_ERC20",
  USDT_BEP20: "USDT_BEP20",
};

export const ASSETS = {
  [ASSET_IDS.BTC]: {
    id: ASSET_IDS.BTC,
    symbol: "BTC",
    displayName: "Bitcoin",
    chain: "bitcoin",
    decimals: 8,
    isNative: true,
    contractAddress: null,
    // m/84'/0'/0'/<change>/<index> — BIP84 native SegWit, handled in hdWallet.js
    derivationPurpose: 84,
    derivationCoinType: 0,
    implemented: true,
  },
  [ASSET_IDS.USDT_TRC20]: {
    id: ASSET_IDS.USDT_TRC20,
    symbol: "USDT",
    displayName: "Tether (Tron)",
    chain: "tron",
    decimals: 6,
    isNative: false,
    contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", // official USDT TRC20 contract
    // m/44'/195'/0'/<change>/<index> — Tron BIP44 coin type
    derivationPurpose: 44,
    derivationCoinType: 195,
    implemented: true,
  },
  [ASSET_IDS.USDT_ERC20]: {
    id: ASSET_IDS.USDT_ERC20,
    symbol: "USDT",
    displayName: "Tether (Ethereum)",
    chain: "ethereum",
    decimals: 6,
    isNative: false,
    contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec", // official USDT ERC20 contract
    // m/44'/60'/0'/<change>/<index> — Ethereum BIP44 coin type
    derivationPurpose: 44,
    derivationCoinType: 60,
    implemented: true,
  },
  [ASSET_IDS.USDT_BEP20]: {
    id: ASSET_IDS.USDT_BEP20,
    symbol: "USDT",
    displayName: "Tether (BNB Smart Chain)",
    chain: "bsc",
    decimals: 18, // BEP20 USDT uses 18 decimals, unlike ERC20/TRC20's 6 — easy bug source
    isNative: false,
    contractAddress: "0x55d398326f99059fF775485246999027B3197955", // official USDT BEP20 contract
    // BSC is EVM-compatible and conventionally reuses Ethereum's coin type (60),
    // not its own — same path, different RPC/chain id at broadcast time.
    derivationPurpose: 44,
    derivationCoinType: 60,
    implemented: true,
  },
};

export function getAsset(assetId) {
  const asset = ASSETS[assetId];
  if (!asset) throw new Error(`Unknown asset id: ${assetId}`);
  return asset;
}

export function listAssets({ implementedOnly = false } = {}) {
  const all = Object.values(ASSETS);
  return implementedOnly ? all.filter((a) => a.implemented) : all;
}

export function assertImplemented(assetId) {
  const asset = getAsset(assetId);
  if (!asset.implemented) {
    throw new Error(
      `${asset.displayName} support isn't wired up yet (no signer/network client). ` +
        `It's registered for UI display only.`
    );
  }
  return asset;
}

export const DEFAULT_ASSET_ID = ASSET_IDS.BTC;
