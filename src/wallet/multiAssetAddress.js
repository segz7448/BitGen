import { ASSET_IDS, getAsset } from "./assets";
import { deriveAddress as deriveBtcAddress } from "./hdWallet";
import { deriveEvmAddress } from "./evmWallet";
import { deriveTronAddress } from "./tronWallet";
import { addAddress, getCurrentAddress, setCurrentAddress, getNextDerivationIndex } from "../db/addressRepo";

/**
 * BTC gets a fresh address per receive (see ReceiveScreen/addressRepo) for
 * the usual privacy reasons. Tron/ETH/BSC are account-model chains where
 * address reuse is normal and expected (that's how MetaMask/TronLink work
 * too) — so for those we derive index 0 once, store it, and reuse it from
 * then on rather than bothering the user with an address picker, UNLESS
 * they explicitly ask for another one via generateNextAccountAddress below.
 */
export async function getOrCreateAddress(assetId, mnemonic, passphrase = "") {
  const existing = await getCurrentAddress(assetId);
  if (existing) return existing.address;

  const derived = await deriveAccountAddress(assetId, 0, mnemonic, passphrase);
  await addAddress({ address: derived.address, path: derived.path, index: 0, change: 0, assetId });
  await setCurrentAddress(derived.address, assetId);
  return derived.address;
}

function deriveAccountAddress(assetId, index, mnemonic, passphrase) {
  const asset = getAsset(assetId);
  if (assetId === ASSET_IDS.BTC) return deriveBtcAddress(mnemonic, index, 0, passphrase);
  if (asset.chain === "tron") return deriveTronAddress(mnemonic, index, 0, passphrase);
  if (asset.chain === "ethereum" || asset.chain === "bsc" || asset.chain === "morph") {
    return deriveEvmAddress(mnemonic, index, 0, passphrase);
  }
  throw new Error(`No address derivation wired up for ${assetId}`);
}

/**
 * Derive and store an ADDITIONAL address for an account-model asset
 * (a USDT or ETH variant) — separate account index, separate private key, separate
 * balance. Unlike BTC, this isn't "the normal thing to do" for these
 * chains, but some people do want it (e.g. keeping funds for different
 * purposes visibly separate, the same way MetaMask lets you add
 * "Account 2"). Old addresses stay fully active and spendable — this
 * never deactivates anything, it just adds one more and makes it current.
 */
export async function generateNextAccountAddress(assetId, mnemonic, passphrase = "") {
  const nextIndex = await getNextDerivationIndex(assetId, 0);
  const derived = await deriveAccountAddress(assetId, nextIndex, mnemonic, passphrase);
  await addAddress({ address: derived.address, path: derived.path, index: nextIndex, change: 0, assetId });
  await setCurrentAddress(derived.address, assetId);
  return derived;
}
