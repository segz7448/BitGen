import "../polyfills";
import * as bitcoin from "bitcoinjs-lib";
import { NETWORK, deriveKeyPairForPath, deriveAddress } from "./hdWallet";

/**
 * Build and sign a transaction spending the given UTXOs to a destination
 * address, sending change back to a fresh internal (change) address.
 *
 * utxos: [{ txid, vout, value, address, path: { index, change } }]
 * feeRateSatPerVb: satoshis per virtual byte
 */
// RBF (BIP125): any input sequence number below 0xfffffffe signals the tx
// is replaceable. We use 0xfffffffd (max-1) — replaceable, but not opted
// into the (rarely supported) "opt-out of RBF by receiver" edge case.
const RBF_SEQUENCE = 0xfffffffd;

export function buildAndSignTx({
  mnemonic,
  passphrase = "",
  utxos,
  toAddress,
  amountSats,
  feeRateSatPerVb,
  changeIndex,
  enableRbf = true,
}) {
  const psbt = new bitcoin.Psbt({ network: NETWORK });

  let totalIn = 0;
  for (const utxo of utxos) {
    totalIn += utxo.value;
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      sequence: enableRbf ? RBF_SEQUENCE : 0xffffffff,
      witnessUtxo: {
        script: bitcoin.address.toOutputScript(utxo.address, NETWORK),
        value: utxo.value,
      },
    });
  }

  psbt.addOutput({ address: toAddress, value: amountSats });

  // Rough vbyte estimate for a P2WPKH tx: 10 + 68*inputs + 31*outputs (with change)
  const estVBytes = 10 + utxos.length * 68 + 2 * 31;
  const fee = Math.ceil(estVBytes * feeRateSatPerVb);

  const changeAmount = totalIn - amountSats - fee;
  if (changeAmount < 0) {
    throw new Error("Insufficient funds to cover amount + fee");
  }

  const changeAddr = deriveAddress(mnemonic, changeIndex, 1, passphrase);
  // Dust threshold for P2WPKH change ~294 sats — skip change output if below.
  if (changeAmount > 294) {
    psbt.addOutput({ address: changeAddr.address, value: changeAmount });
  }

  utxos.forEach((utxo, i) => {
    const keyPair = deriveKeyPairForPath(mnemonic, utxo.path.index, utxo.path.change, passphrase);
    psbt.signInput(i, keyPair);
  });

  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();

  return {
    txHex: tx.toHex(),
    txid: tx.getId(),
    fee,
    changeAddress: changeAmount > 294 ? changeAddr.address : null,
  };
}

/**
 * Rebuild and re-sign a replacement transaction for RBF fee-bumping.
 * Reuses the same inputs as the original (required for a valid RBF
 * replacement — you can't drop inputs, only add more or raise the fee),
 * recomputes the fee at a higher rate, and reduces the change output
 * accordingly. If change goes below dust, it's dropped entirely (fee
 * absorbs it) which is standard behavior.
 */
export function buildFeeBumpTx({
  mnemonic,
  passphrase = "",
  originalUtxos,
  toAddress,
  amountSats,
  newFeeRateSatPerVb,
  changeIndex,
}) {
  return buildAndSignTx({
    mnemonic,
    passphrase,
    utxos: originalUtxos,
    toAddress,
    amountSats,
    feeRateSatPerVb: newFeeRateSatPerVb,
    changeIndex,
    enableRbf: true,
  });
}

/**
 * Build a Child-Pays-For-Parent transaction.
 *
 * RBF only works on transactions *we* broadcast — it replaces our own
 * unconfirmed tx outright, which requires having signed the original
 * inputs. A stuck *incoming* transaction (someone paying us, stuck at a
 * fee rate that's too low to confirm) can't be replaced that way: we
 * don't hold the keys for its inputs, only for the output it pays to us.
 * CPFP works from the other end — spend that low-fee output in a new
 * "child" transaction with a high enough fee that miners are incentivized
 * to mine the parent + child together as a package, even though the
 * parent alone underpays.
 *
 * utxos: our own unspent output(s) created by the stuck parent tx (see
 * sync.getUtxosForTx). Usually just one, but a tx can pay us on more
 * than one output.
 * parentFeeSats / parentVsize: the parent's own fee and vsize, from
 * esplora.fetchTxDetails(parentTxid) — needed to compute how much the
 * child must add so the *combined* package clears the target rate.
 */
export function buildCpfpTx({
  mnemonic,
  passphrase = "",
  utxos,
  parentFeeSats,
  parentVsize,
  targetFeeRateSatPerVb,
  changeIndex,
}) {
  if (!utxos || utxos.length === 0) {
    throw new Error("Nothing to spend — this transaction's outputs to us are already spent or unavailable.");
  }

  const psbt = new bitcoin.Psbt({ network: NETWORK });

  let totalIn = 0;
  for (const utxo of utxos) {
    totalIn += utxo.value;
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      sequence: RBF_SEQUENCE,
      witnessUtxo: {
        script: bitcoin.address.toOutputScript(utxo.address, NETWORK),
        value: utxo.value,
      },
    });
  }

  // Single-output sweep back to a fresh address of ours — CPFP just needs
  // to spend the stuck output at a high enough fee; where the coins land
  // afterward (still fully ours) doesn't matter.
  const childVBytes = 10 + utxos.length * 68 + 31;
  const packageVBytes = childVBytes + parentVsize;
  const packageFeeNeeded = Math.ceil(packageVBytes * targetFeeRateSatPerVb);
  const childFeeForTarget = packageFeeNeeded - parentFeeSats;

  // The parent already contributes its own (too-low) fee. If that's
  // somehow enough on its own, the child still needs to pay at least a
  // minimal relay-safe fee (1 sat/vB) — it can never be free.
  const minChildFee = childVBytes;
  const fee = Math.max(childFeeForTarget, minChildFee);

  const outputAmount = totalIn - fee;
  if (outputAmount <= 0) {
    throw new Error("This amount is too small to cover the fee needed to unstick it via CPFP.");
  }

  const sweepAddr = deriveAddress(mnemonic, changeIndex, 1, passphrase);
  psbt.addOutput({ address: sweepAddr.address, value: outputAmount });

  utxos.forEach((utxo, i) => {
    const keyPair = deriveKeyPairForPath(mnemonic, utxo.path.index, utxo.path.change, passphrase);
    psbt.signInput(i, keyPair);
  });

  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();

  return {
    txHex: tx.toHex(),
    txid: tx.getId(),
    fee,
    sweepAddress: sweepAddr.address,
    packageFeeRate: (parentFeeSats + fee) / packageVBytes,
  };
}

/**
 * Simple coin selection: sort UTXOs largest-first, accumulate until we
 * cover amount + estimated fee. Not optimal (no branch-and-bound), but
 * predictable and easy to reason about for a first version.
 */
export function selectUtxos(utxos, amountSats, feeRateSatPerVb) {
  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  const selected = [];
  let total = 0;

  for (const utxo of sorted) {
    selected.push(utxo);
    total += utxo.value;
    const estVBytes = 10 + selected.length * 68 + 2 * 31;
    const fee = Math.ceil(estVBytes * feeRateSatPerVb);
    if (total >= amountSats + fee) {
      return { selected, fee, total };
    }
  }

  throw new Error("Insufficient balance across available UTXOs");
}
