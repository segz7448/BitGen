import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { colors, spacing } from "../theme";
import { loadMnemonic, loadPassphrase } from "../wallet/secureSeed";
import { exportEncryptedBackup } from "../wallet/backup";

export default function ExportBackupScreen() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const doExport = async () => {
    if (password.length < 8) {
      Alert.alert("Weak password", "Use at least 8 characters — this is the only thing protecting the backup file.");
      return;
    }
    if (password !== confirm) {
      Alert.alert("Passwords don't match", "Please re-enter matching passwords.");
      return;
    }
    setLoading(true);
    try {
      const mnemonic = await loadMnemonic();
      const passphrase = await loadPassphrase();
      await exportEncryptedBackup(mnemonic, passphrase, password);
      Alert.alert(
        "Backup created",
        "Store this file and password somewhere safe and separate from each other. Anyone with both can access your funds."
      );
      setPassword("");
      setConfirm("");
    } catch (e) {
      Alert.alert("Export failed", e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Export Encrypted Backup</Text>
      <Text style={styles.body}>
        Creates a password-protected file containing your seed phrase. Keep the file and password
        stored separately — anyone with both can spend your funds.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Password (min 8 characters)"
        placeholderTextColor={colors.subtext}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm password"
        placeholderTextColor={colors.subtext}
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
      />

      <TouchableOpacity style={styles.button} onPress={doExport} disabled={loading}>
        {loading ? <ActivityIndicator color="#0B0B0F" /> : <Text style={styles.buttonText}>Create & Share Backup</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing(3) },
  heading: { fontSize: 20, color: colors.text, fontWeight: "700", marginBottom: spacing(1) },
  body: { fontSize: 13, color: colors.subtext, marginBottom: spacing(3), lineHeight: 19 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(1.5), color: colors.text, marginBottom: spacing(2) },
  button: { backgroundColor: colors.orange, borderRadius: 14, paddingVertical: spacing(2), alignItems: "center" },
  buttonText: { color: "#0B0B0F", fontWeight: "700", fontSize: 16 },
});
