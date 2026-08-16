import { AppState } from "react-native";

/**
 * True push price feed — a real WebSocket connection to Binance's public
 * market-data stream, not a polling loop dressed up as one. No API key
 * required; this is Binance's public, unauthenticated stream endpoint.
 *
 * Stream subscribed: btcusdt@trade — fires on every executed trade on
 * Binance, typically multiple ticks per second. That single stream is the
 * source of the live headline price; the store layer (priceStore.js) uses
 * each tick to both update the ticker and patch the close/high/low of
 * whatever candle is currently "forming," so historical bars don't need
 * their own live stream.
 *
 * This module owns only the transport: connect, reconnect with backoff,
 * staleness detection, and app-foreground/background lifecycle. It knows
 * nothing about React or the app's state shape — callers get raw ticks via
 * callbacks and decide what to do with them (see src/store/priceStore.js).
 */

const STREAM_URL = "wss://stream.binance.com:9443/ws/btcusdt@trade";

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
// Binance sends a protocol-level ping; if we don't see *any* message for
// this long, treat the connection as dead and force a reconnect rather
// than trusting a socket that's silently stopped delivering.
const STALE_CONNECTION_MS = 20_000;

/**
 * @param {object} handlers
 * @param {(price: number, raw: object) => void} handlers.onTrade
 * @param {() => void} [handlers.onOpen]
 * @param {() => void} [handlers.onReconnecting]
 * @param {() => void} [handlers.onClose]
 * @returns {{ close: () => void }}
 */
export function connectPriceSocket({ onTrade, onOpen, onReconnecting, onClose }) {
  let ws = null;
  let attempt = 0;
  let closedByCaller = false;
  let staleTimer = null;
  let appStateSub = null;
  let backgrounded = false;

  function resetStaleTimer() {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      // No messages in a while — the socket may be a zombie (some mobile
      // network transitions leave a WebSocket "open" but dead). Force a
      // reconnect rather than silently going stale.
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

  function handleMessage(evt) {
    resetStaleTimer();
    let payload;
    try {
      payload = JSON.parse(evt.data);
    } catch {
      return;
    }
    if (payload.e !== "trade") return;
    const price = parseFloat(payload.p);
    if (!Number.isNaN(price)) onTrade && onTrade(price, payload);
  }

  function open() {
    if (closedByCaller || backgrounded) return;
    teardownSocket();
    ws = new WebSocket(STREAM_URL);

    ws.onopen = () => {
      attempt = 0;
      resetStaleTimer();
      onOpen && onOpen();
    };
    ws.onmessage = handleMessage;
    ws.onerror = () => {
      // onclose fires right after in the WebSocket spec; let that path
      // drive the reconnect so we don't double-schedule.
    };
    ws.onclose = () => {
      onClose && onClose();
      scheduleReconnect();
    };
  }

  // Pause the socket entirely while backgrounded — no point holding a
  // live connection (and draining battery/data) for a screen nobody can
  // see — then reconnect immediately on foreground return.
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
    close() {
      closedByCaller = true;
      teardownSocket();
      appStateSub && appStateSub.remove();
    },
  };
}
