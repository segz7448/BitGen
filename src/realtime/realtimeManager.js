import { ethers } from "ethers";
import { getDb } from "../db/database";
import { getAllAddresses, getCurrentAddress } from "../db/addressRepo";
import { ASSET_IDS, getAsset } from "../wallet/assets";
import { fromBaseUnits } from "../wallet/units";
import { getNativeBalance } from "../network/evmClient";
import { ensureNotificationsReady, notifyOnce, notifyNow } from "../notifications/notificationService";
import { connectBtcRealtime } from "./btcRealtime";
import { connectEvmRealtime } from "./evmRealtime";
import { pollTronRealtime } from "./tronRealtime";
import { priceStore, startPriceStream, stopPriceStream } from "../store/priceStore";

/**
 * The single automatic entry point for "hardcore realtime" notifications:
 * BTC received, USDT received (all three chains), transaction confirmed,
 * and BTC price moves. There is no setting to turn any of this on — call
 * start() once (RootNavigator does this the moment a wallet exists) and
 * everything below runs for the lifetime of the app process.
 *
 * How "instant" each leg actually is (see the watcher files for detail):
 *   BTC          — true push (mempool.space websocket)
 *   USDT ERC20/BEP20 — true push (publicnode eth_subscribe logs)
 *   ETH/BNB native   — push-triggered check on every new block
 *   USDT TRC20 / TRX — 8s poll (no free Tron push endpoint exists)
 *   BTC price        — true push, reuses the existing live ticker
 *
 * Known addresses are re-read from the DB on a light interval so a newly
 * generated receive address (Receive screen, gap-limit scan, first-time
 * USDT address creation) gets picked up without the user doing anything.
 */

const ADDRESS_REFRESH_MS = 45_000;
const PRICE_ALERT_THRESHOLD_PCT = 1.5;
const PRICE_ALERT_MIN_INTERVAL_MS = 5 * 60 * 1000;

let running = false;
let addressRefreshTimer = null;
let btcHandle = null;
let evmHandles = {}; // chain -> handle
let tronHandle = null;
let priceUnsubscribe = null;
let evmNativeBalanceCache = {}; // chain -> last known balance (BigInt)

function formatBtc(sats) {
  const v = sats / 100_000_000;
  return `${v.toFixed(v < 0.001 ? 8 : 6).replace(/0+$/, "").replace(/\.$/, "")} BTC`;
}

async function getSetting(key) {
  const db = await getDb();
  const row = await db.getFirstAsync(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row?.value ?? null;
}

async function setSetting(key, value) {
  const db = await getDb();
  await db.runAsync(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, String(value)]);
}

// ---------------------------------------------------------------------
// BTC
// ---------------------------------------------------------------------

async function loadBtcAddresses() {
  const receive = await getAllAddresses({ change: 0, includeInactive: true, assetId: "BTC" });
  const change = await getAllAddresses({ change: 1, includeInactive: true, assetId: "BTC" });
  return [...receive, ...change].map((a) => a.address);
}

function txReceivedAmount(tx, knownSet, matchedAddress) {
  // Only "received" if none of the inputs are ours — otherwise this is
  // our own outgoing send (with change landing back on one of our own
  // addresses), which shouldn't fire a "received" push.
  const selfInitiated = (tx.vin || []).some((v) => knownSet.has(v.prevout?.scriptpubkey_address));
  if (selfInitiated) return 0;
  return (tx.vout || [])
    .filter((o) => o.scriptpubkey_address === matchedAddress)
    .reduce((sum, o) => sum + o.value, 0);
}

async function startBtcWatcher() {
  const addresses = await loadBtcAddresses();
  if (addresses.length === 0) return;
  const knownSet = new Set(addresses);

  btcHandle = connectBtcRealtime({
    addresses,
    onIncoming: async (address, tx) => {
      const amount = txReceivedAmount(tx, knownSet, address);
      if (amount <= 0) return;
      await notifyOnce(`btc:in:${tx.txid}`, {
        title: "BTC received",
        body: `${formatBtc(amount)} just landed in your wallet (unconfirmed).`,
        data: { screen: "History", txid: tx.txid },
      });
    },
    onConfirmed: async (address, tx) => {
      await notifyOnce(`btc:conf:${tx.txid}`, {
        title: "Transaction confirmed",
        body: `Your Bitcoin transaction just got its first confirmation.`,
        data: { screen: "History", txid: tx.txid },
      });
    },
  });
}

function refreshBtcWatcher(addresses) {
  btcHandle?.updateAddresses(addresses);
}

// ---------------------------------------------------------------------
// EVM (Ethereum + BSC USDT, plus native ETH/BNB)
// ---------------------------------------------------------------------

const EVM_CHAINS = [
  { chain: "ethereum", assetId: ASSET_IDS.USDT_ERC20, nativeSymbol: "ETH" },
  { chain: "bsc", assetId: ASSET_IDS.USDT_BEP20, nativeSymbol: "BNB" },
];

