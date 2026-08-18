import { getAsset } from "../wallet/assets";
import { getErc20Balance, getNativeBalance } from "./evmClient";
import { getTrc20Balance } from "./tronClient";
import { fromBaseUnits } from "../wallet/units";

/**
 * Live on-chain balance for any non-BTC asset (BTC has its own synced
 * local-DB flow — see addressRepo/sync.js). Branches on the asset's own
 * shape rather than the caller having to know which chains are native
 * vs token — one place to get this right instead of three copies of the
 * same `isNative ? getNativeBalance : getErc20Balance` branch drifting
 * out of sync with each other.
 *
 * Returns a display-decimal string (e.g. "1.23456789"), or null if the
 * lookup failed (RPC down, etc.) — never throws.
 */
export async function getAssetBalanceDisplay(assetId, address) {
  const asset = getAsset(assetId);
  try {
    const raw =
      asset.chain === "tron"
        ? await getTrc20Balance(address, asset.contractAddress)
        : asset.isNative
          ? await getNativeBalance(asset.chain, address)
          : await getErc20Balance(asset.chain, address, asset.contractAddress);
    return fromBaseUnits(raw, asset.decimals);
  } catch {
    return null;
  }
}

/**
 * Sum of balances across EVERY active address for this asset — not just
 * the "current" one. Matters once generateNextAccountAddress has been
 * used, since funds could be sitting on address #2 while #3 is shown as
 * current; a total that only checked "current" would make real funds
 * look like they vanished. Returns a plain number (not a display
 * string) since callers combine it further (fiat conversion, etc.).
 */
export async function getAssetTotalBalance(assetId, activeAddresses) {
  if (!activeAddresses || activeAddresses.length === 0) return null;
  const perAddress = await Promise.all(
    activeAddresses.map((row) => getAssetBalanceDisplay(assetId, row.address))
  );
  const valid = perAddress.filter((v) => v != null);
  if (valid.length === 0) return null;
  const total = valid.reduce((sum, v) => sum + parseFloat(v), 0);
  return Number(total.toFixed(8)); // trim float noise from summing decimal strings
}
