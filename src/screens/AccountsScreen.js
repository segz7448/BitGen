import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, TextInput, Alert, ActivityIndicator } from "react-native";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { colors, spacing } from "../theme";
import {
  getBtcAccountBalances,
  getPooledUsdtAccountBalances,
  transferBetweenAccounts,
  POOLED_USDT_ASSET_ID,
} from "../db/accountLedgerRepo";
import { satsToFiat, formatFiat } from "../network/priceFeed";
import { useTicker, startPriceStream, stopPriceStream } from "../store/priceStore";
import { useDisplayCurrency } from "../hooks/useDisplayCurrency";

// One entry per asset this screen manages. `unitsPerWhole` converts
// display amount <-> base unit (sats for BTC, micros for pooled USDT).
// `toFiat` returns the live USD-equivalent price to feed satsToFiat with
// — USDT is a dollar stablecoin so it's priced at 1, not off the BTC
// ticker.
const ASSET_PANELS = [
  {
    assetId: "BTC",
    label: "BTC",
    unitsPerWhole: 100_000_000,
    decimals: 8,
    fetchBalances: getBtcAccountBalances,
    toFiat: (ticker) => ticker.usd,
  },
  {
    assetId: POOLED_USDT_ASSET_ID,
    label: "USDT",
    unitsPerWhole: 1_000_000,
    decimals: 2,
    fetchBalances: getPooledUsdtAccountBalances,
    toFiat: () => 1, // pooled USDT is priced 1:1 with USD by definition
  },
];

