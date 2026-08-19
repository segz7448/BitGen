import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking, Alert } from "react-native";
import * as Clipboard from "expo-clipboard";
import { spacing, useTheme } from "../theme";
import { fetchTxDetails, fetchTipHeight } from "../network/esplora";
import { getAllAddresses } from "../db/addressRepo";
import { GlassCard } from "../components/Glass";

function formatBtc(sats) {
  return (sats / 100_000_000).toFixed(8);
}

function formatDate(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleString();
}

function truncate(str, head = 10, tail = 8) {
  if (!str) return "Unknown";
  if (str.length <= head + tail + 3) return str;
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

/**
 * A real explorer-style transaction detail — the thing tapping a
 * transaction on blockchain.com or mempool.space shows you: confirmation
 * count against the current chain tip, block height/time, every input
 * and output with amounts, fee and fee rate. Pulled live from your
 * configured Esplora server (Blockstream/mempool.space by default —
 * see Settings → Network), the same backend already used for balances.
 */
export default function TransactionDetailScreen({ route }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { txid } = route.params;

  const [detail, setDetail] = useState(null);
  const [tipHeight, setTipHeight] = useState(null);
  const [myAddresses, setMyAddresses] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, tip, receiving, change] = await Promise.all([
        fetchTxDetails(txid),
        fetchTipHeight().catch(() => null),
        getAllAddresses({ change: 0 }),
        getAllAddresses({ change: 1 }),
      ]);
      setDetail(d);
      setTipHeight(tip);
      setMyAddresses(new Set([...receiving, ...change].map((a) => a.address)));
    } catch (e) {
      setError(e.message || "Couldn't load transaction details.");
    } finally {
      setLoading(false);
    }
  }, [txid]);

  useEffect(() => { load(); }, [load]);

  const copy = async (text, label) => {
    await Clipboard.setStringAsync(text);
    Alert.alert("Copied", `${label} copied to clipboard.`);
  };

  const openExplorer = (site) => {
    const url = site === "mempool" ? `https://mempool.space/tx/${txid}` : `https://blockstream.info/tx/${txid}`;
    Linking.openURL(url).catch(() => Alert.alert("Couldn't open link"));
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.orange} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.center, { padding: spacing(3) }]}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => { setLoading(true); load(); }}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const confirmations = detail.confirmed && detail.blockHeight != null && tipHeight != null
    ? Math.max(1, tipHeight - detail.blockHeight + 1)
    : 0;
  const feeRate = detail.fee != null && detail.vsize ? (detail.fee / detail.vsize).toFixed(1) : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(3) }}>
      <GlassCard style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: detail.confirmed ? colors.green : colors.orange }]} />
          <Text style={styles.statusText}>
            {detail.confirmed ? `Confirmed · ${confirmations} confirmation${confirmations === 1 ? "" : "s"}` : "Unconfirmed · in mempool"}
          </Text>
        </View>
        <TouchableOpacity onPress={() => copy(txid, "Transaction ID")}>
          <Text style={styles.txid} numberOfLines={1}>{txid}</Text>
          <Text style={styles.tapHint}>Tap to copy full TXID</Text>
        </TouchableOpacity>
      </GlassCard>

      <View style={styles.statsGrid}>
        <StatBox label="Block Height" value={detail.blockHeight != null ? `#${detail.blockHeight}` : "Pending"} colors={colors} />
        <StatBox label="Timestamp" value={detail.blockTime ? formatDate(detail.blockTime) : "Pending"} colors={colors} small />
        <StatBox label="Fee" value={detail.fee != null ? `${detail.fee.toLocaleString()} sats` : "—"} colors={colors} />
        <StatBox label="Fee Rate" value={feeRate ? `${feeRate} sat/vB` : "—"} colors={colors} />
        <StatBox label="Size" value={detail.size ? `${detail.size} B` : "—"} colors={colors} />
        <StatBox label="Virtual Size" value={detail.vsize ? `${detail.vsize} vB` : "—"} colors={colors} />
      </View>

      <Text style={styles.sectionTitle}>Inputs ({detail.vin.length})</Text>
      <GlassCard style={styles.ioCard}>
        {detail.vin.map((input, i) => (
          <View key={`${input.txid}-${input.vout}-${i}`} style={[styles.ioRow, i > 0 && styles.ioRowBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.ioAddress, myAddresses.has(input.address) && styles.ioAddressMine]} numberOfLines={1}>
                {input.isCoinbase ? "Coinbase (newly mined)" : truncate(input.address)}
              </Text>
              {myAddresses.has(input.address) && <Text style={styles.ioMineTag}>Your address</Text>}
            </View>
            {input.value != null && <Text style={styles.ioValue}>{formatBtc(input.value)} BTC</Text>}
          </View>
        ))}
      </GlassCard>

      <Text style={styles.sectionTitle}>Outputs ({detail.vout.length})</Text>
      <GlassCard style={styles.ioCard}>
        {detail.vout.map((output, i) => (
          <View key={i} style={[styles.ioRow, i > 0 && styles.ioRowBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.ioAddress, myAddresses.has(output.address) && styles.ioAddressMine]} numberOfLines={1}>
                {truncate(output.address)}
              </Text>
              {myAddresses.has(output.address) && <Text style={styles.ioMineTag}>Your address</Text>}
            </View>
            <Text style={styles.ioValue}>{formatBtc(output.value)} BTC</Text>
          </View>
        ))}
      </GlassCard>

      <Text style={styles.sectionTitle}>View on a public explorer</Text>
      <View style={styles.explorerRow}>
        <TouchableOpacity style={styles.explorerButton} onPress={() => openExplorer("mempool")}>
          <Text style={styles.explorerButtonText}>mempool.space ↗</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.explorerButton} onPress={() => openExplorer("blockstream")}>
          <Text style={styles.explorerButtonText}>blockstream.info ↗</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.footnote}>
        Data above comes from your configured Esplora server (Settings → Network) — the same backend
        these public explorers run on, so it matches what you'd see there.
      </Text>
    </ScrollView>
  );
}

