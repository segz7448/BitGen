import { getDb } from "../db/database";

// Simple ordered fallback: try each configured server in priority order.
// None of these are "your" server — they're public infrastructure, same
// as what Electrum desktop / BlueWallet hit by default. Swap in a
// self-hosted Esplora/Electrs URL later for full privacy.
async function getServerList() {
  const db = await getDb();
  const rows = await db.getAllAsync(`SELECT url FROM electrum_servers ORDER BY priority ASC`);
  return rows.map((r) => r.url);
}

const REQUEST_TIMEOUT_MS = 15000;

async function fetchWithFallback(path, options = {}) {
  const servers = await getServerList();
  let lastError;
  for (const base of servers) {
    // React Native's fetch has no `timeout` option — it's silently ignored,
    // so a stalled request would otherwise hang forever instead of falling
    // back to the next server. Use a real AbortController-based timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, { ...options, signal: controller.signal });
      if (!res.ok) {
        lastError = new Error(`${base}${path} -> HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err.name === "AbortError" ? new Error(`${base}${path} -> timed out`) : err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("All Esplora servers unreachable");
}

/** Balance + tx count for a single address. */
export async function fetchAddressInfo(address) {
  const res = await fetchWithFallback(`/address/${address}`);
  const data = await res.json();
  const confirmed = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
  const unconfirmed = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
  return {
    address,
    confirmedSats: confirmed,
    unconfirmedSats: unconfirmed,
    totalSats: confirmed + unconfirmed,
    txCount: data.chain_stats.tx_count + data.mempool_stats.tx_count,
  };
}

/** Spendable UTXOs for an address. */
export async function fetchUtxos(address) {
  const res = await fetchWithFallback(`/address/${address}/utxo`);
  const data = await res.json();
  return data.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    value: u.value,
    confirmed: u.status.confirmed,
    address,
  }));
}

/** Transaction history for an address. */
export async function fetchTxHistory(address) {
  const res = await fetchWithFallback(`/address/${address}/txs`);
  return res.json();
}

/**
 * Full details for a single transaction — needed for CPFP, where we have
 * to know the parent's own fee and vsize to compute how much the child
 * needs to add on top to reach a target *package* fee rate.
 */
export async function fetchTxDetails(txid) {
  const res = await fetchWithFallback(`/tx/${txid}`);
  const data = await res.json();
  // Esplora gives weight (in weight units); vsize = ceil(weight / 4).
  // Fall back to `size` on servers that don't report `weight` for some reason.
  const vsize = data.weight ? Math.ceil(data.weight / 4) : data.size;
  return {
    txid: data.txid,
    fee: data.fee,
    vsize,
    confirmed: !!data.status?.confirmed,
    vout: data.vout,
  };
}

/** Current recommended fee rates (sat/vB) by confirmation target. */
export async function fetchFeeEstimates() {
  const res = await fetchWithFallback(`/fee-estimates`);
  const data = await res.json();
  return {
    fast: Math.ceil(data["1"] ?? data["2"] ?? 10),
    medium: Math.ceil(data["6"] ?? 5),
    slow: Math.ceil(data["144"] ?? 2),
  };
}

/** Broadcast a signed raw transaction. Returns the txid. */
export async function broadcastTx(txHex) {
  const res = await fetchWithFallback(`/tx`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: txHex,
  });
  return res.text(); // Esplora returns the txid as plain text on success
}

/** Sync a full list of addresses: balances + utxos, in parallel. */
export async function syncAddresses(addresses) {
  const results = await Promise.allSettled(
    addresses.map(async (a) => ({
      address: a,
      info: await fetchAddressInfo(a),
      utxos: await fetchUtxos(a),
    }))
  );
  return results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
}
