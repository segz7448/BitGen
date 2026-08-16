import { getDb } from "./database";

// How long a fired-event record sticks around before it's eligible for
// cleanup. Only matters for keeping the table small — dedupe itself is
// correct forever, this is just housekeeping.
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * True if a notification for this exact event key has already been sent
 * (ever — not just this session). Keys are namespaced by the caller, e.g.
 * `btc:in:<txid>`, `btc:conf:<txid>`, `evm:usdt:<chain>:<txhash>:<logIndex>`.
 */
export async function hasNotified(eventKey) {
  const db = await getDb();
  const row = await db.getFirstAsync(`SELECT 1 FROM notified_events WHERE event_key = ?`, [eventKey]);
  return !!row;
}

/** Record that a notification for this event key was just sent. */
export async function markNotified(eventKey) {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO notified_events (event_key, created_at) VALUES (?, ?)`,
    [eventKey, Date.now()]
  );
}

/**
 * Atomically check-and-claim an event key in one step, so two watchers
 * (or a reconnect racing a poll tick) can't both slip past hasNotified()
 * before either has called markNotified() and double-fire the same alert.
 * Returns true if this call is the one that claimed it (i.e. go ahead and
 * notify); false if it was already claimed.
 */
export async function claimNotification(eventKey) {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO notified_events (event_key, created_at) VALUES (?, ?)`,
    [eventKey, Date.now()]
  );
  return result.changes > 0;
}

/** Occasional housekeeping — call opportunistically, not on a tight timer. */
export async function pruneOldNotifications() {
  const db = await getDb();
  await db.runAsync(`DELETE FROM notified_events WHERE created_at < ?`, [Date.now() - RETENTION_MS]);
}
