import { ASSET_IDS, getAsset } from "./assets";
import { toBaseUnits } from "./units";
import { getSpendableUtxos, markUtxosSpent } from "./sync";
import { selectUtxos, buildAndSignTx } from "./txBuilder";
import { fetchFeeEstimates, broadcastTx } from "../network/esplora";
import { btcToSats } from "./validation";
import { addAddress } from "../db/addressRepo";
import { getDb } from "../db/database";
import { sendTrc20Transfer } from "../network/tronClient";
import { sendErc20Transfer } from "../network/evmClient";

/**
 * Send `amount` (human decimal string/number, in the asset's own unit —
 * BTC or USDT, not sats/base-units) of `assetId` to `toAddress`.
 * Returns { txid }.
 *
 * BTC follows the existing UTXO flow (same logic as SendScreen). The USDT
 * variants use index 0 / change 0 — the single reused address from
 * multiAssetAddress.js's getOrCreateAddress — since those are account-model
 * chains, not UTXO-based.
 */
export async function sendAsset({ assetId, mnemonic, passphrase = "", toAddress, amount }) {
  const asset = getAsset(assetId);

  if (assetId === ASSET_IDS.BTC) {
    return sendBtc({ mnemonic, passphrase, toAddress, amountBtc: String(amount) });
  }

  const amountBaseUnits = toBaseUnits(amount, asset.decimals);

  if (asset.chain === "tron") {
    const { txid } = await sendTrc20Transfer({
      mnemonic,
      passphrase,
      index: 0,
      change: 0,
      contractAddress: asset.contractAddress,
      toAddress,
      amountBaseUnits,
    });
    return { txid };
  }

  if (asset.chain === "ethereum" || asset.chain === "bsc") {
    const { txid } = await sendErc20Transfer({
      chain: asset.chain,
      mnemonic,
      passphrase,
      index: 0,
      change: 0,
      contractAddress: asset.contractAddress,
      toAddress,
      amountBaseUnits,
    });
    return { txid };
  }

  throw new Error(`No send implementation for ${assetId}`);
}

async function sendBtc({ mnemonic, passphrase, toAddress, amountBtc }) {
  const amountSats = btcToSats(amountBtc);
  let utxos = await getSpendableUtxos({ includeUnconfirmed: false });
  if (utxos.length === 0) utxos = await getSpendableUtxos({ includeUnconfirmed: true });
  if (utxos.length === 0) throw new Error("No spendable BTC funds found.");

  const fees = await fetchFeeEstimates().catch(() => ({ medium: 8 }));
  const feeRate = fees.medium ?? 8;
  const { selected } = selectUtxos(utxos, amountSats, feeRate);

  const db = await getDb();
  const row = await db.getFirstAsync(`SELECT MAX(derivation_index) as maxIdx FROM addresses WHERE change_type = 1 AND asset_id = 'BTC'`);
  const changeIndex = (row?.maxIdx ?? -1) + 1;

  const { txHex, txid, changeAddress } = buildAndSignTx({
    mnemonic,
    passphrase,
    utxos: selected,
    toAddress,
    amountSats,
    feeRateSatPerVb: feeRate,
    changeIndex,
    enableRbf: true,
  });

  await broadcastTx(txHex);
  await markUtxosSpent(selected);
  if (changeAddress) {
    await addAddress({ address: changeAddress, index: changeIndex, change: 1 });
  }

  return { txid };
}
