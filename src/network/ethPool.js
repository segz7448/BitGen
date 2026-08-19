import { ASSET_IDS, getAsset } from "../wallet/assets";
import { getCurrentAddress } from "../db/addressRepo";
import { getErc20Balance, getNativeBalance } from "./evmClient";

export const ETH_CHAIN_IDS = [ASSET_IDS.ETH_ETHEREUM, ASSET_IDS.ETH_MORPH, ASSET_IDS.ETH_BEP20];

// account_balances stores plain JS-Number columns, so the pooled ledger
// unit has to stay well under Number.MAX_SAFE_INTEGER (~9e15). All three
// ETH variants use 18-decimal wei, and a raw wei balance north of ~9 ETH
// would already exceed that — so unlike a chain's own on-device balance
// display, the pooled ledger scales wei down to 8 decimals (matching the
// precision this app already uses for BTC sats-display), same rescaling
// approach as usdtPool.js's "micros" for its own 6-vs-18-decimal split.
export const ETH_POOL_DECIMALS = 8;
const WEI_DECIMALS = 18;

function toPoolUnits(rawWei) {
  return rawWei / 10n ** BigInt(WEI_DECIMALS - ETH_POOL_DECIMALS);
}

function fromPoolUnits(poolUnits) {
  return BigInt(poolUnits) * 10n ** BigInt(WEI_DECIMALS - ETH_POOL_DECIMALS);
}

async function fetchChainBalanceBaseUnits(assetId) {
  const asset = getAsset(assetId);
  const addrRow = await getCurrentAddress(assetId);
  if (!addrRow) return 0n;
  try {
    return asset.isNative
      ? await getNativeBalance(asset.chain, addrRow.address)
      : await getErc20Balance(asset.chain, addrRow.address, asset.contractAddress);
  } catch {
    return 0n;
  }
}

/**
 * Fetches all three ETH chain balances live and returns both the
 * per-chain breakdown (raw wei) and the pooled total in pool units — the
 * number account_balances reconciliation for asset_id 'ETH' should be
 * driven from. Mirrors usdtPool.js's fetchPooledUsdtBalance.
 */
export async function fetchPooledEthBalance() {
  const perChain = await Promise.all(
    ETH_CHAIN_IDS.map(async (assetId) => {
      const raw = await fetchChainBalanceBaseUnits(assetId);
      return { assetId, raw, poolUnits: toPoolUnits(raw) };
    })
  );
  const totalPoolUnits = perChain.reduce((sum, c) => sum + c.poolUnits, 0n);
  return { perChain, totalPoolUnits };
}

export { toPoolUnits as ethWeiToPoolUnits, fromPoolUnits as ethPoolUnitsToWei };
