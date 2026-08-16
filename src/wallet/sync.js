import { getDb } from "../db/database";
import { getAllAddresses, updateAddressBalance, addAddress } from "../db/addressRepo";
import { syncAddresses, fetchAddressInfo, fetchTxHistory } from "../network/esplora";
import { deriveAddress, deriveAddressFromXpub } from "./hdWallet";

const GAP_LIMIT = 20;

/**
 * Refresh balances/UTXOs for every address BITGEN knows about — active AND
 * inactive. Inactive just means "hidden from the picker"; the wallet must
 * keep watching it, because Bitcoin doesn't know or care that the user
 * disabled it in the app. Funds sent to a disabled address are still real
 * funds the user owns.
 */
export async function syncWallet() {
  const db = await getDb();
  const receiveAddrs = await getAllAddresses({ change: 0, includeInactive: true });
  const changeAddrs = await getAllAddresses({ change: 1, includeInactive: true });
  const all = [...receiveAddrs, ...changeAddrs];

  if (all.length === 0) return { total: 0, results: [] };

  const results = await syncAddresses(all.map((a) => a.address));

  for (const r of results) {
    await updateAddressBalance(r.address, r.info.totalSats);

    for (const utxo of r.utxos) {
      await db.runAsync(
        `INSERT OR IGNORE INTO utxos (txid, vout, address, value_sats, confirmed)
         VALUES (?, ?, ?, ?, ?)`,
        [utxo.txid, utxo.vout, utxo.address, utxo.value, utxo.confirmed ? 1 : 0]
      );
    }
  }

  const totalRow = await db.getFirstAsync(
    `SELECT COALESCE(SUM(balance_sats),0) as total FROM addresses`
  );

  return { total: totalRow.total, results };
}

/**
 * Spendable UTXOs across ALL active addresses, tagged with derivation path
 * for signing. By default only confirmed UTXOs are included — spending an
 * unconfirmed UTXO whose parent is still low-fee/unconfirmed can trigger
 * "min relay fee not met" / unconfirmed-chain errors from some nodes.
 * Pass includeUnconfirmed: true if the user explicitly opts in (e.g. no
 * confirmed funds available at all).
 */
export async function getSpendableUtxos({ includeUnconfirmed = false } = {}) {
  const db = await getDb();
  const confirmedClause = includeUnconfirmed ? "" : "AND u.confirmed = 1";
  const rows = await db.getAllAsync(`
    SELECT u.txid, u.vout, u.value_sats as value, u.address, u.confirmed,
           a.derivation_index, a.change_type
    FROM utxos u
    JOIN addresses a ON a.address = u.address
    WHERE u.spent = 0 AND a.is_active = 1 ${confirmedClause}
    ORDER BY u.value_sats DESC
  `);
  return rows.map((r) => ({
    txid: r.txid,
    vout: r.vout,
    value: r.value,
    address: r.address,
    confirmed: !!r.confirmed,
    path: { index: r.derivation_index, change: r.change_type },
  }));
}

/**
 * Our own unspent output(s) created by a specific transaction — used for
 * CPFP. Unlike getSpendableUtxos, this deliberately does NOT filter out
 * unconfirmed UTXOs: CPFP only makes sense on an unconfirmed parent, so
 * requiring confirmation here would defeat the entire point.
 */
export async function getUtxosForTx(txid) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `
    SELECT u.txid, u.vout, u.value_sats as value, u.address, u.confirmed,
           a.derivation_index, a.change_type
    FROM utxos u
    JOIN addresses a ON a.address = u.address
    WHERE u.txid = ? AND u.spent = 0
    `,
    [txid]
  );
  return rows.map((r) => ({
    txid: r.txid,
    vout: r.vout,
    value: r.value,
    address: r.address,
    confirmed: !!r.confirmed,
    path: { index: r.derivation_index, change: r.change_type },
  }));
}

/**
 * Mark UTXOs as spent locally right after a successful broadcast, so the
 * app doesn't try to spend them again before the next sync catches up.
 */
export async function markUtxosSpent(utxos) {
  const db = await getDb();
  for (const u of utxos) {
    await db.runAsync(`UPDATE utxos SET spent = 1 WHERE txid = ? AND vout = ?`, [u.txid, u.vout]);
  }
}

/**
 * Walk derivation indices past whatever's currently stored, checking each
 * address against Esplora, until GAP_LIMIT consecutive addresses in a row
 * have zero transaction history. This is the standard BIP44 discovery
 * algorithm — needed after importing a seed that has more history than
 * the small initial batch BITGEN derives on import.
 */
