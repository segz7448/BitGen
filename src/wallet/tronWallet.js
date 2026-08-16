import "../polyfills";
import * as bip39 from "bip39";
import { BIP32Factory } from "bip32";
import * as ecc from "@bitcoinerlab/secp256k1";
import TronWeb from "tronweb";

const bip32 = BIP32Factory(ecc);

// m/44'/195'/0'/<change>/<index> — 195 is Tron's registered SLIP-44 coin type.
const PURPOSE = 44;
const COIN_TYPE = 195;

function pathFor(index, change = 0) {
  return `m/${PURPOSE}'/${COIN_TYPE}'/0'/${change}/${index}`;
}

/**
 * Derive the raw secp256k1 private key at a Tron path. Tron uses the same
 * curve as Bitcoin/Ethereum, just a different derivation path and a
 * different address encoding (base58check with a 0x41 prefix over the
 * keccak256 of the public key) — TronWeb handles that encoding for us.
 */
export function deriveTronKeyPair(mnemonic, index, change = 0, passphrase = "") {
  const seed = bip39.mnemonicToSeedSync(mnemonic.trim(), passphrase);
  const root = bip32.fromSeed(seed);
  const child = root.derivePath(pathFor(index, change));
  const privateKeyHex = Buffer.from(child.privateKey).toString("hex");
  return { privateKeyHex, path: pathFor(index, change), index, change };
}

export function deriveTronAddress(mnemonic, index, change = 0, passphrase = "") {
  const { privateKeyHex, path } = deriveTronKeyPair(mnemonic, index, change, passphrase);
  const address = TronWeb.address.fromPrivateKey(privateKeyHex);
  return { address, path, index, change };
}

export function isValidTronAddress(address) {
  return TronWeb.isAddress(address);
}
