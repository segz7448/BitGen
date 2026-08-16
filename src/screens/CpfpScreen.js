import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { colors, spacing } from "../theme";
import { getDb } from "../db/database";
import { loadMnemonic, loadPassphrase } from "../wallet/secureSeed";
import { isWatchOnly } from "../wallet/walletMode";
import { buildCpfpTx } from "../wallet/txBuilder";
import { fetchFeeEstimates, fetchTxDetails, broadcastTx } from "../network/esplora";
import { getUtxosForTx, markUtxosSpent } from "../wallet/sync";
import { addAddress } from "../db/addressRepo";

function formatSats(sats) {
  return (sats / 100_000_000).toFixed(8);
}

export default function CpfpScreen({ route, navigation }) {
  const { txid } = route.params;
  const [tx, setTx] = useState(null);
  const [utxos, setUtxos] = useState([]);
  const [parent, setParent] = useState(null);
  const [fees, setFees] = useState(null);
  const [selectedRate, setSelectedRate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bumping, setBumping] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    (async () => {
      const wo = await isWatchOnly();
      setWatchOnly(wo);
      if (wo) {
        setLoading(false);
        return;
      }

      try {
        const db = await getDb();
        const row = await db.getFirstAsync(`SELECT * FROM transactions WHERE txid = ?`, [txid]);
        setTx(row);

        const spendable = await getUtxosForTx(txid);
        if (spendable.length === 0) {
          throw new Error(
            "No spendable output from this transaction was found — it may have already been spent or moved."
          );
        }
        setUtxos(spendable);

        const parentInfo = await fetchTxDetails(txid);
        setParent(parentInfo);

        const est = await fetchFeeEstimates().catch(() => ({ fast: 20, medium: 8, slow: 2 }));
        setFees(est);
        setSelectedRate(est.fast);
      } catch (e) {
        setLoadError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [txid]);

  const totalInputValue = utxos.reduce((s, u) => s + u.value, 0);

  const bump = async () => {
    setBumping(true);
    try {
      const mnemonic = await loadMnemonic();
      const passphrase = await loadPassphrase();
      const db = await getDb();
      const changeRow = await db.getFirstAsync(
        `SELECT MAX(derivation_index) as maxIdx FROM addresses WHERE change_type = 1 AND asset_id = 'BTC'`
      );
      const changeIndex = (changeRow?.maxIdx ?? -1) + 1;

      const { txHex, txid: childTxid, fee, sweepAddress, packageFeeRate } = buildCpfpTx({
        mnemonic,
        passphrase,
        utxos,
        parentFeeSats: parent.fee,
        parentVsize: parent.vsize,
        targetFeeRateSatPerVb: selectedRate,
        changeIndex,
      });

      await broadcastTx(txHex);
      await addAddress({ address: sweepAddress, index: changeIndex, change: 1 });
      await markUtxosSpent(utxos);

      await db.runAsync(
        `INSERT OR REPLACE INTO transactions (txid, amount_sats, fee_sats, direction, confirmed, timestamp, counterparty_address, raw_json)
         VALUES (?, ?, ?, 'out', 0, ?, ?, ?)`,
        [
          childTxid,
          -fee,
          fee,
          Date.now(),
          sweepAddress,
          JSON.stringify({ cpfpOf: txid, note: "CPFP child transaction" }),
        ]
      );

      Alert.alert(
        "CPFP broadcast",
        `A child transaction paying ${formatSats(fee)} BTC in fees was broadcast to pull the whole package to ~${packageFeeRate.toFixed(
          1
        )} sat/vB:\n${childTxid}`,
        [{ text: "OK", onPress: () => navigation.navigate("Home") }]
      );
    } catch (e) {
      Alert.alert("CPFP failed", e.message);
    } finally {
      setBumping(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.orange} />
      </View>
    );
  }

  if (watchOnly) {
    return (
      <View style={styles.container}>
        <Text style={styles.watchOnlyNotice}>
          This is a watch-only wallet — it can view balances but has no private key on this device,
          so it can't sign a CPFP transaction.
        </Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>Can't bump this transaction</Text>
        <Text style={styles.body}>{loadError}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Speed Up Incoming Payment</Text>
      <Text style={styles.body}>
        This transaction is stuck at too low a fee to confirm, and since someone else sent it, RBF
        can't touch it — only they could replace it. Instead, this spends the {formatSats(totalInputValue)}{" "}
        BTC it paid you into a new "child" transaction with a high enough fee that miners are
        incentivized to confirm both together (Child-Pays-For-Parent).
      </Text>

      {!!parent && (
        <Text style={styles.subBody}>
          Parent is currently paying ~{(parent.fee / Math.max(parent.vsize, 1)).toFixed(1)} sat/vB.
          Pick a rate below for the combined package.
        </Text>
      )}

      <View style={styles.feeRow}>
        {["slow", "medium", "fast"].map((speed) => (
          <TouchableOpacity
            key={speed}
            style={[styles.feeOption, selectedRate === fees[speed] && styles.feeOptionSelected]}
            onPress={() => setSelectedRate(fees[speed])}
          >
            <Text style={styles.feeOptionText}>{fees[speed]} sat/vB</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.button} onPress={bump} disabled={bumping}>
        {bumping ? <ActivityIndicator color="#0B0B0F" /> : <Text style={styles.buttonText}>Broadcast CPFP</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing(3) },
  heading: { fontSize: 20, color: colors.text, fontWeight: "700", marginBottom: spacing(1) },
  body: { fontSize: 13, color: colors.subtext, marginBottom: spacing(2), lineHeight: 19 },
  subBody: { fontSize: 12, color: colors.subtext, marginBottom: spacing(3), lineHeight: 18 },
  feeRow: { flexDirection: "row", gap: spacing(1), marginBottom: spacing(3) },
  feeOption: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(1.5), alignItems: "center" },
  feeOptionSelected: { borderColor: colors.orange, backgroundColor: "#2A1F0F" },
  feeOptionText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  button: { backgroundColor: colors.orange, borderRadius: 14, paddingVertical: spacing(2), alignItems: "center" },
  buttonText: { color: "#0B0B0F", fontWeight: "700", fontSize: 16 },
  watchOnlyNotice: { color: colors.subtext, fontSize: 14, textAlign: "center", padding: spacing(4), lineHeight: 20 },
});
