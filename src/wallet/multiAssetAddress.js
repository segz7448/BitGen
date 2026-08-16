import { ASSET_IDS, getAsset } from "./assets";
import { deriveAddress as deriveBtcAddress } from "./hdWallet";
import { deriveEvmAddress } from "./evmWallet";
import { deriveTronAddress } from "./tronWallet";
import { addAddress, getCurrentAddress, setCurrentAddress } from "../db/addressRepo";

/**
 * BTC gets a fresh address per receive (see ReceiveScreen/addressRepo) for
 * the usual privacy reasons. Tron/ETH/BSC are account-model chains where
 * address reuse is normal and expected (that's how MetaMask/TronLink work
 * too) — so for those we derive index 0 once, store it, and reuse it from
 * then on rather than bothering the user with an address picker.
 */
export async function getOrCreateAddress(assetId, mnemonic, passphrase = "") {
  const asset = getAsset(assetId);

  const existing = await getCurrentAddress(assetId);
  if (existing) return existing.address;

  let derived;
  if (assetId === ASSET_IDS.BTC) {
    derived = deriveBtcAddress(mnemonic, 0, 0, passphrase);
  } else if (asset.chain === "tron") {
    derived = deriveTronAddress(mnemonic, 0, 0, passphrase);
  } else if (asset.chain === "ethereum" || asset.chain === "bsc") {
    derived = deriveEvmAddress(mnemonic, 0, 0, passphrase);
  } else {
    throw new Error(`No address derivation wired up for ${assetId}`);
  }

  await addAddress({ address: derived.address, path: derived.path, index: 0, change: 0, assetId });
  await setCurrentAddress(derived.address, assetId);
  return derived.address;
}
