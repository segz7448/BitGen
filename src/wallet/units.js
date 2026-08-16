/**
 * Converts a human decimal amount (string or number, e.g. "12.5") to the
 * asset's smallest base unit as a BigInt (e.g. 12500000n for 6 decimals).
 * Done via string manipulation, never `amount * 10**decimals` as a float —
 * floats lose precision past a handful of significant digits and this is
 * money.
 */
export function toBaseUnits(amount, decimals) {
  const str = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) throw new Error(`Invalid decimal amount: ${amount}`);

  const [whole, frac = ""] = str.split(".");
  if (frac.length > decimals) {
    throw new Error(`Amount has more precision (${frac.length} decimals) than the asset supports (${decimals}).`);
  }
  const paddedFrac = frac.padEnd(decimals, "0");
  return BigInt(whole + paddedFrac);
}

/** Inverse of toBaseUnits — base units (BigInt) back to a display decimal string. */
export function fromBaseUnits(baseUnits, decimals) {
  const s = baseUnits.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
