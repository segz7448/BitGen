import { AppState } from "react-native";
import TronWeb from "tronweb";

/**
 * Tron detection for USDT-TRC20 + native TRX receipt.
 *
 * Unlike BTC (mempool.space websocket) and EVM (publicnode eth_subscribe),
 * there is no free, keyless, push-based endpoint for "tell me the instant
 * this Tron address receives something" — TronGrid's public API is
 * request/response only. Rather than skip Tron or silently degrade to
 * BITGEN's existing 15s home-screen refresh, this runs its own tight
 * poll loop against TronGrid's transaction-history endpoints. Tron
 * confirms blocks roughly every 3 seconds, so an 8s interval means an
 * incoming payment is typically caught within one poll cycle — not a
 * push, but close enough in practice to feel realtime, and it runs
 * continuously and automatically like every other watcher here.
 *
 * (If you add a TronGrid API key in .env — see tronClient.js — this
 * polls the same authenticated endpoint, just with a much higher rate
 * limit headroom.)
 */

const POLL_MS = 8_000;
const REQUEST_TIMEOUT_MS = 8_000;
const TRON_API = "https://api.trongrid.io";

async function fetchJson(url, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : {},
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.address           our Tron address
 * @param {string} opts.usdtContract       USDT-TRC20 contract address
 * @param {string} [opts.apiKey]
 * @param {(entry: object) => void} opts.onUsdtReceived  fired per new incoming TRC20 transfer
 * @param {(entry: object) => void} opts.onTrxReceived    fired per new incoming native TRX transfer
 */
export function pollTronRealtime({ address, usdtContract, apiKey, onUsdtReceived, onTrxReceived }) {
  let addr = address;
  let stopped = false;
  let backgrounded = false;
  let timer = null;

  async function tick() {
    if (stopped || backgrounded || !addr) return;

    const trc20Url = `${TRON_API}/v1/accounts/${addr}/transactions/trc20?limit=10&only_confirmed=true&only_to=true&contract_address=${usdtContract}&order_by=block_timestamp,desc`;
    const trc20 = await fetchJson(trc20Url, apiKey);
    if (trc20?.data) {
      for (const entry of trc20.data) {
        if (entry.to === addr) onUsdtReceived && onUsdtReceived(entry);
      }
    }

    const trxUrl = `${TRON_API}/v1/accounts/${addr}/transactions?limit=10&only_confirmed=true&order_by=block_timestamp,desc`;
    const trxHist = await fetchJson(trxUrl, apiKey);
    if (trxHist?.data) {
      for (const tx of trxHist.data) {
        const contract = tx.raw_data?.contract?.[0];
        if (contract?.type !== "TransferContract") continue;
        const value = contract.parameter?.value;
        if (!value?.to_address) continue;
        // TronGrid returns to_address hex-encoded (no base58 field) on
        // this endpoint, so decode it the same way tronWallet.js/tronClient.js
        // already do elsewhere before comparing against our base58 address.
        let toBase58;
        try {
          toBase58 = TronWeb.address.fromHex(value.to_address);
        } catch {
          continue;
        }
        if (toBase58 === addr) onTrxReceived && onTrxReceived(tx);
      }
    }
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, POLL_MS);
  }

  const appStateSub = AppState.addEventListener("change", (next) => {
    if (next === "active") {
      if (backgrounded) {
        backgrounded = false;
        tick();
        schedule();
      }
    } else if (!backgrounded) {
      backgrounded = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  });

  tick();
  schedule();

  return {
    updateAddress(nextAddress) {
      addr = nextAddress;
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      appStateSub.remove();
    },
  };
}
