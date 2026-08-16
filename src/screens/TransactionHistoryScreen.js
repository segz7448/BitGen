import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, TextInput, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { colors, spacing } from "../theme";
import { getDb } from "../db/database";
import { syncTransactionHistory } from "../wallet/sync";

function formatSats(sats) {
  return (Math.abs(sats) / 100_000_000).toFixed(8);
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function TransactionHistoryScreen({ navigation }) {
  const [txs, setTxs] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [editingTxid, setEditingTxid] = useState(null);
  const [labelDraft, setLabelDraft] = useState("");

  const load = useCallback(async () => {
    const db = await getDb();
    const rows = await db.getAllAsync(`SELECT * FROM transactions ORDER BY timestamp DESC`);
    setTxs(rows);
  }, []);

  const saveLabel = async (txid) => {
    const db = await getDb();
    await db.runAsync(`UPDATE transactions SET counterparty_label = ? WHERE txid = ?`, [labelDraft.trim(), txid]);
    setEditingTxid(null);
    load();
  };

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await syncTransactionHistory();
    } catch (e) {
      // network issue — fall back to cached rows silently, list still refreshes below
    }
    await load();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={{ padding: spacing(2) }}
        data={txs}
        keyExtractor={(item) => item.txid}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.orange} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              if (item.confirmed) return;
              if (item.direction === "out") {
                navigation.navigate("BumpFee", { txid: item.txid });
              } else {
                // We didn't send this one, so we can't RBF it — CPFP is the
                // only way to push a stuck incoming payment along.
                navigation.navigate("Cpfp", { txid: item.txid });
              }
            }}
          >
            <View style={styles.iconWrap}>
              <Text style={[styles.icon, { color: item.direction === "in" ? colors.green : colors.red }]}>
                {item.direction === "in" ? "↓" : "↑"}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.amount}>
                {item.direction === "in" ? "+" : "-"}{formatSats(item.amount_sats)} BTC
              </Text>

              {editingTxid === item.txid ? (
                <TextInput
                  style={styles.labelInput}
                  value={labelDraft}
                  onChangeText={setLabelDraft}
                  onSubmitEditing={() => saveLabel(item.txid)}
                  onBlur={() => saveLabel(item.txid)}
                  autoFocus
                  placeholder="Label this address"
                  placeholderTextColor={colors.subtext}
                />
              ) : (
                <TouchableOpacity
                  onPress={(e) => {
                    setEditingTxid(item.txid);
                    setLabelDraft(item.counterparty_label || "");
                  }}
                >
                  <Text style={styles.meta} numberOfLines={1}>
                    {item.counterparty_label || item.counterparty_address || item.txid.slice(0, 16) + "…"}
                  </Text>
                </TouchableOpacity>
              )}

              <Text style={styles.time}>
                {timeAgo(item.timestamp)} · {item.confirmed ? "Confirmed" : "Pending"}
                {!item.confirmed && item.direction === "out" ? " · Tap row to bump fee" : ""}
                {!item.confirmed && item.direction === "in" ? " · Tap row to speed up (CPFP)" : ""}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No transactions yet. Pull down to sync.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  row: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: spacing(2), marginBottom: spacing(1.5),
  },
  iconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", marginRight: spacing(1.5) },
  icon: { fontSize: 18, fontWeight: "700" },
  amount: { color: colors.text, fontSize: 14, fontWeight: "700" },
  meta: { color: colors.subtext, fontSize: 11, marginTop: 2 },
  labelInput: { color: colors.text, fontSize: 12, borderBottomWidth: 1, borderBottomColor: colors.orange, marginTop: 2, paddingVertical: 2 },
  time: { color: colors.subtext, fontSize: 10, marginTop: 2 },
  empty: { color: colors.subtext, textAlign: "center", marginTop: spacing(6) },
});