export default function AccountsScreen({ navigation }) {
  const [balancesByAsset, setBalancesByAsset] = useState({});
  const [loading, setLoading] = useState(true);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferAsset, setTransferAsset] = useState(ASSET_PANELS[0]);
  const [transferDir, setTransferDir] = useState("funding_to_unified");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isFocused = useIsFocused();
  const ticker = useTicker();
  const { currency } = useDisplayCurrency();

  React.useEffect(() => {
    if (!isFocused) return;
    startPriceStream();
    return () => stopPriceStream();
  }, [isFocused]);

  const load = useCallback(async () => {
    try {
      const entries = await Promise.all(
        ASSET_PANELS.map(async (panel) => [panel.assetId, await panel.fetchBalances()])
      );
      setBalancesByAsset(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openTransfer = (panel, direction) => {
    setTransferAsset(panel);
    setTransferDir(direction);
    setAmount("");
    setTransferOpen(true);
  };

  const balances = balancesByAsset[transferAsset.assetId] || { funding: 0, unified: 0 };
  const maxForDirection =
    transferDir === "funding_to_unified" ? balances.funding : balances.unified;
  const maxDisplay = (maxForDirection / transferAsset.unitsPerWhole).toFixed(transferAsset.decimals);

  const submitTransfer = async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) {
      Alert.alert("Enter an amount", `Type how much ${transferAsset.label} to move.`);
      return;
    }
    const units = Math.round(val * transferAsset.unitsPerWhole);
    if (units > maxForDirection) {
      Alert.alert("Insufficient balance", "That's more than the source account holds.");
      return;
    }
    setSubmitting(true);
    try {
      await transferBetweenAccounts(transferAsset.assetId, transferDir, units);
      await load();
      setTransferOpen(false);
    } catch (e) {
      Alert.alert("Transfer failed", e.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(3) }}>
      {loading ? (
        <ActivityIndicator color={colors.orange} style={{ marginTop: spacing(4) }} />
      ) : (
        ASSET_PANELS.map((panel) => {
          const b = balancesByAsset[panel.assetId] || { funding: 0, unified: 0, total: 0 };
          const fiatPrice = panel.toFiat(ticker);
          const fundingFiat = satsToFiat(b.funding, fiatPrice);
          const unifiedFiat = satsToFiat(b.unified, fiatPrice);
          const fmt = (units) => (units / panel.unitsPerWhole).toFixed(panel.decimals);

          return (
            <View key={panel.assetId}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Funding — {panel.label}</Text>
                <Text style={styles.cardHint}>
                  Plain custody. Your {panel.label} quantity here never changes on its own — only
                  price moves the value shown below, not the amount.
                </Text>
                <Text style={styles.balanceValue}>
                  {fmt(b.funding)} {panel.label}
                </Text>
                {fundingFiat != null && (
                  <Text style={styles.balanceFiat}>{formatFiat(fundingFiat, currency)}</Text>
                )}
                <TouchableOpacity
                  style={styles.transferBtn}
                  onPress={() => openTransfer(panel, "funding_to_unified")}
                  disabled={b.funding <= 0}
                >
                  <Text style={styles.transferBtnText}>Transfer to Unified →</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Unified Trading — {panel.label}</Text>
                <Text style={styles.cardHint}>
                  Backs open spot trades. Buying/selling here moves this balance directly —
                  Funding is never touched by a trade.
                </Text>
                <Text style={styles.balanceValue}>
                  {fmt(b.unified)} {panel.label}
                </Text>
                {unifiedFiat != null && (
                  <Text style={styles.balanceFiat}>{formatFiat(unifiedFiat, currency)}</Text>
                )}
                <TouchableOpacity
                  style={styles.transferBtn}
                  onPress={() => openTransfer(panel, "unified_to_funding")}
                  disabled={b.unified <= 0}
                >
                  <Text style={styles.transferBtnText}>← Transfer to Funding</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total {panel.label} (Funding + Unified)</Text>
                <Text style={styles.totalValue}>
                  {fmt(b.total)} {panel.label}
                </Text>
              </View>
            </View>
          );
        })
      )}

      <Modal visible={transferOpen} transparent animationType="slide" onRequestClose={() => setTransferOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {transferDir === "funding_to_unified" ? "Funding → Unified" : "Unified → Funding"} ·{" "}
              {transferAsset.label}
            </Text>
            <Text style={styles.modalSubtitle}>
              Available: {maxDisplay} {transferAsset.label}
            </Text>
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

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setTransferOpen(false)}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={submitTransfer}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#1A1300" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Transfer</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  tradeLink: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: colors.orange, borderRadius: 14, padding: spacing(2), marginBottom: spacing(2.5),
  },
  tradeLinkText: { color: "#1A1300", fontSize: 14, fontWeight: "700" },
  tradeLinkArrow: { color: "#1A1300", fontSize: 14, fontWeight: "700" },
  card: {
    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    padding: spacing(2.5), marginBottom: spacing(2),
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: spacing(1) },
  cardHint: { color: colors.subtext, fontSize: 12, lineHeight: 17, marginBottom: spacing(1.5) },
  balanceValue: { color: colors.text, fontSize: 24, fontWeight: "700" },
  balanceFiat: { color: colors.subtext, fontSize: 13, marginTop: 2, marginBottom: spacing(1.5) },
  transferBtn: {
    alignSelf: "flex-start", backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, paddingVertical: spacing(1), paddingHorizontal: spacing(1.5),
  },
  transferBtnText: { color: colors.orange, fontSize: 13, fontWeight: "600" },
  totalRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing(1), marginTop: spacing(1), marginBottom: spacing(3),
  },
  totalLabel: { color: colors.subtext, fontSize: 13 },
  totalValue: { color: colors.text, fontSize: 14, fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderWidth: 1, borderColor: colors.border, padding: spacing(3),
  },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: "700", marginBottom: 4 },
  modalSubtitle: { color: colors.subtext, fontSize: 13, marginBottom: spacing(2) },
  input: {
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    padding: spacing(1.75), color: colors.text, fontSize: 18, marginBottom: spacing(1),
  },
  maxBtn: { alignSelf: "flex-end", marginBottom: spacing(2) },
  maxBtnText: { color: colors.orange, fontSize: 12, fontWeight: "600" },
  modalActions: { flexDirection: "row", gap: spacing(1.5) },
  modalBtn: { flex: 1, borderRadius: 12, paddingVertical: spacing(1.5), alignItems: "center" },
  modalBtnGhost: { borderWidth: 1, borderColor: colors.border },
  modalBtnGhostText: { color: colors.subtext, fontWeight: "600" },
  modalBtnPrimary: { backgroundColor: colors.orange },
  modalBtnPrimaryText: { color: "#1A1300", fontWeight: "700" },
});