export async function gapLimitScan(mnemonic, { change = 0, passphrase = "", onProgress } = {}) {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT MAX(derivation_index) as maxIdx FROM addresses WHERE change_type = ? AND asset_id = 'BTC'`,
    [change]
  );
  let index = (row?.maxIdx ?? -1) + 1;
  let consecutiveUnused = 0;
  let found = 0;

  while (consecutiveUnused < GAP_LIMIT) {
    const derived = deriveAddress(mnemonic, index, change, passphrase);
    let info;
    try {
      info = await fetchAddressInfo(derived.address);
    } catch (e) {
      break; // network unreachable — stop scanning rather than loop forever
    }

    if (info.txCount > 0) {
      await addAddress(derived);
      await updateAddressBalance(derived.address, info.totalSats);
      consecutiveUnused = 0;
      found++;
    } else {
      consecutiveUnused++;
    }

    onProgress && onProgress({ index, found });
    index++;
  }

  return { addressesFound: found, lastIndexChecked: index - 1 };
}

/**
 * Same discovery algorithm as gapLimitScan, but for watch-only wallets —
 * derives addresses from an xpub/zpub instead of a mnemonic, so it can run
 * with no private key material on the device at all.
 */
export async function gapLimitScanXpub(xpub, { change = 0, onProgress } = {}) {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT MAX(derivation_index) as maxIdx FROM addresses WHERE change_type = ? AND asset_id = 'BTC'`,
    [change]
  );
  let index = (row?.maxIdx ?? -1) + 1;
  let consecutiveUnused = 0;
  let found = 0;

  while (consecutiveUnused < GAP_LIMIT) {
    const derived = deriveAddressFromXpub(xpub, index, change);
    let info;
    try {
      info = await fetchAddressInfo(derived.address);
    } catch (e) {
      break; // network unreachable — stop scanning rather than loop forever
    }

    if (info.txCount > 0) {
      await addAddress({ address: derived.address, index, change });
      await updateAddressBalance(derived.address, info.totalSats);
      consecutiveUnused = 0;
      found++;
    } else {
      consecutiveUnused++;
    }

    onProgress && onProgress({ index, found });
    index++;
  }

  return { addressesFound: found, lastIndexChecked: index - 1 };
}

/**
 * Pull full transaction history (not just current UTXOs/balance) for every
 * known address and upsert into the transactions table, so the History
 * screen reflects reality even for txs whose UTXOs have since been spent.
 */
export async function syncTransactionHistory() {
  const db = await getDb();
  const addrs = await getAllAddresses({ change: 0, includeInactive: true });
  const changeAddrs = await getAllAddresses({ change: 1, includeInactive: true });
  const known = new Set([...addrs, ...changeAddrs].map((a) => a.address));

  for (const addr of known) {
    let txs;
    try {
      txs = await fetchTxHistory(addr);
    } catch {
      continue;
    }

    for (const tx of txs) {
      const inputSum = tx.vin.reduce((s, v) => s + (known.has(v.prevout?.scriptpubkey_address) ? v.prevout.value : 0), 0);
      const outputToSelf = tx.vout.reduce((s, o) => s + (known.has(o.scriptpubkey_address) ? o.value : 0), 0);
      const outputToOthers = tx.vout.reduce((s, o) => s + (!known.has(o.scriptpubkey_address) ? o.value : 0), 0);

      const direction = inputSum > 0 ? "out" : "in";
      const amount = direction === "out" ? outputToOthers : outputToSelf;
      const counterparty =
        direction === "out"
          ? tx.vout.find((o) => !known.has(o.scriptpubkey_address))?.scriptpubkey_address || null
          : tx.vin.find((v) => v.prevout && !known.has(v.prevout.scriptpubkey_address))?.prevout?.scriptpubkey_address || null;

      // Upsert instead of INSERT OR REPLACE: a plain REPLACE deletes the
      // existing row and re-inserts it, which would silently wipe out
      // counterparty_label (a user-entered value not present in this
      // column list) back to its default every time this runs.
      await db.runAsync(
        `INSERT INTO transactions
         (txid, amount_sats, fee_sats, direction, confirmed, block_height, timestamp, counterparty_address, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(txid) DO UPDATE SET
           amount_sats = excluded.amount_sats,
           fee_sats = excluded.fee_sats,
           direction = excluded.direction,
           confirmed = excluded.confirmed,
           block_height = excluded.block_height,
           timestamp = excluded.timestamp,
           counterparty_address = excluded.counterparty_address,
           raw_json = excluded.raw_json`,
        [
          tx.txid,
          amount,
          tx.fee || 0,
          direction,
          tx.status.confirmed ? 1 : 0,
          tx.status.block_height || null,
          (tx.status.block_time || Date.now() / 1000) * 1000,
          counterparty,
          JSON.stringify(tx),
        ]
      );
    }
  }
}
