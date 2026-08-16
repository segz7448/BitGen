import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { colors, spacing } from "../theme";
import { readBackupFile, decryptBackup } from "../wallet/backup";
import { saveMnemonic, savePassphrase } from "../wallet/secureSeed";
import { generateAddressBatch } from "../wallet/hdWallet";
import { addAddress, setCurrentAddress } from "../db/addressRepo";
import { gapLimitScan } from "../wallet/sync";

export default function ImportBackupScreen({ navigation }) {
  const [fileUri, setFileUri] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/json" });
    if (result.canceled) return;
    setFileUri(result.assets[0].uri);
    setFileName(result.assets[0].name);
  };

  const restore = async () => {
    if (!fileUri) {
      Alert.alert("No file selected", "Pick a BITGEN backup file first.");
      return;
    }
    setLoading(true);
    try {
      const contents = await readBackupFile(fileUri);
      const { mnemonic, passphrase } = decryptBackup(contents, password);

      await saveMnemonic(mnemonic);
      if (passphrase) await savePassphrase(passphrase);
      const initialAddrs = generateAddressBatch(mnemonic, 1, 0, 0, passphrase);
      for (const a of initialAddrs) await addAddress(a);
      await setCurrentAddress(initialAddrs[0].address);

      // Restore full address history via gap-limit scan, same as a fresh import.
      await gapLimitScan(mnemonic, { change: 0, passphrase });
      await gapLimitScan(mnemonic, { change: 1, passphrase });

      navigation.reset({ index: 0, routes: [{ name: "SetPin" }] });
    } catch (e) {
      Alert.alert("Restore failed", e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Restore from Backup</Text>

      <TouchableOpacity style={styles.picker} onPress={pickFile}>
        <Text style={styles.pickerText}>{fileName || "Select backup file"}</Text>
      </TouchableOpacity>

      <TextInput
        style={styles.input}
        placeholder="Backup password"
        placeholderTextColor={colors.subtext}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity style={styles.button} onPress={restore} disabled={loading}>
        {loading ? <ActivityIndicator color="#0B0B0F" /> : <Text style={styles.buttonText}>Restore Wallet</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing(3) },
  heading: { fontSize: 20, color: colors.text, fontWeight: "700", marginBottom: spacing(3) },
  picker: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(2), marginBottom: spacing(2) },
  pickerText: { color: colors.text, fontSize: 13 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(1.5), color: colors.text, marginBottom: spacing(3) },
  button: { backgroundColor: colors.orange, borderRadius: 14, paddingVertical: spacing(2), alignItems: "center" },
  buttonText: { color: "#0B0B0F", fontWeight: "700", fontSize: 16 },
});
