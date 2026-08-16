import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, TextInput } from "react-native";
import { colors, spacing } from "../theme";
import { generateMnemonic } from "../wallet/hdWallet";

export default function CreateWalletScreen({ navigation }) {
  const [mnemonic] = useState(() => generateMnemonic(128)); // 12 words
  const [revealed, setRevealed] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const words = mnemonic.split(" ");

  const confirmUnderstanding = () => {
    Alert.alert(
      "Before you continue",
      "Anyone with these 12 words can take your funds. Anthropic and BITGEN have no way to recover them if you lose them. Write them down on paper — do not screenshot.",
      [
        { text: "Go back", style: "cancel" },
        { text: "I understand", onPress: () => navigation.navigate("ConfirmSeed", { mnemonic, passphrase }) },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(3) }}>
      <Text style={styles.heading}>Your Recovery Phrase</Text>
      <Text style={styles.body}>
        Write these 12 words down in order, on paper, and store them somewhere safe. This is the
        only way to recover your funds if this device is lost.
      </Text>

      {!revealed ? (
        <TouchableOpacity style={styles.revealButton} onPress={() => setRevealed(true)}>
          <Text style={styles.revealButtonText}>Tap to reveal</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.grid}>
          {words.map((w, i) => (
            <View key={i} style={styles.wordBox}>
              <Text style={styles.wordIndex}>{i + 1}</Text>
              <Text style={styles.wordText}>{w}</Text>
            </View>
          ))}
        </View>
      )}

      {revealed && (
        <>
          <TouchableOpacity onPress={() => setShowPassphrase((s) => !s)}>
            <Text style={styles.passphraseToggle}>
              {showPassphrase ? "Hide advanced options" : "Advanced: add a passphrase (25th word)"}
            </Text>
          </TouchableOpacity>

          {showPassphrase && (
            <View style={{ marginBottom: spacing(2) }}>
              <Text style={styles.body}>
                An optional extra word only you know. Forgetting it means permanent loss of funds
                secured behind it — most people should leave this blank.
              </Text>
              <TextInput
                style={styles.passphraseInput}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Optional passphrase"
                placeholderTextColor={colors.subtext}
                secureTextEntry
                value={passphrase}
                onChangeText={setPassphrase}
              />
            </View>
          )}

          <TouchableOpacity style={styles.continueButton} onPress={confirmUnderstanding}>
            <Text style={styles.continueButtonText}>I've written it down</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  heading: { fontSize: 22, color: colors.text, fontWeight: "700", marginBottom: spacing(1) },
  body: { fontSize: 14, color: colors.subtext, marginBottom: spacing(3), lineHeight: 20 },
  revealButton: {
    borderWidth: 1, borderColor: colors.orange, borderRadius: 14,
    paddingVertical: spacing(6), alignItems: "center",
  },
  revealButtonText: { color: colors.orange, fontWeight: "700", fontSize: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1), justifyContent: "space-between" },
  wordBox: {
    width: "31%", backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing(1.2), alignItems: "center", marginBottom: spacing(1),
  },
  wordIndex: { color: colors.subtext, fontSize: 10 },
  wordText: { color: colors.text, fontSize: 14, fontWeight: "600", marginTop: 2 },
  continueButton: { backgroundColor: colors.orange, borderRadius: 14, paddingVertical: spacing(2), alignItems: "center", marginTop: spacing(3) },
  continueButtonText: { color: "#0B0B0F", fontWeight: "700", fontSize: 16 },
  passphraseToggle: { color: colors.orange, fontSize: 12, marginTop: spacing(3), marginBottom: spacing(1) },
  passphraseInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(1.5),
    color: colors.text, marginTop: spacing(1),
  },
});
