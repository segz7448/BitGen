import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Alert } from "react-native";
import { colors, spacing } from "../theme";
import { ASSET_IDS, listAssets, getAsset } from "../wallet/assets";
import { getEstimatedExchangeAmount, createExchange, getExchangeStatus } from "../network/changeNowClient";
import { recordSwap, updateSwapStatus } from "../db/swapRepo";
import { loadMnemonic, loadPassphrase } from "../wallet/secureSeed";
import { isWatchOnly } from "../wallet/walletMode";
import { getOrCreateAddress } from "../wallet/multiAssetAddress";
import { sendAsset } from "../wallet/sendDispatch";

const SWAPPABLE = [ASSET_IDS.BTC, ASSET_IDS.USDT_TRC20, ASSET_IDS.USDT_ERC20, ASSET_IDS.USDT_BEP20];

export default function SwapScreen() {
  const [fromAsset, setFromAsset] = useState(ASSET_IDS.BTC);
  const [toAsset, setToAsset] = useState(ASSET_IDS.USDT_TRC20);
  const [amount, setAmount] = useState("");
  const [estimate, setEstimate] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [activeSwap, setActiveSwap] = useState(null); // { id, status }
  const [watchOnly, setWatchOnly] = useState(false);
  const debounceRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    isWatchOnly().then(setWatchOnly);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setEstimate(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || fromAsset === toAsset) return;
    debounceRef.current = setTimeout(async () => {
      setEstimating(true);
      try {
        const res = await getEstimatedExchangeAmount(fromAsset, toAsset, amt);
        setEstimate(res);
      } catch (e) {
        setEstimate({ error: e.message });
      } finally {
        setEstimating(false);
      }
    }, 600);
  }, [amount, fromAsset, toAsset]);

  const swapAssets = () => {
    setFromAsset(toAsset);
    setToAsset(fromAsset);
    setEstimate(null);
  };

  const confirmSwap = async () => {
    if (watchOnly) {
      Alert.alert("Watch-only wallet", "Can't sign or send from a watch-only wallet.");
      return;
    }
    if (fromAsset === toAsset) {
      Alert.alert("Pick two different assets", "You can't swap an asset for itself.");
      return;
    }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      Alert.alert("Enter an amount", "Amount must be greater than 0.");
      return;
    }
    if (!estimate || estimate.error) {
      Alert.alert("No quote yet", estimate?.error || "Wait for a quote before confirming.");
      return;
    }

    const fromMeta = getAsset(fromAsset);
    const toMeta = getAsset(toAsset);
    const toAmountDisplay = estimate.toAmount ?? estimate.estimatedAmount ?? "?";

    Alert.alert(
      "Confirm swap",
      `Send ${amt} ${fromMeta.symbol} (${fromMeta.chain})\n\nReceive ≈ ${toAmountDisplay} ${toMeta.symbol} (${toMeta.chain})\n\n` +
        `This goes through ChangeNow, a third-party swap provider — BITGEN doesn't hold both sides of the trade. ` +
        `Rate is not locked until you actually send.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm", onPress: runSwap },
      ]
    );
  };

  const runSwap = async () => {
    setSwapping(true);
    try {
      const mnemonic = await loadMnemonic();
      const passphrase = await loadPassphrase();
      const amt = parseFloat(amount);

      // Reuse (or derive-and-store) a receiving address for the asset we're
      // getting back, and one for the asset we're sending (used as refund
      // address if the swap fails and ChangeNow needs to send it back).
      const payoutAddress = await getOrCreateAddress(toAsset, mnemonic, passphrase);
      const refundAddress = await getOrCreateAddress(fromAsset, mnemonic, passphrase);

      const exchange = await createExchange({
        fromAssetId: fromAsset,
        toAssetId: toAsset,
        fromAmount: amt,
        payoutAddress,
        refundAddress,
      });

      const depositAddress = exchange.payinAddress;
      if (!depositAddress) throw new Error("ChangeNow didn't return a deposit address — aborting before sending anything.");

      await recordSwap({
        providerExchangeId: exchange.id,
        fromAssetId: fromAsset,
        toAssetId: toAsset,
        fromAmount: amt,
        toAmountEstimate: exchange.toAmount ?? exchange.amount ?? null,
        depositAddress,
        payoutAddress,
      });

      // Now actually move the funds to ChangeNow's deposit address.
      const sendResult = await sendAsset({
        assetId: fromAsset,
        mnemonic,
        passphrase,
        toAddress: depositAddress,
        amount: amt,
      });

      setActiveSwap({ id: exchange.id, status: "waiting", txid: sendResult.txid });
      startPolling(exchange.id);
    } catch (e) {
      Alert.alert("Swap failed", e.message);
    } finally {
      setSwapping(false);
    }
  };

  const startPolling = useCallback((exchangeId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await getExchangeStatus(exchangeId);
        await updateSwapStatus(exchangeId, status.status);
        setActiveSwap((prev) => (prev ? { ...prev, status: status.status } : prev));
        if (["finished", "failed", "refunded"].includes(status.status)) {
          clearInterval(pollRef.current);
        }
      } catch {
        // transient — keep polling
      }
    }, 15000);
  }, []);

  const assetOptions = SWAPPABLE.map((id) => getAsset(id));

  if (activeSwap) {
    return (
      <View style={styles.container}>
        <Text style={styles.statusTitle}>Swap in progress</Text>
        <Text style={styles.statusValue}>{activeSwap.status}</Text>
        {activeSwap.txid && <Text style={styles.statusMeta}>Deposit tx: {activeSwap.txid}</Text>}
        <Text style={styles.note}>
          Checking status every 15s. Typical swaps take a few minutes once your deposit confirms
          on-chain — larger BTC amounts wait for confirmations first.
        </Text>
        {["finished", "failed", "refunded"].includes(activeSwap.status) && (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => {
              setActiveSwap(null);
              setAmount("");
              setEstimate(null);
            }}
          >
            <Text style={styles.primaryButtonText}>New swap</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(3) }}>
      <Text style={styles.label}>From</Text>
      <View style={styles.pickerRow}>
        {assetOptions.map((a) => (
          <TouchableOpacity
            key={a.id}
            style={[styles.pill, fromAsset === a.id && styles.pillSelected]}
            onPress={() => setFromAsset(a.id)}
          >
            <Text style={[styles.pillText, fromAsset === a.id && styles.pillTextSelected]}>{a.symbol} · {a.chain}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.swapIconButton} onPress={swapAssets}>
        <Text style={styles.swapIconText}>⇅ Flip</Text>
      </TouchableOpacity>

      <Text style={styles.label}>To</Text>
      <View style={styles.pickerRow}>
        {assetOptions.map((a) => (
          <TouchableOpacity
            key={a.id}
            style={[styles.pill, toAsset === a.id && styles.pillSelected]}
            onPress={() => setToAsset(a.id)}
          >
            <Text style={[styles.pillText, toAsset === a.id && styles.pillTextSelected]}>{a.symbol} · {a.chain}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Amount ({getAsset(fromAsset).symbol})</Text>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        placeholderTextColor={colors.subtext}
        keyboardType="decimal-pad"
      />

      {estimating && <ActivityIndicator style={{ marginTop: spacing(2) }} color={colors.orange} />}
      {estimate && !estimate.error && (
        <Text style={styles.estimateText}>
          ≈ {estimate.toAmount ?? estimate.estimatedAmount} {getAsset(toAsset).symbol}
        </Text>
      )}
      {estimate?.error && <Text style={styles.errorText}>{estimate.error}</Text>}

      <TouchableOpacity style={styles.primaryButton} onPress={confirmSwap} disabled={swapping}>
        {swapping ? <ActivityIndicator color="#0B0B0F" /> : <Text style={styles.primaryButtonText}>Review swap</Text>}
      </TouchableOpacity>

      <Text style={styles.note}>
        Swaps route through ChangeNow, a third-party exchange — BITGEN never custodies both sides.
        Requires a ChangeNow API key configured in src/network/changeNowClient.js.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  label: { color: colors.subtext, fontSize: 12, marginBottom: spacing(0.5), marginTop: spacing(2) },
  pickerRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingVertical: spacing(1), paddingHorizontal: spacing(1.5) },
  pillSelected: { borderColor: colors.orange, backgroundColor: "#2A1F0F" },
  pillText: { color: colors.subtext, fontSize: 12, fontWeight: "600" },
  pillTextSelected: { color: colors.orange },
  swapIconButton: { alignSelf: "center", marginTop: spacing(2) },
  swapIconText: { color: colors.orange, fontSize: 14, fontWeight: "700" },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(1.5), color: colors.text },
  estimateText: { color: colors.text, fontSize: 14, marginTop: spacing(1.5), textAlign: "center" },
  errorText: { color: "#FF6B6B", fontSize: 12, marginTop: spacing(1.5), textAlign: "center" },
  primaryButton: { backgroundColor: colors.orange, borderRadius: 14, paddingVertical: spacing(2), alignItems: "center", marginTop: spacing(4) },
  primaryButtonText: { color: "#0B0B0F", fontWeight: "700", fontSize: 16 },
  statusTitle: { color: colors.subtext, fontSize: 14, textAlign: "center", marginTop: spacing(6) },
  statusValue: { color: colors.orange, fontSize: 24, fontWeight: "700", textAlign: "center", marginTop: spacing(1), textTransform: "capitalize" },
  statusMeta: { color: colors.subtext, fontSize: 11, textAlign: "center", marginTop: spacing(2), paddingHorizontal: spacing(3) },
  note: { color: colors.subtext, fontSize: 11, textAlign: "center", marginTop: spacing(3), lineHeight: 16, paddingHorizontal: spacing(2) },
});
