import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, ScrollView } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { colors, spacing } from "../theme";
import {
  getBtcAccountBalances,
  getPooledUsdtAccountBalances,
  transferBetweenAccounts,
  POOLED_USDT_ASSET_ID,
} from "../db/accountLedgerRepo";

const ASSET_PANELS = [
  { assetId: "BTC", label: "BTC", unitsPerWhole: 100_000_000, decimals: 8, fetchBalances: getBtcAccountBalances },
  { assetId: POOLED_USDT_ASSET_ID, label: "USDT", unitsPerWhole: 1_000_000, decimals: 2, fetchBalances: getPooledUsdtAccountBalances },
];

export default function TransferScreen() {
  const [assetIndex, setAssetIndex] = useState(0);
  const [direction, setDirection] = useState("funding_to_unified");
  const [balances, setBalances] = useState({ funding: 0, unified: 0 });
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const asset = ASSET_PANELS[assetIndex];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const b = await asset.fetchBalances();
      setBalances(b);
    } finally {
      setLoading(false);
    }
  }, [asset]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const maxForDirection = direction === "funding_to_unified" ? balances.funding : balances.unified;
  const maxDisplay = (maxForDirection / asset.unitsPerWhole).toFixed(asset.decimals);

  const submit = async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) {
      Alert.alert("Enter an amount", `Type how much ${asset.label} to move.`);
      return;
    }
    const units = Math.round(val * asset.unitsPerWhole);
    if (units > maxForDirection) {
      Alert.alert("Insufficient balance", "That's more than the source account holds.");
      return;
    }
    setSubmitting(true);
    try {
      await transferBetweenAccounts(asset.assetId, direction, units);
      setAmount("");
      await load();
      Alert.alert("Transfer complete", `Moved ${val} ${asset.label}.`);
    } catch (e) {
      Alert.alert("Transfer failed", e.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(3) }}>
      <Text style={styles.title}>Transfer between accounts</Text>
      <Text style={styles.subtitle}>
        Purely internal — no blockchain transaction, no fee, instant. Funding is plain custody;
        Unified backs open trades elsewhere in the app.
      </Text>

      <Text style={styles.label}>Coin</Text>
      <View style={styles.segmented}>
        {ASSET_PANELS.map((a, i) => (
          <TouchableOpacity
            key={a.assetId}
            style={[styles.segment, assetIndex === i && styles.segmentActive]}
            onPress={() => setAssetIndex(i)}
          >
            <Text style={[styles.segmentText, assetIndex === i && styles.segmentTextActive]}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Direction</Text>
      <View style={styles.segmented}>
        <TouchableOpacity
          style={[styles.segment, direction === "funding_to_unified" && styles.segmentActive]}
          onPress={() => setDirection("funding_to_unified")}
        >
          <Text style={[styles.segmentText, direction === "funding_to_unified" && styles.segmentTextActive]}>
            Funding → Unified
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segment, direction === "unified_to_funding" && styles.segmentActive]}
          onPress={() => setDirection("unified_to_funding")}
        >
          <Text style={[styles.segmentText, direction === "unified_to_funding" && styles.segmentTextActive]}>
            Unified → Funding
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.orange} style={{ marginTop: spacing(3) }} />
      ) : (
        <>
          <Text style={styles.available}>Available: {maxDisplay} {asset.label}</Text>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            placeholderTextColor={colors.subtext}
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
          />
          <TouchableOpacity style={styles.maxBtn} onPress={() => setAmount(maxDisplay)}>
            <Text style={styles.maxBtnText}>Use max</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#1A1300" /> : <Text style={styles.submitBtnText}>Transfer</Text>}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: spacing(0.5) },
  subtitle: { color: colors.subtext, fontSize: 12, lineHeight: 17, marginBottom: spacing(3) },
  label: { color: colors.subtext, fontSize: 12, marginBottom: spacing(1), marginTop: spacing(1) },
  segmented: { flexDirection: "row", backgroundColor: colors.card, borderRadius: 12, padding: 4, marginBottom: spacing(2) },
  segment: { flex: 1, paddingVertical: spacing(1.2), alignItems: "center", borderRadius: 9 },
  segmentActive: { backgroundColor: colors.orange },
  segmentText: { color: colors.subtext, fontSize: 13, fontWeight: "600" },
  segmentTextActive: { color: "#1A1300" },
  available: { color: colors.subtext, fontSize: 13, marginBottom: spacing(1) },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    padding: spacing(1.75), color: colors.text, fontSize: 18, marginBottom: spacing(1),
  },
  maxBtn: { alignSelf: "flex-end", marginBottom: spacing(2) },
  maxBtnText: { color: colors.orange, fontSize: 12, fontWeight: "600" },
  submitBtn: { backgroundColor: colors.orange, borderRadius: 14, paddingVertical: spacing(2), alignItems: "center", marginTop: spacing(2) },
  submitBtnText: { color: "#1A1300", fontWeight: "700", fontSize: 16 },
});
