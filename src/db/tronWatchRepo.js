import { getDb } from "./database";

export async function createWatchOrder({ fromSymbol, toSymbol, humanAmountIn, targetPrice, direction, slippagePercent = 1 }) {
  const db = await getDb();
  const now = Date.now();
  const result = await db.runAsync(
    `INSERT INTO tron_watch_orders (from_symbol, to_symbol, human_amount_in, target_price, direction, slippage_percent, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'watching', ?, ?)`,
    [fromSymbol, toSymbol, String(humanAmountIn), targetPrice, direction, slippagePercent, now, now]
  );
  return result.lastInsertRowId;
}

export async function getWatchingOrders() {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM tron_watch_orders WHERE status = 'watching' ORDER BY created_at ASC`);
}

export async function getAllWatchOrders(limit = 100) {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM tron_watch_orders ORDER BY created_at DESC LIMIT ?`, [limit]);
}

export async function markWatchOrderFilled(id, txHash) {
  const db = await getDb();
  await db.runAsync(`UPDATE tron_watch_orders SET status = 'filled', executed_tx_hash = ?, updated_at = ? WHERE id = ?`, [
    txHash,
    Date.now(),
    id,
  ]);
}

export async function markWatchOrderFailed(id) {
  const db = await getDb();
  await db.runAsync(`UPDATE tron_watch_orders SET status = 'failed', updated_at = ? WHERE id = ?`, [Date.now(), id]);
}

export async function cancelWatchOrder(id) {
  const db = await getDb();
  await db.runAsync(`UPDATE tron_watch_orders SET status = 'cancelled', updated_at = ? WHERE id = ?`, [Date.now(), id]);
}
