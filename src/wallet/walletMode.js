import { getDb } from "../db/database";

const MODE_KEY = "wallet_mode"; // 'full' | 'watch_only'
const XPUB_KEY = "watch_only_xpub";

export async function setWalletMode(mode, xpub = null) {
  const db = await getDb();
  await db.runAsync(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [MODE_KEY, mode]);
  if (xpub) {
    await db.runAsync(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [XPUB_KEY, xpub]);
  }
}

export async function getWalletMode() {
  const db = await getDb();
  const row = await db.getFirstAsync(`SELECT value FROM settings WHERE key = ?`, [MODE_KEY]);
  return row?.value || "full";
}

export async function isWatchOnly() {
  return (await getWalletMode()) === "watch_only";
}

export async function getStoredXpub() {
  const db = await getDb();
  const row = await db.getFirstAsync(`SELECT value FROM settings WHERE key = ?`, [XPUB_KEY]);
  return row?.value || null;
}
