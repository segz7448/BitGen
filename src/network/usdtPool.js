import { ASSET_IDS, getAsset } from "../wallet/assets";
import { getCurrentAddress } from "../db/addressRepo";
import { getErc20Balance } from "../network/evmClient";
import { getTrc20Balance } from "../network/tronClient";

export const USDT_CHAIN_IDS = [ASSET_IDS.USDT_TRC20, ASSET_IDS.USDT_ERC20, ASSET_IDS.USDT_BEP20];

// Fixed unit the pooled 'USDT' ledger is expressed in, independent of any
// one chain's on-chain decimals (TRC20/ERC20 use 6, BEP20 uses 18). 6 was
// picked to match TRC20/ERC20 directly and because USDT itself is
// conventionally quoted to 6 decimals; BEP20 values are scaled down into
// this unit and lose any precision finer than 1e-6 USDT, which is fine —
// nobody is trading sub-millionth-of-a-dollar amounts here.
export const USDT_MICROS_DECIMALS = 6;

function toMicros(rawBaseUnits, chainDecimals) {
  const raw = BigInt(rawBaseUnits);
  if (chainDecimals === USDT_MICROS_DECIMALS) return raw;
  if (chainDecimals > USDT_MICROS_DECIMALS) {
    return raw / 10n ** BigInt(chainDecimals - USDT_MICROS_DECIMALS);
  }
  return raw * 10n ** BigInt(USDT_MICROS_DECIMALS - chainDecimals);
}

function fromMicros(micros, chainDecimals) {
  const m = BigInt(micros);
  if (chainDecimals === USDT_MICROS_DECIMALS) return m;
  if (chainDecimals > USDT_MICROS_DECIMALS) {
    return m * 10n ** BigInt(chainDecimals - USDT_MICROS_DECIMALS);
  }
  return m / 10n ** BigInt(USDT_MICROS_DECIMALS - chainDecimals);
}

/**
 * Live on-chain USDT balance for one chain variant, in that chain's own
 * base units (BigInt). Returns 0n if no address is set up yet or the
 * lookup fails, same fallback behavior as HomeScreen's loadOtherBalances.
 */
async function fetchChainBalanceBaseUnits(assetId) {
  const asset = getAsset(assetId);
  const addrRow = await getCurrentAddress(assetId);
  if (!addrRow) return 0n;
  try {
    return asset.chain === "tron"
      ? await getTrc20Balance(addrRow.address, asset.contractAddress)
      : await getErc20Balance(asset.chain, addrRow.address, asset.contractAddress);
  } catch {
    return 0n;
  }
}

/**
 * Fetches all three USDT chain balances live and returns both the
 * per-chain breakdown (own decimals) and the pooled total in micros —
 * the number account_balances reconciliation for asset_id 'USDT' should
 * be driven from.
 */
export async function fetchPooledUsdtBalance() {
  const perChain = await Promise.all(
    USDT_CHAIN_IDS.map(async (assetId) => {
      const raw = await fetchChainBalanceBaseUnits(assetId);
      const asset = getAsset(assetId);
      return { assetId, raw, decimals: asset.decimals, micros: toMicros(raw, asset.decimals) };
    })
  );
  const totalMicros = perChain.reduce((sum, c) => sum + c.micros, 0n);
  return { perChain, totalMicros };
}

export { toMicros as usdtBaseUnitsToMicros, fromMicros as usdtMicrosToBaseUnits };