function StatBox({ label, value, colors, small }) {
  const styles = makeStyles(colors);
  return (
    <GlassCard style={styles.statBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, small && { fontSize: 12 }]} numberOfLines={2}>{value}</Text>
    </GlassCard>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { alignItems: "center", justifyContent: "center" },
    errorText: { color: colors.subtext, fontSize: 13, textAlign: "center", marginBottom: spacing(2) },
    retryButton: { backgroundColor: colors.orange, borderRadius: 10, paddingVertical: spacing(1.2), paddingHorizontal: spacing(3) },
    retryButtonText: { color: "#0B0B0F", fontWeight: "700" },

    statusCard: { padding: spacing(2.5), marginBottom: spacing(2) },
    statusRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing(1.5) },
    statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
    statusText: { color: colors.text, fontSize: 14, fontWeight: "700" },
    txid: { color: colors.subtext, fontSize: 12 },
    tapHint: { color: colors.subtext, fontSize: 10, marginTop: 4, opacity: 0.7 },

    statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1.25), marginBottom: spacing(1) },
    statBox: { width: "47%", padding: spacing(1.5) },
    statLabel: { color: colors.subtext, fontSize: 10, fontWeight: "700", textTransform: "uppercase", marginBottom: 4 },
    statValue: { color: colors.text, fontSize: 14, fontWeight: "700" },

    sectionTitle: { color: colors.subtext, fontSize: 12, fontWeight: "700", marginTop: spacing(3), marginBottom: spacing(1), textTransform: "uppercase" },
    ioCard: { padding: spacing(1.5) },
    ioRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing(1) },
    ioRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    ioAddress: { color: colors.subtext, fontSize: 12, fontFamily: "monospace" },
    ioAddressMine: { color: colors.orange, fontWeight: "700" },
    ioMineTag: { color: colors.orange, fontSize: 9, marginTop: 2 },
    ioValue: { color: colors.text, fontSize: 12, fontWeight: "600", marginLeft: spacing(1) },

    explorerRow: { flexDirection: "row", gap: spacing(1.5) },
    explorerButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: spacing(1.5), alignItems: "center" },
    explorerButtonText: { color: colors.text, fontSize: 13, fontWeight: "600" },
    footnote: { color: colors.subtext, fontSize: 10, lineHeight: 15, marginTop: spacing(2), textAlign: "center" },
  });
}
