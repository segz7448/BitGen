import { getDb } from "../db/database";

// Supported display currencies. USD is the hard default — a fresh install,
// or a row that's missing/corrupt, always resolves to "usd" rather than
// silently falling back to whatever the last fetch happened to return.
export const SUPPORTED_CURRENCIES = ["usd", "ngn", "eur", "gbp"];
export const DEFAULT_CURRENCY = "usd";

const CURRENCY_KEY = "display_currency";

export async function setDisplayCurrency(currency) {
  const normalized = String(currency || "").toLowerCase();
  if (!SUPPORTED_CURRENCIES.includes(normalized)) {
    throw new Error(`Unsupported currency: ${currency}`);
  }
  const db = await getDb();
  await db.runAsync(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
    CURRENCY_KEY,
    normalized,
  ]);
  return normalized;
}

export async function getDisplayCurrency() {
  const db = await getDb();
  const row = await db.getFirstAsync(`SELECT value FROM settings WHERE key = ?`, [CURRENCY_KEY]);
  const value = row?.value;
  return SUPPORTED_CURRENCIES.includes(value) ? value : DEFAULT_CURRENCY;
}
