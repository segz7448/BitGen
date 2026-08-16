import TronWeb from "tronweb";
import { deriveTronKeyPair } from "../wallet/tronWallet";

const TRON_FULL_NODE = "https://api.trongrid.io";
// TronGrid rate-limits unkeyed requests fairly aggressively. Get a free key
// at https://www.trongrid.io/ if you hit 403s under load.
//
// Same pattern as changeNowClient.js: read from an EXPO_PUBLIC_ env var
// instead of hardcoding, so it's not committed to source and doesn't trip
// GitHub's secret scanning. Local dev: put it in a gitignored .env as
// EXPO_PUBLIC_TRONGRID_API_KEY=your-key-here
const TRONGRID_API_KEY = process.env.EXPO_PUBLIC_TRONGRID_API_KEY || "";

export function getTronWeb(privateKeyHex = null) {
  const headers = TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {};
  return new TronWeb({
    fullHost: TRON_FULL_NODE,
    headers,
    privateKey: privateKeyHex || undefined,
  });
}

/** Returns the raw base-unit (6-decimal) TRC20 balance as a BigInt. */
export async function getTrc20Balance(address, contractAddress) {
  const res = await fetch(`${TRON_FULL_NODE}/v1/accounts/${address}`, {
    headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {},
  });
  const data = await res.json();
  const account = data?.data?.[0];
  if (!account?.trc20) return 0n;
  for (const entry of account.trc20) {
    if (entry[contractAddress] !== undefined) return BigInt(entry[contractAddress]);
  }
  return 0n;
}

/** Native TRX balance — needed because TRC20 transfers burn TRX for energy/bandwidth if the account has none staked. */
export async function getTrxBalance(address) {
  const res = await fetch(`${TRON_FULL_NODE}/v1/accounts/${address}`, {
    headers: TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {},
  });
  const data = await res.json();
  const account = data?.data?.[0];
  return BigInt(account?.balance ?? 0); // sun (1 TRX = 1_000_000 sun)
}

/**
 * Sign and broadcast a TRC20 transfer. amountBaseUnits must be in the
 * token's smallest unit (6 decimals for USDT-TRC20) as a BigInt or string.
 */
export async function sendTrc20Transfer({ mnemonic, index, change = 0, passphrase = "", contractAddress, toAddress, amountBaseUnits }) {
  const { privateKeyHex } = deriveTronKeyPair(mnemonic, index, change, passphrase);
  const tronWeb = getTronWeb(privateKeyHex);

  if (!tronWeb.isAddress(toAddress)) throw new Error("Invalid Tron recipient address.");

  const trxBalance = await getTrxBalance(tronWeb.defaultAddress.base58);
  if (trxBalance === 0n) {
    throw new Error(
      "This Tron address has 0 TRX. TRC20 transfers need a small amount of TRX for bandwidth/energy " +
        "unless the account has staked resources — send a small amount of TRX here first."
    );
  }

  const contract = await tronWeb.contract().at(contractAddress);
  const txid = await contract.transfer(toAddress, amountBaseUnits.toString()).send();
  return { txid, explorerUrl: `https://tronscan.org/#/transaction/${txid}` };
}
