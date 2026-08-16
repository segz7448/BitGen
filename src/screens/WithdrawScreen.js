import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator, ScrollView } from "react-native";
import { colors, spacing } from "../theme";
import { ASSET_IDS, getAsset } from "../wallet/assets";
import SendScreen from "./SendScreen";
import { loadMnemonic, loadPassphrase } from "../wallet/secureSeed";
import { isWatchOnly } from "../wallet/walletMode";
import { sendAsset } from "../wallet/sendDispatch";
import { getErc20Balance } from "../network/evmClient";
import { getTrc20Balance } from "../network/tronClient";
import { getCurrentAddress } from "../db/addressRepo";
import { fromBaseUnits } from "../wallet/units";

/**
 * BTC keeps the real, existing Send flow untouched (fee tiers, RBF,
 * UTXO selection) — too much working logic there to duplicate. USDT
 * variants (account-model chains) get a simpler on-chain send form
 * using the shared sendAsset dispatcher already proven in SwapScreen.
 */
export default function WithdrawScreen({ route, navigation }) {
  const assetId = route.params?.assetId || ASSET_IDS.BTC;

  if (assetId === ASSET_IDS.BTC) {
    return <SendScreen route={route} navigation={navigation} />;
  }

  return <UsdtWithdrawForm assetId={assetId} navigation={navigation} />;
}

function UsdtWithdrawForm({ assetId, navigation }) {
  const asset = getAsset(assetId);
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [available, setAvailable] = useState(null);
  const [loadingBalance, setLoadingBalance] = useState(true);

  useEffect(() => {
    isWatchOnly().then(setWatchOnly);
    (async () => {
      try {
        const addrRow = await getCurrentAddress(assetId);
        if (!addrRow) {
          setAvailable(0);
          return;
        }
        const raw =
          asset.chain === "tron"
            ? await getTrc20Balance(addrRow.address, asset.contractAddress)
            : await getErc20Balance(asset.chain, addrRow.address, asset.contractAddress);
        setAvailable(fromBaseUnits(raw, asset.decimals));
      } catch {
        setAvailable(null);
      } finally {
        setLoadingBalance(false);
      }
    })();
  }, [assetId]);

  const send = async () => {
    if (watchOnly) {
      Alert.alert("Watch-only wallet", "This wallet has no private key on this device and can't sign transactions.");
      return;
    }
    const amt = parseFloat(amount);
    if (!toAddress.trim()) {
      Alert.alert("Enter an address", "Type or paste the recipient address.");
      return;
    }
    if (!amt || amt <= 0) {
      Alert.alert("Enter an amount", `Type how much ${asset.symbol} to withdraw.`);
      return;
    }

    Alert.alert(
      "Confirm withdrawal",
      `Send ${amt} ${asset.symbol} (${asset.displayName}) to:\n${toAddress.trim()}\n\nThis broadcasts a real on-chain transaction and cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Withdraw",
          onPress: async () => {
            setSending(true);
            try {
              const mnemonic = await loadMnemonic();
              const passphrase = await loadPassphrase();
              const { txid } = await sendAsset({
                assetId,
                mnemonic,
                passphrase,
                toAddress: toAddress.trim(),
                amount: amt,
              });
              Alert.alert("Sent", `Transaction broadcast:\n${txid}`, [
                { text: "OK", onPress: () => navigation.navigate("Home") },
              ]);
            } catch (e) {
              Alert.alert("Withdrawal failed", e.message || "Something went wrong.");
            } finally {
              setSending(false);
            }
          },
        },
      ]
    );
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
      <Text style={styles.assetLabel}>Withdraw {asset.symbol} · {asset.displayName}</Text>
      <Text style={styles.hint}>
        Real on-chain transfer on the {asset.chain} network. Irreversible once broadcast — double-check
        the address and network before confirming.
      </Text>

      <Text style={styles.label}>Available</Text>
      <Text style={styles.available}>
        {loadingBalance ? "Loading…" : available == null ? "—" : `${available} ${asset.symbol}`}
      </Text>

      <Text style={styles.label}>Recipient Address</Text>
      <TextInput
        style={styles.input}
        value={toAddress}
        onChangeText={setToAddress}
        placeholder={`${asset.chain} address`}
        placeholderTextColor={colors.subtext}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>Amount ({asset.symbol})</Text>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        placeholderTextColor={colors.subtext}
        keyboardType="decimal-pad"
      />

      <TouchableOpacity style={styles.sendButton} onPress={send} disabled={sending}>
        {sending ? <ActivityIndicator color="#0B0B0F" /> : <Text style={styles.sendButtonText}>Review & Withdraw</Text>}
      </TouchableOpacity>

      <Text style={styles.note}>
        Gas ({asset.chain === "bsc" ? "BNB" : asset.chain === "ethereum" ? "ETH" : "TRX"}) is required
        in your {asset.displayName} address to cover network fees.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  watchOnlyNotice: { color: colors.subtext, fontSize: 14, textAlign: "center", padding: spacing(4), lineHeight: 20 },
  assetLabel: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: spacing(1) },
  hint: { color: colors.subtext, fontSize: 12, lineHeight: 17, marginBottom: spacing(2) },
  label: { color: colors.subtext, fontSize: 12, marginBottom: spacing(0.5), marginTop: spacing(2) },
  available: { color: colors.text, fontSize: 15, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(1.5), color: colors.text },
  sendButton: { backgroundColor: colors.orange, borderRadius: 14, paddingVertical: spacing(2), alignItems: "center", marginTop: spacing(4) },
  sendButtonText: { color: "#0B0B0F", fontWeight: "700", fontSize: 16 },
  note: { color: colors.subtext, fontSize: 11, textAlign: "center", marginTop: spacing(3), lineHeight: 16 },
});
