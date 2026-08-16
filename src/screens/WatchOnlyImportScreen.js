import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { colors, spacing } from "../theme";
import { isValidXpub, deriveAddressFromXpub, getAccountXpub } from "../wallet/hdWallet";
import { addAddress, setCurrentAddress } from "../db/addressRepo";
import { setWalletMode } from "../wallet/walletMode";
import { gapLimitScanXpub } from "../wallet/sync";

export default function WatchOnlyImportScreen({ navigation }) {
  const [xpub, setXpub] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanStatus, setScanStatus] = useState("");

  const importXpub = async () => {
    const trimmed = xpub.trim();
    if (!isValidXpub(trimmed)) {
      Alert.alert("Invalid key", "That doesn't look like a valid extended public key (zpub/xpub).");
      return;
    }
    setLoading(true);
    try {
      await setWalletMode("watch_only", trimmed);
      const first = deriveAddressFromXpub(trimmed, 0, 0);
      await addAddress({ address: first.address, index: 0, change: 0 });
      await setCurrentAddress(first.address);

      // Same gap-limit discovery as a full-wallet import — otherwise a
      // watch-only import only ever sees the very first address, and any
      // funds on addresses already used further down the chain look missing.
      setScanStatus("Scanning for used addresses…");
      await gapLimitScanXpub(trimmed, {
        change: 0,
        onProgress: ({ index }) => setScanStatus(`Scanning receiving addresses… (#${index})`),
      });
      await gapLimitScanXpub(trimmed, {
        change: 1,
        onProgress: ({ index }) => setScanStatus(`Scanning change addresses… (#${index})`),
      });

      navigation.reset({ index: 0, routes: [{ name: "SetPin" }] });
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
      setScanStatus("");
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Watch-Only Wallet</Text>
      <Text style={styles.body}>
        Paste an extended public key (zpub) to monitor balances and addresses without ever storing
        a private key on this device. You won't be able to send funds from a watch-only wallet.
      </Text>

      <TextInput
        style={styles.input}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="zpub6..."
        placeholderTextColor={colors.subtext}
        value={xpub}
        onChangeText={setXpub}
      />

      <TouchableOpacity style={styles.button} onPress={importXpub} disabled={loading}>
        {loading ? <ActivityIndicator color="#0B0B0F" /> : <Text style={styles.buttonText}>Import Watch-Only</Text>}
      </TouchableOpacity>

      {!!scanStatus && <Text style={styles.hint}>{scanStatus}</Text>}

      <Text style={styles.hint}>
        To generate your own zpub from a full BITGEN wallet: Settings → Export public key (zpub).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing(3) },
  heading: { fontSize: 22, color: colors.text, fontWeight: "700", marginBottom: spacing(1) },
  body: { fontSize: 14, color: colors.subtext, marginBottom: spacing(3), lineHeight: 20 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: spacing(2),
    color: colors.text, minHeight: 100, textAlignVertical: "top", marginBottom: spacing(3),
  },
  button: { backgroundColor: colors.orange, borderRadius: 14, paddingVertical: spacing(2), alignItems: "center" },
  buttonText: { color: "#0B0B0F", fontWeight: "700", fontSize: 16 },
  hint: { color: colors.subtext, fontSize: 11, textAlign: "center", marginTop: spacing(3) },
});
