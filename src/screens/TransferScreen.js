import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, ScrollView } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, useTheme } from "../theme";
import {
  getBtcAccountBalances,
  getPooledUsdtAccountBalances,
  transferBetweenAccounts,
  POOLED_USDT_ASSET_ID,
} from "../db/accountLedgerRepo";
import { GlassCard } from "../components/Glass";

const ASSET_PANELS = [
  { assetId: "BTC", label: "BTC", unitsPerWhole: 100_000_000, decimals: 8, fetchBalances: getBtcAccountBalances },
  { assetId: POOLED_USDT_ASSET_ID, label: "USDT", unitsPerWhole: 1_000_000, decimals: 2, fetchBalances: getPooledUsdtAccountBalances },
];

const ACCOUNT_LABEL = { funding: "Funding Account", unified: "Unified Trading Account" };

export default function TransferScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [assetIndex, setAssetIndex] = useState(0);
  const [direction, setDirection] = useState("funding_to_unified"); // "from_to" halves derived below
  const [balances, setBalances] = useState({ funding: 0, unified: 0 });
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [coinMenuOpen, setCoinMenuOpen] = useState(false);

  const asset = ASSET_PANELS[assetIndex];
  const [fromAccount, toAccount] = direction === "funding_to_unified" ? ["funding", "unified"] : ["unified", "funding"];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBalances(await asset.fetchBalances());
    } finally {
      setLoading(false);
    }
  }, [asset]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const maxForDirection = balances[fromAccount];
  const maxDisplay = (maxForDirection / asset.unitsPerWhole).toFixed(asset.decimals);
  const swapDirection = () => setDirection((d) => (d === "funding_to_unified" ? "unified_to_funding" : "funding_to_unified"));

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
      <View style={styles.headerTabs}>
        <Text style={styles.headerTabActive}>Within Account</Text>
      </View>

      <GlassCard style={styles.card}>
        <TouchableOpacity style={styles.accountRow} onPress={swapDirection}>
          <Text style={styles.accountRowLabel}>From</Text>
          <Text style={styles.accountRowValue}>{ACCOUNT_LABEL[fromAccount]}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.swapButton} onPress={swapDirection}>
          <Ionicons name="swap-vertical" size={18} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.accountRow}>
          <Text style={styles.accountRowLabel}>To</Text>
          <Text style={styles.accountRowValue}>{ACCOUNT_LABEL[toAccount]}</Text>
        </View>
      </GlassCard>

      <Text style={styles.label}>Coin</Text>
      <TouchableOpacity onPress={() => setCoinMenuOpen((o) => !o)}>
        <GlassCard style={styles.coinSelect}>
          <Text style={styles.coinSelectText}>{asset.label}</Text>
          <Ionicons name={coinMenuOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.subtext} />
        </GlassCard>
      </TouchableOpacity>
      {coinMenuOpen && (
        <View style={styles.coinMenu}>
          {ASSET_PANELS.map((a, i) => (
            <TouchableOpacity
              key={a.assetId}
              style={styles.coinMenuItem}
              onPress={() => { setAssetIndex(i); setCoinMenuOpen(false); }}
            >
              <Text style={[styles.coinMenuItemText, i === assetIndex && { color: colors.orange }]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={colors.orange} style={{ marginTop: spacing(3) }} />
      ) : (
        <>
          <Text style={styles.label}>Amount</Text>
          <GlassCard style={styles.amountCard}>
            <TextInput
              style={styles.input}
              placeholder="Please enter"
              placeholderTextColor={colors.subtext}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
            />
            <TouchableOpacity onPress={() => setAmount(maxDisplay)}>
              <Text style={styles.maxBtnText}>Max</Text>
            </TouchableOpacity>
            <Text style={styles.inputUnit}>{asset.label}</Text>
          </GlassCard>
          <Text style={styles.available}>Available  {maxDisplay} {asset.label}</Text>

          <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#1A1300" /> : <Text style={styles.submitBtnText}>Confirm</Text>}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    headerTabs: { marginBottom: spacing(2) },
    headerTabActive: { color: colors.text, fontSize: 15, fontWeight: "700", borderBottomWidth: 2, borderBottomColor: colors.orange, alignSelf: "flex-start", paddingBottom: 6 },
    card: { padding: spacing(2), marginBottom: spacing(3) },
    accountRow: { paddingVertical: spacing(1.25) },
    accountRowLabel: { color: colors.subtext, fontSize: 11, marginBottom: 4 },
    accountRowValue: { color: colors.text, fontSize: 16, fontWeight: "700" },
    swapButton: {
      alignSelf: "center", width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.border,
      alignItems: "center", justifyContent: "center", marginVertical: 2,
    },
    label: { color: colors.subtext, fontSize: 12, marginBottom: spacing(1) },
    coinSelect: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing(1.75) },
    coinSelectText: { color: colors.text, fontSize: 15, fontWeight: "600" },
    coinMenu: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginTop: 4, overflow: "hidden" },
    coinMenuItem: { padding: spacing(1.75) },
    coinMenuItemText: { color: colors.text, fontSize: 14, fontWeight: "600" },
    amountCard: { flexDirection: "row", alignItems: "center", padding: spacing(1.75), marginTop: spacing(2) },
    input: { flex: 1, color: colors.text, fontSize: 17 },
    maxBtnText: { color: colors.orange, fontSize: 13, fontWeight: "700", marginRight: spacing(1.5) },
    inputUnit: { color: colors.text, fontSize: 14, fontWeight: "600" },
    available: { color: colors.subtext, fontSize: 12, marginTop: spacing(1) },
    submitBtn: { backgroundColor: colors.orange, borderRadius: 14, paddingVertical: spacing(2), alignItems: "center", marginTop: spacing(4) },
    submitBtnText: { color: "#1A1300", fontWeight: "700", fontSize: 16 },
  });
}
