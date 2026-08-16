import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { colors, spacing } from "../theme";
import { saveMnemonic, savePassphrase } from "../wallet/secureSeed";
import { generateAddressBatch } from "../wallet/hdWallet";
import { addAddress, setCurrentAddress } from "../db/addressRepo";

// Pick 3 random word positions the user must confirm, to prove they saved it.
function pickChallengeIndices(wordCount) {
  const idxs = new Set();
  while (idxs.size < 3) {
    idxs.add(Math.floor(Math.random() * wordCount));
  }
  return [...idxs].sort((a, b) => a - b);
}

export default function ConfirmSeedScreen({ route, navigation }) {
  const { mnemonic, passphrase } = route.params;
  const words = useMemo(() => mnemonic.split(" "), [mnemonic]);
  const challengeIndices = useMemo(() => pickChallengeIndices(words.length), [words.length]);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);

  // Computed once per mnemonic/challenge set, not on every render — this
  // is what's used to build each challenge's answer buttons. If this were
  // recomputed on every render (e.g. inline in the JSX below), then every
  // tap — which changes `answers` and re-renders — would reshuffle the
  // options and move the buttons out from under the user's next tap.
  const optionsByIndex = useMemo(() => {
    const map = {};
    for (const idx of challengeIndices) {
      const correctWord = words[idx];
      const decoys = words.filter((w) => w !== correctWord);
      const shuffledDecoys = [...decoys].sort(() => Math.random() - 0.5).slice(0, 2);
      map[idx] = [...shuffledDecoys, correctWord].sort(() => Math.random() - 0.5);
    }
    return map;
  }, [words, challengeIndices]);

  const allCorrect = challengeIndices.every((idx) => answers[idx] === words[idx]);

  const finish = async () => {
    if (!allCorrect) {
      Alert.alert("Not quite", "One or more words don't match. Please check your backup.");
      return;
    }
    setSaving(true);
    try {
      await saveMnemonic(mnemonic);
      if (passphrase) await savePassphrase(passphrase);
      const initialAddrs = generateAddressBatch(mnemonic, 1, 0, 0, passphrase);
      for (const a of initialAddrs) {
        await addAddress(a);
      }
      await setCurrentAddress(initialAddrs[0].address);
      // Set up an app-unlock PIN before landing in the wallet — protects
      // against anyone who picks up an unlocked phone.
      navigation.reset({ index: 0, routes: [{ name: "SetPin" }] });
    } catch (e) {
      Alert.alert("Error", "Could not save wallet: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Confirm Your Backup</Text>
      <Text style={styles.body}>Select the correct word for each position to continue.</Text>

      {challengeIndices.map((idx) => (
        <View key={idx} style={styles.challenge}>
          <Text style={styles.challengeLabel}>Word #{idx + 1}</Text>
          <View style={styles.optionsRow}>
            {optionsByIndex[idx].map((opt) => {
              const selected = answers[idx] === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => setAnswers((prev) => ({ ...prev, [idx]: opt }))}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.confirmButton, !allCorrect && styles.confirmButtonDisabled]}
        disabled={!allCorrect || saving}
        onPress={finish}
      >
        {saving ? <ActivityIndicator color="#0B0B0F" /> : <Text style={styles.confirmButtonText}>Confirm & Create Wallet</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing(3) },
  heading: { fontSize: 22, color: colors.text, fontWeight: "700", marginBottom: spacing(1) },
  body: { fontSize: 14, color: colors.subtext, marginBottom: spacing(3) },
  challenge: { marginBottom: spacing(3) },
  challengeLabel: { color: colors.text, fontWeight: "600", marginBottom: spacing(1) },
  optionsRow: { flexDirection: "row", gap: spacing(1) },
  option: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: spacing(1.5), alignItems: "center" },
  optionSelected: { borderColor: colors.orange, backgroundColor: "#2A1F0F" },
  optionText: { color: colors.subtext, fontWeight: "600" },
  optionTextSelected: { color: colors.orange },
  confirmButton: { backgroundColor: colors.orange, borderRadius: 14, paddingVertical: spacing(2), alignItems: "center", marginTop: spacing(2) },
  confirmButtonDisabled: { opacity: 0.4 },
  confirmButtonText: { color: "#0B0B0F", fontWeight: "700", fontSize: 16 },
});
