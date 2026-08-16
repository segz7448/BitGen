import "../polyfills";
import * as bitcoin from "bitcoinjs-lib";
import { NETWORK } from "./hdWallet";

export const DUST_THRESHOLD_SATS = 546;

export function isValidAddress(address) {
  if (!address || typeof address !== "string") return false;
  try {
    bitcoin.address.toOutputScript(address.trim(), NETWORK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a send request before touching the network or building a tx.
 * Returns { valid: boolean, error?: string }
 */
export function validateSendInput({ toAddress, amountSats, availableSats }) {
  if (!toAddress || !toAddress.trim()) {
    return { valid: false, error: "Enter a recipient address." };
  }
  if (!isValidAddress(toAddress.trim())) {
    return { valid: false, error: "That doesn't look like a valid Bitcoin address." };
  }
  if (!Number.isFinite(amountSats) || amountSats <= 0) {
    return { valid: false, error: "Enter a valid amount." };
  }
  if (amountSats < DUST_THRESHOLD_SATS) {
    return { valid: false, error: `Amount is below the dust threshold (${DUST_THRESHOLD_SATS} sats). The network will reject it.` };
  }
  if (typeof availableSats === "number" && amountSats > availableSats) {
    return { valid: false, error: "Amount exceeds your available balance." };
  }
  return { valid: true };
}

export function btcToSats(btcString) {
  const n = parseFloat(btcString);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return Math.round(n * 100_000_000);
}
