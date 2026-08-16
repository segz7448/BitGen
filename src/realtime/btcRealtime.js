import { AppState } from "react-native";

/**
 * True push detection for BTC funds movement — a persistent WebSocket to
 * mempool.space's public node, not a "poll every N seconds and pretend
 * it's realtime" loop. The instant a tracked address appears in a new
 * mempool transaction OR a newly mined block, the server pushes it to us
 * — that's what makes "friend sends BTC, phone buzzes immediately" work
 * for the mempool-entry side (usually within a second or two of broadcast,
 * well before the first confirmation).
 *
 * Protocol (mempool.space /docs/api/websocket):
 *   send    {"track-addresses": ["bc1...", "bc1...", ...]}
 *   receive {"multi-address-transactions": {
 *              "<address>": { "mempool": [tx...], "confirmed": [tx...], "removed": [tx...] }
 *            }}
 * `mempool` entries are brand-new unconfirmed transactions touching that
 * address; `confirmed` entries are transactions that just got mined.
 *
 * This module owns only the transport (same shape as priceSocket.js) —
 * it hands raw esplora-style tx objects to the caller, which decides
 * direction/amount/notification text (see realtimeManager.js).
 */

const WS_URL = "wss://mempool.space/api/v1/ws";
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const STALE_CONNECTION_MS = 90_000; // mempool.space has no fixed heartbeat cadence; be lenient

// The public mempool.space instance caps how many addresses a single
// socket may track. Comfortably under typical server-side limits for a
// personal wallet's address set (receive + change, across gap-limit
// discovery) without needing per-user configuration.
const MAX_TRACKED_ADDRESSES = 40;

export function connectBtcRealtime({ addresses, onIncoming, onConfirmed, onOpen, onReconnecting, onClose }) {
  let ws = null;
  let attempt = 0;
  let closedByCaller = false;
  let staleTimer = null;
  let appStateSub = null;
  let backgrounded = false;
  let tracked = dedupeCap(addresses);

  function resetStaleTimer() {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      teardownSocket();
      scheduleReconnect();
    }, STALE_CONNECTION_MS);
  }

  function teardownSocket() {
    if (staleTimer) {
      clearTimeout(staleTimer);
      staleTimer = null;
    }
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        // already closed
      }
      ws = null;
    }
  }

  function scheduleReconnect() {
    if (closedByCaller || backgrounded) return;
    onReconnecting && onReconnecting();
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
    attempt++;
    setTimeout(open, delay);
  }

  function sendTrackList() {
    if (!ws || ws.readyState !== WebSocket.OPEN || tracked.length === 0) return;
    ws.send(JSON.stringify({ "track-addresses": tracked }));
  }

  function handleMessage(evt) {
    resetStaleTimer();
    let payload;
    try {
      payload = JSON.parse(evt.data);
    } catch {
      return;
    }

    const perAddress = payload["multi-address-transactions"];
    if (!perAddress) return;

    for (const address of Object.keys(perAddress)) {
      const bucket = perAddress[address] || {};
      for (const tx of bucket.mempool || []) {
        onIncoming && onIncoming(address, tx);
      }
      for (const tx of bucket.confirmed || []) {
        onConfirmed && onConfirmed(address, tx);
      }
    }
  }

  function open() {
    if (closedByCaller || backgrounded) return;
    teardownSocket();
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      attempt = 0;
      resetStaleTimer();
      sendTrackList();
      onOpen && onOpen();
    };
    ws.onmessage = handleMessage;
    ws.onerror = () => {
      // onclose follows per the WebSocket spec; let that drive reconnect.
    };
    ws.onclose = () => {
      onClose && onClose();
      scheduleReconnect();
    };
  }

  // Same battery/data discipline as the price socket: don't hold a live
  // connection while nobody could see the result anyway. On foreground
  // return, addresses may have changed (new receive address generated
  // while backgrounded) — reopen fresh rather than assume nothing moved.
  appStateSub = AppState.addEventListener("change", (next) => {
    if (next === "active") {
      if (backgrounded) {
        backgrounded = false;
        attempt = 0;
        open();
      }
    } else if (!backgrounded) {
      backgrounded = true;
      teardownSocket();
    }
  });

  open();

  return {
    /**
     * Update the watched address set without tearing down the socket
     * unnecessarily. Called by realtimeManager whenever it notices a new
     * address in the DB (new receive address, gap-limit scan, etc).
     */
    updateAddresses(nextAddresses) {
      const next = dedupeCap(nextAddresses);
      const changed = next.length !== tracked.length || next.some((a, i) => a !== tracked[i]);
      tracked = next;
      if (changed) sendTrackList();
    },
    close() {
      closedByCaller = true;
      teardownSocket();
      appStateSub && appStateSub.remove();
    },
  };
}

function dedupeCap(addresses) {
  return Array.from(new Set(addresses || [])).slice(0, MAX_TRACKED_ADDRESSES);
}
