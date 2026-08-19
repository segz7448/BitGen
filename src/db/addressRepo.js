import { getDb } from "./database";
import { deriveAddress, deriveAddressFromXpub } from "../wallet/hdWallet";

/**
 * Insert a freshly derived address into the DB. `is_active` defaults to 1 —
 * meaning it can still receive funds and BITGEN will keep watching it.
 * "Deactivating" only hides it from the picker UI; it never stops being a
 * valid Bitcoin address, and BITGEN still detects incoming funds on it.
 *
 * `assetId` defaults to 'BTC' so every existing BTC call site (sync.js,
 * SendScreen, ConfirmSeedScreen, etc.) keeps working unchanged. Multi-asset
 * callers (multiAssetAddress.js) pass their own assetId explicitly.
 */
export async function addAddress({ address, path, index, change, assetId = "BTC" }) {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO addresses (address, derivation_index, change_type, created_at, asset_id)
     VALUES (?, ?, ?, ?, ?)`,
    [address, index, change, Date.now(), assetId]
  );
}

export async function getAllAddresses({ change = 0, includeInactive = true, assetId = "BTC" } = {}) {
  const db = await getDb();
  const query = includeInactive
    ? `SELECT * FROM addresses WHERE change_type = ? AND asset_id = ? ORDER BY derivation_index ASC`
    : `SELECT * FROM addresses WHERE change_type = ? AND asset_id = ? AND is_active = 1 ORDER BY derivation_index ASC`;
  return db.getAllAsync(query, [change, assetId]);
}

export async function getActiveAddresses(change = 0, assetId = "BTC") {
  return getAllAddresses({ change, includeInactive: false, assetId });
}

export async function getCurrentAddress(assetId = "BTC") {
  const db = await getDb();
  return db.getFirstAsync(
    `SELECT * FROM addresses WHERE is_current = 1 AND change_type = 0 AND asset_id = ? LIMIT 1`,
    [assetId]
  );
}

/**
 * Switch which address is shown as current for an asset. Does NOT deactivate
 * the previous one — every prior address stays active and watched unless
 * the user explicitly disables it. Scoped to `assetId` so picking a new BTC
 * receive address never clobbers the stored USDT address, and vice versa.
 */
export async function setCurrentAddress(address, assetId = "BTC") {
  const db = await getDb();
  await db.runAsync(`UPDATE addresses SET is_current = 0 WHERE change_type = 0 AND asset_id = ?`, [assetId]);
  await db.runAsync(
    `UPDATE addresses SET is_current = 1, is_active = 1 WHERE address = ? AND asset_id = ?`,
    [address, assetId]
  );
}

export async function setAddressActive(address, isActive, assetId = "BTC") {
  const db = await getDb();
  await db.runAsync(`UPDATE addresses SET is_active = ? WHERE address = ? AND asset_id = ?`, [
    isActive ? 1 : 0,
    address,
    assetId,
  ]);
}

export async function setAddressLabel(address, label, assetId = "BTC") {
  const db = await getDb();
  await db.runAsync(`UPDATE addresses SET label = ? WHERE address = ? AND asset_id = ?`, [label, address, assetId]);
}

/**
 * Next unused derivation index for a given asset — shared by BTC's
 * generateNextAddress below and multiAssetAddress.js's EVM/Tron
 * equivalent, so both stay consistent about how "next" is computed.
 */
export async function getNextDerivationIndex(assetId, change = 0) {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT MAX(derivation_index) as maxIdx FROM addresses WHERE change_type = ? AND asset_id = ?`,
    [change, assetId]
  );
  return (row?.maxIdx ?? -1) + 1;
}

/**
 * Derive and store the next unused receiving address, then mark it current.
 * This is what "generate new address" does — old ones stay active and
 * fully able to receive funds; they just stop being the one shown by default.
 */
export async function generateNextAddress(mnemonic, passphrase = "") {  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT MAX(derivation_index) as maxIdx FROM addresses WHERE change_type = 0 AND asset_id = 'BTC'`
  );
  const nextIndex = (row?.maxIdx ?? -1) + 1;
  const derived = deriveAddress(mnemonic, nextIndex, 0, passphrase);
  await addAddress({ address: derived.address, path: derived.path, index: nextIndex, change: 0 });
  await setCurrentAddress(derived.address);
  return derived;
}

/**
 * Watch-only counterpart to generateNextAddress — derives the next
 * receiving address from an xpub/zpub instead of a mnemonic, since
 * watch-only wallets never have a seed on-device.
 */
export async function generateNextAddressFromXpub(xpub) {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT MAX(derivation_index) as maxIdx FROM addresses WHERE change_type = 0 AND asset_id = 'BTC'`
  );
  const nextIndex = (row?.maxIdx ?? -1) + 1;
  const derived = deriveAddressFromXpub(xpub, nextIndex, 0);
  await addAddress({ address: derived.address, index: nextIndex, change: 0 });
  await setCurrentAddress(derived.address);
  return derived;
}

export async function updateAddressBalance(address, sats) {
  const db = await getDb();
  await db.runAsync(`UPDATE addresses SET balance_sats = ? WHERE address = ?`, [sats, address]);
}

/**
 * BTC balance only. USDT variants are fetched live from-chain instead of
 * synced into balance_sats (see HomeScreen's loadOtherBalances), so this
 * stays scoped to BTC rather than summing across asset_id.
 */
export async function getTotalBalance() {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT COALESCE(SUM(balance_sats), 0) as total FROM addresses WHERE is_active = 1 AND asset_id = 'BTC'`
  );
  return row.total;
}
