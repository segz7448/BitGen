import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { colors, spacing } from "../theme";
import { validateMnemonic, generateAddressBatch } from "../wallet/hdWallet";
import { saveMnemonic, savePassphrase } from "../wallet/secureSeed";
import { addAddress, setCurrentAddress } from "../db/addressRepo";
import { gapLimitScan } from "../wallet/sync";

export default function ImportWalletScreen({ navigation }) {
  const [input, setInput] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanStatus, setScanStatus] = useState("");

  const importWallet = async () => {
    const mnemonic = input.trim().toLowerCase().replace(/\s+/g, " ");
    if (!validateMnemonic(mnemonic)) {
      Alert.alert("Invalid phrase", "Check the word order and spelling — this doesn't look like a valid BIP39 seed phrase.");
      return;
    }
    setLoading(true);
    try {
      await saveMnemonic(mnemonic);
      if (passphrase) await savePassphrase(passphrase);

      const initialAddrs = generateAddressBatch(mnemonic, 1, 0, 0, passphrase);
      for (const a of initialAddrs) await addAddress(a);
      await setCurrentAddress(initialAddrs[0].address);

      // Walk the full derivation path against the chain to recover every
      // address this seed has ever used — not just the first one.
      setScanStatus("Scanning for used addresses…");
      const receiveResult = await gapLimitScan(mnemonic, {
        change: 0,
        passphrase,
        onProgress: ({ index }) => setScanStatus(`Scanning receiving addresses… (#${index})`),
      });
      const changeResult = await gapLimitScan(mnemonic, {
        change: 1,
        passphrase,
        onProgress: ({ index }) => setScanStatus(`Scanning change addresses… (#${index})`),
      });

      const total = receiveResult.addressesFound + changeResult.addressesFound;
      if (total > 0) {
        Alert.alert("Wallet restored", `Found ${total} previously used address(es) with history.`);
      }

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
      <Text style={styles.heading}>Import Wallet</Text>
      <Text style={styles.body}>Enter your 12 or 24-word recovery phrase, separated by spaces.</Text>

      <TextInput
        style={styles.input}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="word1 word2 word3 ..."
        placeholderTextColor={colors.subtext}
        value={input}
        onChangeText={setInput}
      />

      <TouchableOpacity onPress={() => setShowPassphrase((s) => !s)}>
        <Text style={styles.passphraseToggle}>
          {showPassphrase ? "Hide advanced options" : "Advanced: I have a passphrase (25th word)"}
        </Text>
      </TouchableOpacity>

      {showPassphrase && (
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Optional passphrase"
          placeholderTextColor={colors.subtext}
          secureTextEntry
          value={passphrase}
          onChangeText={setPassphrase}
        />
      )}

      <TouchableOpacity style={styles.button} onPress={importWallet} disabled={loading}>
        {loading ? <ActivityIndicator color="#0B0B0F" /> : <Text style={styles.buttonText}>Import</Text>}
      </TouchableOpacity>

      {!!scanStatus && <Text style={styles.scanStatus}>{scanStatus}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing(3) },
  heading: { fontSize: 22, color: colors.text, fontWeight: "700", marginBottom: spacing(1) },
  body: { fontSize: 14, color: colors.subtext, marginBottom: spacing(3) },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: spacing(2),
    color: colors.text, minHeight: 60, textAlignVertical: "top", marginBottom: spacing(2),
  },
  passphraseToggle: { color: colors.orange, fontSize: 12, marginBottom: spacing(2) },
  button: { backgroundColor: colors.orange, borderRadius: 14, paddingVertical: spacing(2), alignItems: "center" },
  buttonText: { color: "#0B0B0F", fontWeight: "700", fontSize: 16 },
  scanStatus: { color: colors.subtext, fontSize: 12, textAlign: "center", marginTop: spacing(2) },
});
