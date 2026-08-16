import { getDb } from "./database";

// -----------------------------------------------------------------------
// Swaps
// -----------------------------------------------------------------------

export async function recordSwapPending({ chain, srcSymbol, dstSymbol, srcAmountBaseUnits, dstAmountEstimateBaseUnits, slippagePercent, txHash }) {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO dex_swaps (chain, src_symbol, dst_symbol, src_amount_base_units, dst_amount_estimate_base_units, slippage_percent, tx_hash, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [chain, srcSymbol, dstSymbol, String(srcAmountBaseUnits), dstAmountEstimateBaseUnits ? String(dstAmountEstimateBaseUnits) : null, slippagePercent, txHash, now, now]
  );
  return txHash;
}

export async function markSwapConfirmed(txHash, { dstAmountActualBaseUnits } = {}) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE dex_swaps SET status = 'confirmed', dst_amount_actual_base_units = ?, updated_at = ? WHERE tx_hash = ?`,
    [dstAmountActualBaseUnits ? String(dstAmountActualBaseUnits) : null, Date.now(), txHash]
  );
}

export async function markSwapFailed(txHash) {
  const db = await getDb();
  await db.runAsync(`UPDATE dex_swaps SET status = 'failed', updated_at = ? WHERE tx_hash = ?`, [Date.now(), txHash]);
}

export async function getSwapHistory(limit = 50) {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM dex_swaps ORDER BY created_at DESC LIMIT ?`, [limit]);
}

// -----------------------------------------------------------------------
// Limit orders
// -----------------------------------------------------------------------

export async function recordLimitOrder({
  chain,
  orderHash,
  makerSymbol,
  takerSymbol,
  makingAmountBaseUnits,
  takingAmountBaseUnits,
  limitPrice,
  expiryAt,
  rawOrder,
}) {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO dex_limit_orders (chain, order_hash, maker_symbol, taker_symbol, making_amount_base_units, taking_amount_base_units, limit_price, expiry_at, status, raw_order_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    [
      chain,
      orderHash,
      makerSymbol,
      takerSymbol,
      String(makingAmountBaseUnits),
      String(takingAmountBaseUnits),
      limitPrice,
      expiryAt ?? null,
      JSON.stringify(rawOrder),
      now,
      now,
    ]
  );
}

export async function updateLimitOrderStatus(orderHash, status) {
  const db = await getDb();
  await db.runAsync(`UPDATE dex_limit_orders SET status = ?, updated_at = ? WHERE order_hash = ?`, [status, Date.now(), orderHash]);
}

export async function markLimitOrderCancelled(orderHash, cancelTxHash) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE dex_limit_orders SET status = 'cancelled', cancel_tx_hash = ?, updated_at = ? WHERE order_hash = ?`,
    [cancelTxHash, Date.now(), orderHash]
  );
}

export async function getOpenLimitOrders() {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM dex_limit_orders WHERE status = 'open' ORDER BY created_at DESC`);
}

export async function getAllLimitOrders(limit = 100) {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM dex_limit_orders ORDER BY created_at DESC LIMIT ?`, [limit]);
}

export async function getLimitOrder(orderHash) {
  const db = await getDb();
  return db.getFirstAsync(`SELECT * FROM dex_limit_orders WHERE order_hash = ?`, [orderHash]);
}
