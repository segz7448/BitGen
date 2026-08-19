import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, TextInput } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { spacing, useTheme } from "../theme";
import { getDb } from "../db/database";
import { syncTransactionHistory } from "../wallet/sync";
import { GlassCard } from "../components/Glass";

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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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
            onPress={() => navigation.navigate("TransactionDetail", { txid: item.txid })}
          >
            <GlassCard style={styles.rowCard}>
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
                      e.stopPropagation?.();
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
                </Text>
              </View>

              {!item.confirmed && (
                <TouchableOpacity
                  style={styles.speedUpButton}
                  onPress={() => {
                    if (item.direction === "out") {
                      navigation.navigate("BumpFee", { txid: item.txid });
                    } else {
                      navigation.navigate("Cpfp", { txid: item.txid });
                    }
                  }}
                >
                  <Text style={styles.speedUpText}>{item.direction === "out" ? "Bump fee" : "Speed up"}</Text>
                </TouchableOpacity>
              )}
            </GlassCard>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No transactions yet. Pull down to sync.</Text>}
      />
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    row: { marginBottom: spacing(1.5) },
    rowCard: { flexDirection: "row", alignItems: "center", padding: spacing(2) },
    iconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", marginRight: spacing(1.5) },
    icon: { fontSize: 18, fontWeight: "700" },
    amount: { color: colors.text, fontSize: 14, fontWeight: "700" },
    meta: { color: colors.subtext, fontSize: 11, marginTop: 2 },
    labelInput: { color: colors.text, fontSize: 12, borderBottomWidth: 1, borderBottomColor: colors.orange, marginTop: 2, paddingVertical: 2 },
    time: { color: colors.subtext, fontSize: 10, marginTop: 2 },
    speedUpButton: { borderWidth: 1, borderColor: colors.orange, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, marginLeft: spacing(1) },
    speedUpText: { color: colors.orange, fontSize: 10, fontWeight: "700" },
    empty: { color: colors.subtext, textAlign: "center", marginTop: spacing(6) },
  });
}