async function startEvmWatchers() {
  for (const { chain, assetId, nativeSymbol } of EVM_CHAINS) {
    if (evmHandles[chain]) continue; // already running — refresh loop calls this repeatedly
    const asset = getAsset(assetId);
    const addrRow = await getCurrentAddress(assetId);
    if (!addrRow) continue;
    const address = addrRow.address;

    evmHandles[chain] = connectEvmRealtime({
      chain,
      address,
      usdtContract: asset.contractAddress,
      onUsdtTransfer: async (log) => {
        const amountRaw = BigInt(log.data);
        const amount = fromBaseUnits(amountRaw, asset.decimals);
        await notifyOnce(`evm:usdt:${chain}:${log.transactionHash}:${log.logIndex}`, {
          title: "USDT received",
          body: `${amount} USDT received on ${asset.displayName}.`,
          data: { screen: "Home" },
        });
      },
      onNewBlock: async () => {
        try {
          const balance = await getNativeBalance(chain, address);
          const prev = evmNativeBalanceCache[chain];
          evmNativeBalanceCache[chain] = balance;
          if (prev != null && balance > prev) {
            const diff = balance - prev;
            await notifyOnce(`evm:native:${chain}:${balance.toString()}`, {
              title: `${nativeSymbol} received`,
              body: `${ethers.formatEther(diff)} ${nativeSymbol} just arrived in your wallet.`,
              data: { screen: "Home" },
            });
          }
        } catch {
          // transient RPC hiccup — next block will retry
        }
      },
    });
  }
}

// ---------------------------------------------------------------------
// Tron (USDT-TRC20 + native TRX)
// ---------------------------------------------------------------------

async function startTronWatcher() {
  const asset = getAsset(ASSET_IDS.USDT_TRC20);
  const addrRow = await getCurrentAddress(ASSET_IDS.USDT_TRC20);
  if (!addrRow) return;

  tronHandle = pollTronRealtime({
    address: addrRow.address,
    usdtContract: asset.contractAddress,
    apiKey: process.env.EXPO_PUBLIC_TRONGRID_API_KEY || "",
    onUsdtReceived: async (entry) => {
      const decimals = entry.token_info?.decimals ?? asset.decimals;
      const amount = fromBaseUnits(BigInt(entry.value), decimals);
      await notifyOnce(`tron:usdt:${entry.transaction_id}`, {
        title: "USDT received",
        body: `${amount} USDT received on ${asset.displayName}.`,
        data: { screen: "Home" },
      });
    },
    onTrxReceived: async (tx) => {
      const value = tx.raw_data?.contract?.[0]?.parameter?.value;
      if (!value?.amount) return;
      await notifyOnce(`tron:trx:${tx.txID}`, {
        title: "TRX received",
        body: `${(value.amount / 1_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} TRX just arrived in your wallet.`,
        data: { screen: "Home" },
      });
    },
  });
}

// ---------------------------------------------------------------------
// BTC price alerts — rides the existing true-push ticker in priceStore.
// ---------------------------------------------------------------------

async function startPriceWatcher() {
  startPriceStream(); // realtimeManager holds its own ref, independent of Home/Chart focus

  let lastAlertPrice = parseFloat(await getSetting("price_alert_last_price"));
  let lastAlertAt = parseInt(await getSetting("price_alert_last_at"), 10) || 0;
  if (Number.isNaN(lastAlertPrice)) lastAlertPrice = null;

  priceUnsubscribe = priceStore.subscribe((state) => {
    const price = state.ticker.usd;
    if (!price) return;

    if (lastAlertPrice == null) {
      lastAlertPrice = price;
      return;
    }

    const pctChange = ((price - lastAlertPrice) / lastAlertPrice) * 100;
    const now = Date.now();
    if (Math.abs(pctChange) >= PRICE_ALERT_THRESHOLD_PCT && now - lastAlertAt >= PRICE_ALERT_MIN_INTERVAL_MS) {
      const direction = pctChange > 0 ? "up" : "down";
      notifyNow({
        title: "BTC price alert",
        body: `Bitcoin is ${direction} ${Math.abs(pctChange).toFixed(1)}% to $${price.toLocaleString(undefined, {
          maximumFractionDigits: 0,
        })}.`,
        data: { screen: "Chart" },
      });
      lastAlertPrice = price;
      lastAlertAt = now;
      setSetting("price_alert_last_price", price).catch(() => {});
      setSetting("price_alert_last_at", now).catch(() => {});
    }
  });
}

function stopPriceWatcher() {
  priceUnsubscribe && priceUnsubscribe();
  priceUnsubscribe = null;
  stopPriceStream();
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/**
 * Start every watcher. Safe to call more than once — no-ops if already
 * running. Call as soon as a wallet exists (RootNavigator), independent
 * of PIN-lock state, so funds arriving while the app is on the lock
 * screen still notify immediately.
 */
export async function startRealtimeNotifications() {
  if (running) return;
  running = true;

  await ensureNotificationsReady();

  await Promise.all([startBtcWatcher(), startEvmWatchers(), startTronWatcher(), startPriceWatcher()]);

  addressRefreshTimer = setInterval(async () => {
    try {
      const addrs = await loadBtcAddresses();
      refreshBtcWatcher(addrs);

      // New USDT addresses (e.g. first-time setup happening after start())
      // don't yet have a running watcher — startEvmWatchers/startTronWatcher
      // both skip chains that are already running, so this is cheap.
      await startEvmWatchers();
      if (!tronHandle) await startTronWatcher();
    } catch {
      // best-effort refresh; next tick tries again
    }
  }, ADDRESS_REFRESH_MS);
}

export function stopRealtimeNotifications() {
  if (!running) return;
  running = false;

  if (addressRefreshTimer) {
    clearInterval(addressRefreshTimer);
    addressRefreshTimer = null;
  }
  btcHandle?.close();
  btcHandle = null;
  Object.values(evmHandles).forEach((h) => h?.close());
  evmHandles = {};
  tronHandle?.stop();
  tronHandle = null;
  stopPriceWatcher();
  evmNativeBalanceCache = {};
}
