import { getDb } from "./database";
import { getTotalBalance } from "./addressRepo";
import { fetchPooledUsdtBalance, USDT_CHAIN_IDS } from "../network/usdtPool";
import { fetchPooledEthBalance, ETH_CHAIN_IDS } from "../network/ethPool";

export const ACCOUNTS = {
  FUNDING: "funding",
  UNIFIED: "unified",
};

export const POOLED_USDT_ASSET_ID = "USDT";
export const POOLED_ETH_ASSET_ID = "ETH";

// Which multi-chain assets are "pooled" (one Unified number backed by
// several real on-chain balances) and the ledger table tracking which
// real chain each unified unit maps back to. Keyed by pooled asset id so
// transferBetweenAccounts below can look up the right table generically
// instead of a hardcoded USDT-only branch.
const POOL_CONFIG = {
  [POOLED_USDT_ASSET_ID]: { table: "usdt_chain_ledger", unitsColumn: "unified_micros", chainIds: USDT_CHAIN_IDS },
  [POOLED_ETH_ASSET_ID]: { table: "eth_chain_ledger", unitsColumn: "unified_pool_units", chainIds: ETH_CHAIN_IDS },
};

/**
 * Ensures a ledger row exists for an asset, and reconciles it against the
 * real total (on-chain BTC sum, or a live-fetched USDT balance) whenever
 * that total has grown — e.g. a fresh deposit landed on-chain since we
 * last looked. New/unallocated coins are credited to Funding by default,
 * matching how deposits land on funding accounts on real exchanges;
 * they only move to Unified via an explicit transfer.
 *
 * This never *removes* sats that are already allocated — if the real
 * total somehow reads lower than funding+unified (e.g. a stale read
 * mid-sync), we leave the ledger alone rather than guess which bucket
 * to shrink.
 */
async function reconcile(assetId, realTotalSats) {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT * FROM account_balances WHERE asset_id = ?`,
    [assetId]
  );

  if (!row) {
    await db.runAsync(
      `INSERT INTO account_balances (asset_id, funding_sats, unified_sats) VALUES (?, ?, 0)`,
      [assetId, realTotalSats]
    );
    return;
  }

  const allocated = row.funding_sats + row.unified_sats;
  const unallocated = realTotalSats - allocated;
  if (unallocated > 0) {
    await db.runAsync(
      `UPDATE account_balances SET funding_sats = funding_sats + ? WHERE asset_id = ?`,
      [unallocated, assetId]
    );
  }
}

/**
 * Returns { funding, unified, total } in base units (sats for BTC, the
 * asset's own base unit otherwise) for one asset, after reconciling
 * against the real balance passed in. Callers own fetching the real
 * total (on-chain sum for BTC via getTotalBalance, live RPC lookup for
 * USDT variants) since that path already differs per asset elsewhere
 * in the app (see HomeScreen's loadOtherBalances).
 */
export async function getAccountBalances(assetId, realTotalSats) {
  await reconcile(assetId, realTotalSats);
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT * FROM account_balances WHERE asset_id = ?`,
    [assetId]
  );
  return {
    funding: row?.funding_sats ?? 0,
    unified: row?.unified_sats ?? 0,
    total: (row?.funding_sats ?? 0) + (row?.unified_sats ?? 0),
  };
}

/** Convenience wrapper for BTC specifically, using the on-chain UTXO total. */
export async function getBtcAccountBalances() {
  const total = await getTotalBalance();
  return getAccountBalances("BTC", total);
}

/**
 * Same idea as getBtcAccountBalances but for the synthetic pooled 'USDT'
 * row: fetches live balances across all three chain variants, sums them
 * into micros, and reconciles account_balances('USDT') against that sum.
 * New/unallocated pooled USDT lands in Funding by default, same as BTC —
 * though in practice Funding-side USDT display should still use the real
 * per-chain USDT_TRC20/ERC20/BEP20 balances (see HomeScreen), since this
 * pooled row only exists to give Unified one tradeable USDT number.
 */
export async function getPooledUsdtAccountBalances() {
  const { totalMicros } = await fetchPooledUsdtBalance();
  return getAccountBalances(POOLED_USDT_ASSET_ID, Number(totalMicros));
}

/**
 * Same idea as getPooledUsdtAccountBalances, for the pooled 'ETH' row —
 * live-fetches all three ETH chain variants, sums them into pool units
 * (see ethPool.js), and reconciles account_balances('ETH') against that.
 */
