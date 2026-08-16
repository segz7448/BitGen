import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { colors, spacing } from "../theme";

export default function WelcomeScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <View style={styles.logoWrap}>
        <Text style={styles.logoB}>₿</Text>
        <Text style={styles.title}>BITGEN</Text>
        <Text style={styles.subtitle}>Your keys. Your Bitcoin. Your device.</Text>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={() => navigation.navigate("CreateWallet")}
        >
          <Text style={styles.primaryButtonText}>Create New Wallet</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => navigation.navigate("ImportWallet")}
        >
          <Text style={styles.secondaryButtonText}>Import Existing Wallet</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => navigation.navigate("ImportBackup")}
        >
          <Text style={styles.secondaryButtonText}>Restore from Encrypted Backup</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("WatchOnlyImport")}>
          <Text style={styles.watchOnlyLink}>Add a watch-only wallet instead →</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footnote}>
        No account. No server. No custody. Your seed phrase never leaves this device.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing(3), justifyContent: "space-between" },
  logoWrap: { alignItems: "center", marginTop: spacing(12) },
  logoB: { fontSize: 72, color: colors.orange, fontWeight: "700" },
  title: { fontSize: 32, color: colors.text, fontWeight: "700", letterSpacing: 2, marginTop: spacing(1) },
  subtitle: { fontSize: 14, color: colors.subtext, marginTop: spacing(1) },
  buttons: { gap: spacing(2) },
  button: { paddingVertical: spacing(2), borderRadius: 14, alignItems: "center" },
  primaryButton: { backgroundColor: colors.orange },
  primaryButtonText: { color: "#0B0B0F", fontSize: 16, fontWeight: "700" },
  secondaryButton: { borderWidth: 1, borderColor: colors.border },
  secondaryButtonText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  footnote: { color: colors.subtext, fontSize: 12, textAlign: "center", marginBottom: spacing(3) },
  watchOnlyLink: { color: colors.subtext, fontSize: 12, textAlign: "center", marginTop: spacing(1) },
});
