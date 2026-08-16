import "../polyfills";
import { ethers } from "ethers";

// Both Ethereum and BSC are EVM chains and conventionally share BIP44
// coin type 60 (BSC does NOT use its own registered coin type in practice —
// virtually every wallet, including MetaMask, derives BSC addresses on the
// same m/44'/60'/... path as Ethereum). This means one BTC seed produces
// the SAME address on both chains — that's expected, not a bug.
const DERIVATION_COIN_TYPE = 60;

function pathFor(index, change = 0) {
  return `m/44'/${DERIVATION_COIN_TYPE}'/0'/${change}/${index}`;
}

/**
 * Derive the ethers HDNodeWallet at a given index — used internally for
 * both address derivation and signing. Never persisted; call fresh each
 * time from the mnemonic, same pattern as hdWallet.js's BTC path.
 */
export function deriveEvmWallet(mnemonic, index, change = 0, passphrase = "") {
  const path = pathFor(index, change);
  return ethers.HDNodeWallet.fromPhrase(mnemonic.trim(), passphrase, path);
}

export function deriveEvmAddress(mnemonic, index, change = 0, passphrase = "") {
  const wallet = deriveEvmWallet(mnemonic, index, change, passphrase);
  return { address: wallet.address, path: pathFor(index, change), index, change };
}

export function isValidEvmAddress(address) {
  return ethers.isAddress(address);
}