export async function getPooledEthAccountBalances() {
  const { totalPoolUnits } = await fetchPooledEthBalance();
  return getAccountBalances(POOLED_ETH_ASSET_ID, Number(totalPoolUnits));
}

/**
 * Debits pooled unified units (in whatever pool-unit the config's table
 * uses) from specific real chains, largest balance first, so a later
 * unified_to_funding transfer knows which chain(s) to credit back in
 * Funding. Generic over POOL_CONFIG rather than one copy per asset.
 */
async function debitUnifiedFromChains(db, poolAssetId, unitsToDebit) {
  const { table, unitsColumn } = POOL_CONFIG[poolAssetId];
  const rows = await db.getAllAsync(`SELECT * FROM ${table} ORDER BY ${unitsColumn} DESC`);
  let remaining = unitsToDebit;
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(row[unitsColumn], remaining);
    if (take > 0) {
      await db.runAsync(`UPDATE ${table} SET ${unitsColumn} = ${unitsColumn} - ? WHERE chain_asset_id = ?`, [take, row.chain_asset_id]);
      remaining -= take;
    }
  }
  // Any shortfall (e.g. chain ledger hasn't caught up with a fresh
  // reconcile yet) is absorbed against the first known chain rather than
  // thrown, since account_balances is the real source of truth for
  // "does Unified have enough" — this per-chain table is bookkeeping for
  // payout routing, not a second balance check.
  if (remaining > 0 && rows.length > 0) {
    await db.runAsync(`UPDATE ${table} SET ${unitsColumn} = ${unitsColumn} - ? WHERE chain_asset_id = ?`, [remaining, rows[0].chain_asset_id]);
  }
}

/** Credits pooled unified units onto a chosen chain's ledger row (defaults to the pool's first chain). */
async function creditUnifiedToChain(db, poolAssetId, unitsToCredit, preferredChainId) {
  const { table, unitsColumn, chainIds } = POOL_CONFIG[poolAssetId];
  const chainId = preferredChainId || chainIds[0];
  await db.runAsync(`INSERT OR IGNORE INTO ${table} (chain_asset_id, ${unitsColumn}) VALUES (?, 0)`, [chainId]);
  await db.runAsync(`UPDATE ${table} SET ${unitsColumn} = ${unitsColumn} + ? WHERE chain_asset_id = ?`, [unitsToCredit, chainId]);
}

/**
 * Move sats between Funding and Unified for one asset. Purely a ledger
 * operation — no blockchain tx, no fee, instant. Rejects if the source
 * bucket doesn't have enough, so the split can never go negative or
 * exceed the real total.
 */
export async function transferBetweenAccounts(assetId, direction, amountSats) {
  if (amountSats <= 0) throw new Error("Transfer amount must be positive.");
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT * FROM account_balances WHERE asset_id = ?`,
    [assetId]
  );
  if (!row) throw new Error("No balance to transfer — sync your wallet first.");

  if (direction === "funding_to_unified") {
    if (row.funding_sats < amountSats) throw new Error("Insufficient Funding balance.");
    await db.runAsync(
      `UPDATE account_balances SET funding_sats = funding_sats - ?, unified_sats = unified_sats + ? WHERE asset_id = ?`,
      [amountSats, amountSats, assetId]
    );
    if (POOL_CONFIG[assetId]) {
      await creditUnifiedToChain(db, assetId, amountSats);
    }
  } else if (direction === "unified_to_funding") {
    if (row.unified_sats < amountSats) throw new Error("Insufficient Unified Trading balance.");
    await db.runAsync(
      `UPDATE account_balances SET unified_sats = unified_sats - ?, funding_sats = funding_sats + ? WHERE asset_id = ?`,
      [amountSats, amountSats, assetId]
    );
    if (POOL_CONFIG[assetId]) {
      await debitUnifiedFromChains(db, assetId, amountSats);
    }
  } else {
    throw new Error(`Unknown transfer direction: ${direction}`);
  }

  await db.runAsync(
    `INSERT INTO internal_transfers (asset_id, direction, amount_sats, created_at) VALUES (?, ?, ?, ?)`,
    [assetId, direction, amountSats, Date.now()]
  );
}

export { debitUnifiedFromChains, creditUnifiedToChain };

export async function getTransferHistory(assetId = null, limit = 50) {
  const db = await getDb();
  if (assetId) {
    return db.getAllAsync(
      `SELECT * FROM internal_transfers WHERE asset_id = ? ORDER BY created_at DESC LIMIT ?`,
      [assetId, limit]
    );
  }
  return db.getAllAsync(
    `SELECT * FROM internal_transfers ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}
