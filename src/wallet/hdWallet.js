import "../polyfills";
import * as bitcoin from "bitcoinjs-lib";
import * as bip39 from "bip39";
import { BIP32Factory } from "bip32";
import * as ecc from "@bitcoinerlab/secp256k1";
import { ECPairFactory } from "ecpair";

const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

bitcoin.initEccLib(ecc);

// Set to bitcoin.networks.testnet while developing/testing with faucet coins.
export const NETWORK = bitcoin.networks.bitcoin;

// BIP84 = native SegWit (bech32, "bc1...") — lowest fees, the modern standard.
// Path: m/84'/0'/0'/<change>/<index>
const PURPOSE = 84;
const COIN_TYPE = 0; // 0 = mainnet, 1 = testnet
const ACCOUNT = 0;

/**
 * Generate a brand new BIP39 mnemonic (seed phrase).
 * 128 bits = 12 words, 256 bits = 24 words.
 */
export function generateMnemonic(strength = 128) {
  return bip39.generateMnemonic(strength);
}

export function validateMnemonic(mnemonic) {
  return bip39.validateMnemonic(mnemonic.trim());
}

/**
 * Derive the root HD node from a mnemonic. Everything else derives from this.
 * The mnemonic itself is what gets stored in SecureStore — never the root node.
 */
function getRootNode(mnemonic, passphrase = "") {
  const seed = bip39.mnemonicToSeedSync(mnemonic.trim(), passphrase);
  return bip32.fromSeed(seed, NETWORK);
}

/**
 * Derive the account-level extended key. In BIP32/44/84 this is the node
 * you'd export as an xpub/zpub if you wanted watch-only access.
 */
function getAccountNode(mnemonic, passphrase = "") {
  const root = getRootNode(mnemonic, passphrase);
  return root.derivePath(`m/${PURPOSE}'/${COIN_TYPE}'/${ACCOUNT}'`);
}

/**
 * Derive a single address at a given change/index path.
 * change: 0 = receiving address, 1 = internal/change address
 */
export function deriveAddress(mnemonic, index, change = 0, passphrase = "") {
  const account = getAccountNode(mnemonic, passphrase);
  const child = account.derive(change).derive(index);
  const { address } = bitcoin.payments.p2wpkh({
    pubkey: child.publicKey,
    network: NETWORK,
  });
  return {
    address,
    path: `m/${PURPOSE}'/${COIN_TYPE}'/${ACCOUNT}'/${change}/${index}`,
    index,
    change,
  };
}

/**
 * Derive the private key (WIF) for a specific address path — needed only
 * at signing time. Never persisted; pulled fresh from the seed each time.
 */
export function deriveKeyPairForPath(mnemonic, index, change = 0, passphrase = "") {
  const account = getAccountNode(mnemonic, passphrase);
  const child = account.derive(change).derive(index);
  return ECPair.fromPrivateKey(child.privateKey, { network: NETWORK });
}

/**
 * Batch-generate the first N receiving addresses — used on wallet creation
 * to seed the address table before the user has requested any manually.
 */
export function generateAddressBatch(mnemonic, count = 5, startIndex = 0, change = 0, passphrase = "") {
  const out = [];
  for (let i = startIndex; i < startIndex + count; i++) {
    out.push(deriveAddress(mnemonic, i, change, passphrase));
  }
  return out;
}

/**
 * Export the account-level extended public key (zpub, for BIP84) — safe to
 * share, cannot sign transactions, can only derive addresses and see
 * incoming funds. This is what powers watch-only mode.
 */
export function getAccountXpub(mnemonic, passphrase = "") {
  const account = getAccountNode(mnemonic, passphrase);
  return account.neutered().toBase58();
}

/**
 * Derive a receiving/change address from an xpub/zpub alone — no seed, no
 * private key involved anywhere in this path. Used for watch-only wallets.
 */
export function deriveAddressFromXpub(xpubString, index, change = 0) {
  const account = bip32.fromBase58(xpubString, NETWORK);
  const child = account.derive(change).derive(index);
  const { address } = bitcoin.payments.p2wpkh({
    pubkey: child.publicKey,
    network: NETWORK,
  });
  return { address, index, change };
}

export function isValidXpub(xpubString) {
  try {
    bip32.fromBase58(xpubString.trim(), NETWORK);
    return true;
  } catch {
    return false;
  }
}

export { bitcoin, ECPair };
