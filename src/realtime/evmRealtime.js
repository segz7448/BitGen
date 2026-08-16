import { AppState } from "react-native";

/**
 * True push detection for EVM chains (Ethereum + BSC) over a raw
 * JSON-RPC WebSocket to PublicNode's free endpoint — the same public
 * infra tier evmClient.js already uses over HTTP, just the WS sibling
 * (wss://ethereum-rpc.publicnode.com / wss://bsc-rpc.publicnode.com),
 * so no API key and nothing new to configure.
 *
 * Two subscriptions are opened per chain, both standard `eth_subscribe`:
 *
 *  - "logs" filtered to the USDT contract's Transfer(address,address,uint256)
 *    event with `to` == our address. This is genuinely push: the node
 *    notifies us the moment a block containing the transfer is mined —
 *    there is no polling involved for USDT receipt detection.
 *
 *  - "newHeads" (every new block). Native coin (ETH/BNB) transfers don't
 *    emit logs, so there's no equivalent push signal for "someone sent
 *    me ETH" on public infra. Instead, every new block triggers one
 *    lightweight eth_getBalance check for our address via the caller's
 *    balance-check callback — in practice this still means "notified
 *    within one block time" (~12s on Ethereum, ~3s on BSC), which is the
 *    best available without a paid archive/websocket-log provider.
 *
 * We deliberately don't use ethers.WebSocketProvider here — its Node-style
 * `ws` detection doesn't reliably match React Native's environment, so
 * this talks raw JSON-RPC over the platform's built-in WebSocket, same
 * pattern as priceSocket.js / btcRealtime.js.
 */

const CHAIN_WS = {
  ethereum: "wss://ethereum-rpc.publicnode.com",
  bsc: "wss://bsc-rpc.publicnode.com",
};

// keccak256("Transfer(address,address,uint256)") — the standard ERC20/BEP20 event topic.
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const STALE_CONNECTION_MS = 60_000;

function addressToTopic(address) {
  return "0x" + "0".repeat(24) + address.toLowerCase().replace(/^0x/, "");
}

/**
 * @param {object} opts
 * @param {"ethereum"|"bsc"} opts.chain
 * @param {string} opts.address        our wallet address on this chain
 * @param {string} opts.usdtContract   USDT contract address for this chain
 * @param {(log: object) => void} opts.onUsdtTransfer   fired per matching Transfer log
 * @param {(blockNumberHex: string) => void} opts.onNewBlock  fired per new block (caller does the balance check)
 */
export function connectEvmRealtime({ chain, address, usdtContract, onUsdtTransfer, onNewBlock, onOpen, onReconnecting, onClose }) {
  const url = CHAIN_WS[chain];
  if (!url) throw new Error(`No websocket endpoint configured for chain: ${chain}`);

  let ws = null;
  let attempt = 0;
  let closedByCaller = false;
  let staleTimer = null;
  let appStateSub = null;
  let backgrounded = false;
  let logsSubId = null;
  let headsSubId = null;
  let nextReqId = 1;

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
    logsSubId = null;
    headsSubId = null;
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

  function send(method, params) {
    const id = nextReqId++;
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return id;
  }

  let pendingLogsReqId = null;
  let pendingHeadsReqId = null;

  function subscribeAll() {
    pendingLogsReqId = send("eth_subscribe", [
      "logs",
      { address: usdtContract, topics: [TRANSFER_TOPIC, null, addressToTopic(address)] },
    ]);
    pendingHeadsReqId = send("eth_subscribe", ["newHeads"]);
  }

  function handleMessage(evt) {
    resetStaleTimer();
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }

    // Subscription acknowledgements
    if (msg.id != null && typeof msg.result === "string") {
      if (msg.id === pendingLogsReqId) logsSubId = msg.result;
      else if (msg.id === pendingHeadsReqId) headsSubId = msg.result;
      return;
    }

    // Subscription push events
    if (msg.method === "eth_subscription" && msg.params) {
      const { subscription, result } = msg.params;
      if (subscription === logsSubId && result) {
        onUsdtTransfer && onUsdtTransfer(result);
      } else if (subscription === headsSubId && result) {
        onNewBlock && onNewBlock(result.number);
      }
    }
  }

  function open() {
    if (closedByCaller || backgrounded) return;
    teardownSocket();
    ws = new WebSocket(url);

    ws.onopen = () => {
      attempt = 0;
      resetStaleTimer();
      subscribeAll();
      onOpen && onOpen();
    };
    ws.onmessage = handleMessage;
    ws.onerror = () => {};
    ws.onclose = () => {
      onClose && onClose();
      scheduleReconnect();
    };
  }

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
