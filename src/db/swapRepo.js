import { getDb } from "./database";

export async function recordSwap({ providerExchangeId, fromAssetId, toAssetId, fromAmount, toAmountEstimate, depositAddress, payoutAddress }) {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO swaps (provider, provider_exchange_id, from_asset_id, to_asset_id, from_amount, to_amount_estimate, deposit_address, payout_address, status, created_at, updated_at)
     VALUES ('changenow', ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`,
    [providerExchangeId, fromAssetId, toAssetId, String(fromAmount), toAmountEstimate ? String(toAmountEstimate) : null, depositAddress, payoutAddress, now, now]
  );
}

export async function updateSwapStatus(providerExchangeId, status) {
  const db = await getDb();
  await db.runAsync(`UPDATE swaps SET status = ?, updated_at = ? WHERE provider_exchange_id = ?`, [
    status,
    Date.now(),
    providerExchangeId,
  ]);
}

export async function getAllSwaps() {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM swaps ORDER BY created_at DESC`);
}

export async function getSwap(providerExchangeId) {
  const db = await getDb();
  return db.getFirstAsync(`SELECT * FROM swaps WHERE provider_exchange_id = ?`, [providerExchangeId]);
}
