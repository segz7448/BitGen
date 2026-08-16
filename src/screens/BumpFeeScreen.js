import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { colors, spacing } from "../theme";
import { getDb } from "../db/database";
import { loadMnemonic, loadPassphrase } from "../wallet/secureSeed";
import { buildFeeBumpTx } from "../wallet/txBuilder";
import { fetchFeeEstimates, broadcastTx } from "../network/esplora";
import { addAddress } from "../db/addressRepo";

export default function BumpFeeScreen({ route, navigation }) {
  const { txid } = route.params;
  const [tx, setTx] = useState(null);
  const [fees, setFees] = useState(null);
  const [selectedRate, setSelectedRate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bumping, setBumping] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const row = await db.getFirstAsync(`SELECT * FROM transactions WHERE txid = ?`, [txid]);
      setTx(row);
      const est = await fetchFeeEstimates().catch(() => ({ fast: 20, medium: 8, slow: 2 }));
      setFees(est);
      setSelectedRate(est.fast); // default to a rate that'll actually get it unstuck
      setLoading(false);
    })();
  }, [txid]);

  const bump = async () => {
    if (!tx || !tx.raw_json) {
      Alert.alert("Can't bump this transaction", "Original input data wasn't found for this transaction.");
      return;
    }
    setBumping(true);
    try {
      const meta = JSON.parse(tx.raw_json);
      if (!meta.originalUtxos) throw new Error("This transaction wasn't recorded with rebroadcast data.");

      const mnemonic = await loadMnemonic();
      const passphrase = await loadPassphrase();
      const db = await getDb();
      const changeRow = await db.getFirstAsync(
        `SELECT MAX(derivation_index) as maxIdx FROM addresses WHERE change_type = 1 AND asset_id = 'BTC'`
      );
      const changeIndex = (changeRow?.maxIdx ?? -1) + 1;

      const { txHex, txid: newTxid, fee, changeAddress } = buildFeeBumpTx({
        mnemonic,
        passphrase,
        originalUtxos: meta.originalUtxos,
        toAddress: tx.counterparty_address,
        amountSats: Math.abs(tx.amount_sats),
        newFeeRateSatPerVb: selectedRate,
        changeIndex,
      });

      await broadcastTx(txHex);
      if (changeAddress) {
        await addAddress({ address: changeAddress, index: changeIndex, change: 1 });
      }
      await db.runAsync(`DELETE FROM transactions WHERE txid = ?`, [txid]);
      await db.runAsync(
        `INSERT OR REPLACE INTO transactions (txid, amount_sats, fee_sats, direction, confirmed, timestamp, counterparty_address, raw_json)
         VALUES (?, ?, ?, 'out', 0, ?, ?, ?)`,
        [newTxid, -Math.abs(tx.amount_sats), fee, Date.now(), tx.counterparty_address, JSON.stringify({ originalUtxos: meta.originalUtxos })]
      );

      Alert.alert("Fee bumped", `Replacement transaction broadcast:\n${newTxid}`, [
        { text: "OK", onPress: () => navigation.navigate("Home") },
      ]);
    } catch (e) {
      Alert.alert("Bump failed", e.message);
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

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Bump Transaction Fee</Text>
      <Text style={styles.body}>
        This replaces the pending transaction with an identical one at a higher fee, using RBF
        (Replace-By-Fee). The old transaction will be dropped once the new one confirms.
      </Text>

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
        {bumping ? <ActivityIndicator color="#0B0B0F" /> : <Text style={styles.buttonText}>Broadcast Replacement</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing(3) },
  heading: { fontSize: 20, color: colors.text, fontWeight: "700", marginBottom: spacing(1) },
  body: { fontSize: 13, color: colors.subtext, marginBottom: spacing(3), lineHeight: 19 },
  feeRow: { flexDirection: "row", gap: spacing(1), marginBottom: spacing(3) },
  feeOption: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(1.5), alignItems: "center" },
  feeOptionSelected: { borderColor: colors.orange, backgroundColor: "#2A1F0F" },
  feeOptionText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  button: { backgroundColor: colors.orange, borderRadius: 14, paddingVertical: spacing(2), alignItems: "center" },
  buttonText: { color: "#0B0B0F", fontWeight: "700", fontSize: 16 },
});
