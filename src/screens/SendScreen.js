import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator, ScrollView } from "react-native";
import { colors, spacing } from "../theme";
import { loadMnemonic, loadPassphrase } from "../wallet/secureSeed";
import { getSpendableUtxos, markUtxosSpent } from "../wallet/sync";
import { buildAndSignTx, selectUtxos } from "../wallet/txBuilder";
import { fetchFeeEstimates, broadcastTx } from "../network/esplora";
import { fetchBtcPrices, satsToFiat, formatFiat } from "../network/priceFeed";
import { validateSendInput, btcToSats } from "../wallet/validation";
import { getDb } from "../db/database";
import { isWatchOnly } from "../wallet/walletMode";
import { addAddress } from "../db/addressRepo";
import { useDisplayCurrency } from "../hooks/useDisplayCurrency";

const FEE_LABELS = { fast: "Fast (~10 min)", medium: "Medium (~1 hr)", slow: "Slow (~24 hr)" };

export default function SendScreen({ route, navigation }) {
  const [toAddress, setToAddress] = useState(route.params?.scannedAddress || "");
  const [amountBtc, setAmountBtc] = useState("");
  const [fees, setFees] = useState(null);
  const [feeSpeed, setFeeSpeed] = useState("medium");
  const [sending, setSending] = useState(false);
  const [prices, setPrices] = useState(null);
  const [watchOnly, setWatchOnly] = useState(false);
  const [availableSats, setAvailableSats] = useState(0);
  const [hasConfirmedFunds, setHasConfirmedFunds] = useState(true);

  useEffect(() => {
    fetchFeeEstimates().then(setFees).catch(() => setFees({ fast: 20, medium: 8, slow: 2 }));
    fetchBtcPrices().then(setPrices).catch(() => {});
    isWatchOnly().then(setWatchOnly);
    (async () => {
      const confirmed = await getSpendableUtxos({ includeUnconfirmed: false });
      const all = await getSpendableUtxos({ includeUnconfirmed: true });
      setHasConfirmedFunds(confirmed.length > 0);
      setAvailableSats(all.reduce((s, u) => s + u.value, 0));
    })();
  }, []);

  useEffect(() => {
    if (route.params?.scannedAddress) setToAddress(route.params.scannedAddress);
  }, [route.params?.scannedAddress]);

  const { currency } = useDisplayCurrency();
  const amountSats = btcToSats(amountBtc);
  const fiatValue = prices ? satsToFiat(amountSats || 0, prices[currency]) : null;

  const send = async () => {
    if (watchOnly) {
      Alert.alert("Watch-only wallet", "This wallet has no private key on this device and can't sign transactions.");
      return;
    }

    const validation = validateSendInput({ toAddress, amountSats, availableSats });
    if (!validation.valid) {
      Alert.alert("Check your input", validation.error);
      return;
    }

    setSending(true);
    try {
      const mnemonic = await loadMnemonic();
      const passphrase = await loadPassphrase();
      let utxos = await getSpendableUtxos({ includeUnconfirmed: false });
      let usingUnconfirmed = false;

      if (utxos.length === 0) {
        // No confirmed funds — fall back to unconfirmed, with a clear warning shown before broadcast.
        utxos = await getSpendableUtxos({ includeUnconfirmed: true });
        usingUnconfirmed = true;
      }
      if (utxos.length === 0) throw new Error("No spendable funds found.");

      const feeRate = fees ? fees[feeSpeed] : 8;
      const { selected } = selectUtxos(utxos, amountSats, feeRate);

      const db = await getDb();
      const row = await db.getFirstAsync(
        `SELECT MAX(derivation_index) as maxIdx FROM addresses WHERE change_type = 1 AND asset_id = 'BTC'`
      );
      const changeIndex = (row?.maxIdx ?? -1) + 1;

      const { txHex, txid, fee, changeAddress } = buildAndSignTx({
        mnemonic,
        passphrase,
        utxos: selected,
        toAddress: toAddress.trim(),
        amountSats,
        feeRateSatPerVb: feeRate,
        changeIndex,
        enableRbf: true,
      });

      const confirmMsg =
        `Send ${amountBtc} BTC to:\n${toAddress}\n\nNetwork fee: ${fee} sats\n\n` +
        (usingUnconfirmed ? "⚠️ Spending unconfirmed funds — this may fail if the source tx is dropped.\n\n" : "") +
        "This cannot be undone.";

      Alert.alert("Confirm transaction", confirmMsg, [
        { text: "Cancel", style: "cancel", onPress: () => setSending(false) },
        {
          text: "Confirm & Broadcast",
          onPress: async () => {
            try {
              await broadcastTx(txHex);
              await markUtxosSpent(selected);
              // Persist the change address so syncWallet() actually tracks it —
              // otherwise change funds are invisible until a full gap-limit
              // rescan, and the next send would derive/reuse this same index.
              if (changeAddress) {
                await addAddress({ address: changeAddress, index: changeIndex, change: 1 });
              }
              // Store originalUtxos so a later fee-bump (RBF) can rebuild against the same inputs.
              await db.runAsync(
                `INSERT OR REPLACE INTO transactions (txid, amount_sats, fee_sats, direction, confirmed, timestamp, counterparty_address, raw_json)
                 VALUES (?, ?, ?, 'out', 0, ?, ?, ?)`,
                [txid, -amountSats, fee, Date.now(), toAddress.trim(), JSON.stringify({ originalUtxos: selected })]
              );
              Alert.alert("Sent", `Transaction broadcast:\n${txid}`, [
                { text: "OK", onPress: () => navigation.navigate("Home") },
              ]);
            } catch (e) {
              Alert.alert("Broadcast failed", e.message);
            } finally {
              setSending(false);
            }
          },
        },
      ]);
    } catch (e) {
      Alert.alert("Error", e.message);
      setSending(false);
    }
  };

  if (watchOnly) {
    return (
      <View style={styles.container}>
        <Text style={styles.watchOnlyNotice}>
          This is a watch-only wallet — it can view balances but has no private key on this device,
          so it can't send transactions.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(3) }}>
      {!hasConfirmedFunds && availableSats > 0 && (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            You only have unconfirmed funds available. Sending now carries a small risk if the
            incoming transaction gets dropped from the mempool.
          </Text>
        </View>
      )}

      <Text style={styles.label}>Recipient Address</Text>
      <View style={styles.addressRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={toAddress}
          onChangeText={setToAddress}
          placeholder="bc1..."
          placeholderTextColor={colors.subtext}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity style={styles.scanButton} onPress={() => navigation.navigate("Scan")}>
          <Text style={styles.scanButtonText}>Scan</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Amount (BTC)</Text>
      <TextInput
        style={styles.input}
        value={amountBtc}
        onChangeText={setAmountBtc}
        placeholder="0.00000000"
        placeholderTextColor={colors.subtext}
        keyboardType="decimal-pad"
      />
      {fiatValue != null && <Text style={styles.fiatHint}>≈ {formatFiat(fiatValue, currency)}</Text>}

      <Text style={styles.label}>Network Fee</Text>
      <View style={styles.feeRow}>
        {["fast", "medium", "slow"].map((speed) => (
          <TouchableOpacity
            key={speed}
            style={[styles.feeOption, feeSpeed === speed && styles.feeOptionSelected]}
            onPress={() => setFeeSpeed(speed)}
          >
            <Text style={[styles.feeOptionText, feeSpeed === speed && styles.feeOptionTextSelected]}>
              {FEE_LABELS[speed]}
            </Text>
            {fees && <Text style={styles.feeRate}>{fees[speed]} sat/vB</Text>}
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.sendButton} onPress={send} disabled={sending}>
        {sending ? <ActivityIndicator color="#0B0B0F" /> : <Text style={styles.sendButtonText}>Review & Send</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  watchOnlyNotice: { color: colors.subtext, fontSize: 14, textAlign: "center", padding: spacing(4), lineHeight: 20 },
  warningBox: { backgroundColor: "#2A1F0F", borderWidth: 1, borderColor: colors.orange, borderRadius: 12, padding: spacing(1.5), marginBottom: spacing(2) },
  warningText: { color: colors.orange, fontSize: 12, lineHeight: 17 },
  label: { color: colors.subtext, fontSize: 12, marginBottom: spacing(0.5), marginTop: spacing(2) },
  addressRow: { flexDirection: "row", gap: spacing(1) },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(1.5), color: colors.text },
  scanButton: { borderWidth: 1, borderColor: colors.orange, borderRadius: 12, paddingHorizontal: spacing(2), justifyContent: "center" },
  scanButtonText: { color: colors.orange, fontWeight: "600" },
  fiatHint: { color: colors.subtext, fontSize: 12, marginTop: spacing(0.5) },
  feeRow: { flexDirection: "row", gap: spacing(1) },
  feeOption: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(1.2), alignItems: "center" },
  feeOptionSelected: { borderColor: colors.orange, backgroundColor: "#2A1F0F" },
  feeOptionText: { color: colors.subtext, fontSize: 11, fontWeight: "600", textAlign: "center" },
  feeOptionTextSelected: { color: colors.orange },
  feeRate: { color: colors.subtext, fontSize: 10, marginTop: 2 },
  sendButton: { backgroundColor: colors.orange, borderRadius: 14, paddingVertical: spacing(2), alignItems: "center", marginTop: spacing(4) },
  sendButtonText: { color: "#0B0B0F", fontWeight: "700", fontSize: 16 },
});
