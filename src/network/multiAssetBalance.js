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
