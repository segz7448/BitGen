import { getDb } from "./database";
import { getTotalBalance } from "./addressRepo";
import { fetchPooledUsdtBalance, USDT_CHAIN_IDS } from "../network/usdtPool";

export const ACCOUNTS = {
  FUNDING: "funding",
  UNIFIED: "unified",
};

export const POOLED_USDT_ASSET_ID = "USDT";

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
 * Debits pooled unified USDT (in micros) from specific chains, largest
 * balance first, updating usdt_chain_ledger so a later unified_to_funding
 * transfer knows which real chain(s) to credit back in Funding. Used
 * internally by transferBetweenAccounts for POOLED_USDT_ASSET_ID and by
 * the trade engine when a 'buy' fill consumes USDT.
 */
async function debitUnifiedUsdtFromChains(db, microsToDebit) {
  const rows = await db.getAllAsync(`SELECT * FROM usdt_chain_ledger ORDER BY unified_micros DESC`);
  let remaining = microsToDebit;
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(row.unified_micros, remaining);
    if (take > 0) {
      await db.runAsync(
        `UPDATE usdt_chain_ledger SET unified_micros = unified_micros - ? WHERE chain_asset_id = ?`,
        [take, row.chain_asset_id]
      );
      remaining -= take;
    }
  }
  // Any shortfall (e.g. chain ledger hasn't caught up with a fresh
  // reconcile yet) is absorbed against the first known chain rather than
  // thrown, since account_balances is the real source of truth for
  // "does Unified have enough" — this per-chain table is bookkeeping for
  // payout routing, not a second balance check.
  if (remaining > 0 && rows.length > 0) {
    await db.runAsync(
      `UPDATE usdt_chain_ledger SET unified_micros = unified_micros - ? WHERE chain_asset_id = ?`,
      [remaining, rows[0].chain_asset_id]
    );
  }
}

/** Credits pooled unified USDT onto a chosen chain's ledger row (defaults to the first chain). */
async function creditUnifiedUsdtToChain(db, microsToCredit, preferredChainId = USDT_CHAIN_IDS[0]) {
  await db.runAsync(
    `INSERT OR IGNORE INTO usdt_chain_ledger (chain_asset_id, unified_micros) VALUES (?, 0)`,
    [preferredChainId]
  );
  await db.runAsync(
    `UPDATE usdt_chain_ledger SET unified_micros = unified_micros + ? WHERE chain_asset_id = ?`,
    [microsToCredit, preferredChainId]
  );
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
    if (assetId === POOLED_USDT_ASSET_ID) {
      await creditUnifiedUsdtToChain(db, amountSats);
    }
  } else if (direction === "unified_to_funding") {
    if (row.unified_sats < amountSats) throw new Error("Insufficient Unified Trading balance.");
    await db.runAsync(
      `UPDATE account_balances SET unified_sats = unified_sats - ?, funding_sats = funding_sats + ? WHERE asset_id = ?`,
      [amountSats, amountSats, assetId]
    );
    if (assetId === POOLED_USDT_ASSET_ID) {
      await debitUnifiedUsdtFromChains(db, amountSats);
    }
  } else {
    throw new Error(`Unknown transfer direction: ${direction}`);
  }

  await db.runAsync(
    `INSERT INTO internal_transfers (asset_id, direction, amount_sats, created_at) VALUES (?, ?, ?, ?)`,
    [assetId, direction, amountSats, Date.now()]
  );
}

export { debitUnifiedUsdtFromChains, creditUnifiedUsdtToChain };

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
