import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator, ScrollView } from "react-native";
import { spacing, useTheme } from "../theme";
import { ASSET_IDS, getAsset } from "../wallet/assets";
import SendScreen from "./SendScreen";
import { loadMnemonic, loadPassphrase } from "../wallet/secureSeed";
import { isWatchOnly } from "../wallet/walletMode";
import { sendAsset } from "../wallet/sendDispatch";
import { getAssetBalanceDisplay } from "../network/multiAssetBalance";
import { getCurrentAddress, getActiveAddresses } from "../db/addressRepo";

const GAS_COIN = { bsc: "BNB", ethereum: "ETH", morph: "ETH", tron: "TRX" };

/**
 * BTC keeps the real, existing Send flow untouched (fee tiers, RBF,
 * UTXO selection) — too much working logic there to duplicate. USDT/ETH
 * variants (account-model chains) get a simpler on-chain send form using
 * the shared sendAsset dispatcher, which itself branches on native
 * value-transfer vs ERC20-style contract.transfer() depending on the asset.
 */
export default function WithdrawScreen({ route, navigation }) {
  const assetId = route.params?.assetId || ASSET_IDS.BTC;

  if (assetId === ASSET_IDS.BTC) {
    return <SendScreen route={route} navigation={navigation} />;
  }

  return <AccountModelWithdrawForm assetId={assetId} navigation={navigation} />;
}

function AccountModelWithdrawForm({ assetId, navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const asset = getAsset(assetId);
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [available, setAvailable] = useState(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [activeAddrs, setActiveAddrs] = useState([]);
  const [fromAddr, setFromAddr] = useState(null); // the row being spent from
  const [showFromPicker, setShowFromPicker] = useState(false);

  useEffect(() => {
    isWatchOnly().then(setWatchOnly);
    (async () => {
      try {
        const rows = await getActiveAddresses(0, assetId);
        setActiveAddrs(rows);
        const current = (await getCurrentAddress(assetId)) || rows[0];
        setFromAddr(current || null);
        if (current) setAvailable(await getAssetBalanceDisplay(assetId, current.address));
        else setAvailable(0);
      } catch {
        setAvailable(null);
      } finally {
        setLoadingBalance(false);
      }
    })();
  }, [assetId]);

  const selectFromAddr = async (row) => {
    setFromAddr(row);
    setShowFromPicker(false);
    setLoadingBalance(true);
    setAvailable(await getAssetBalanceDisplay(assetId, row.address));
    setLoadingBalance(false);
  };

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
                fromIndex: fromAddr?.derivation_index ?? 0,
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

  const gasCoin = GAS_COIN[asset.chain] || asset.symbol;

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

      {activeAddrs.length > 1 && (
        <>
          <TouchableOpacity onPress={() => setShowFromPicker((s) => !s)} style={{ marginTop: spacing(1) }}>
            <Text style={styles.fromLink}>
              {showFromPicker ? "Hide" : `From: Address #${fromAddr?.derivation_index ?? 0} (tap to change)`}
            </Text>
          </TouchableOpacity>
          {showFromPicker && activeAddrs.map((row) => (
            <TouchableOpacity key={row.address} onPress={() => selectFromAddr(row)} style={styles.fromRow}>
              <Text style={[styles.fromRowText, row.address === fromAddr?.address && { color: colors.orange }]} numberOfLines={1}>
                #{row.derivation_index} · {row.address}
              </Text>
            </TouchableOpacity>
          ))}
        </>
      )}

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

      {!asset.isNative && (
        <Text style={styles.note}>
          Gas ({gasCoin}) is required in your {asset.displayName} address to cover network fees — separate
          from the {asset.symbol} you're sending.
        </Text>
      )}
    </ScrollView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    watchOnlyNotice: { color: colors.subtext, fontSize: 14, textAlign: "center", padding: spacing(4), lineHeight: 20 },
    assetLabel: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: spacing(1) },
    hint: { color: colors.subtext, fontSize: 12, lineHeight: 17, marginBottom: spacing(2) },
    label: { color: colors.subtext, fontSize: 12, marginBottom: spacing(0.5), marginTop: spacing(2) },
    available: { color: colors.text, fontSize: 15, fontWeight: "600" },
    fromLink: { color: colors.orange, fontSize: 12, fontWeight: "600" },
    fromRow: { paddingVertical: spacing(1), borderBottomWidth: 1, borderBottomColor: colors.border },
    fromRowText: { color: colors.subtext, fontSize: 11 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(1.5), color: colors.text },
    sendButton: { backgroundColor: colors.orange, borderRadius: 14, paddingVertical: spacing(2), alignItems: "center", marginTop: spacing(4) },
    sendButtonText: { color: "#0B0B0F", fontWeight: "700", fontSize: 16 },
    note: { color: colors.subtext, fontSize: 11, textAlign: "center", marginTop: spacing(3), lineHeight: 16 },
  });
}
