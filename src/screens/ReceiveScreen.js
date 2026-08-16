import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { colors, spacing } from "../theme";
import {
  getCurrentAddress,
  getActiveAddresses,
  setCurrentAddress,
  generateNextAddress,
  generateNextAddressFromXpub,
} from "../db/addressRepo";
import { loadMnemonic, loadPassphrase } from "../wallet/secureSeed";
import { isWatchOnly, getStoredXpub } from "../wallet/walletMode";

export default function ReceiveScreen() {
  const [current, setCurrent] = useState(null);
  const [activeAddrs, setActiveAddrs] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [generating, setGenerating] = useState(false);

  const refresh = useCallback(async () => {
    setCurrent(await getCurrentAddress());
    setActiveAddrs(await getActiveAddresses(0));
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const copyAddress = async () => {
    if (!current) return;
    await Clipboard.setStringAsync(current.address);
    Alert.alert("Copied", "Address copied to clipboard.");
  };

  const switchTo = async (address) => {
    await setCurrentAddress(address);
    setShowPicker(false);
    refresh();
  };

  const generateNew = async () => {
    setGenerating(true);
    try {
      if (await isWatchOnly()) {
        // Watch-only wallets have no mnemonic on-device — derive from the
        // stored xpub/zpub instead.
        const xpub = await getStoredXpub();
        await generateNextAddressFromXpub(xpub);
      } else {
        const mnemonic = await loadMnemonic();
        const passphrase = await loadPassphrase();
        await generateNextAddress(mnemonic, passphrase);
      }
      await refresh();
      setShowPicker(false);
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setGenerating(false);
    }
  };

  if (!current) return <View style={styles.container} />;

  return (
    <View style={styles.container}>
      <View style={styles.qrCard}>
        <QRCode value={`bitcoin:${current.address}`} size={220} backgroundColor="#FFFFFF" />
      </View>

      <TouchableOpacity onPress={copyAddress}>
        <Text style={styles.address}>{current.address}</Text>
        <Text style={styles.tapToCopy}>Tap to copy</Text>
      </TouchableOpacity>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowPicker((s) => !s)}>
          <Text style={styles.secondaryButtonText}>
            {showPicker ? "Hide addresses" : `Switch address (${activeAddrs.length} active)`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={generateNew} disabled={generating}>
          <Text style={styles.primaryButtonText}>{generating ? "Generating…" : "+ New address"}</Text>
        </TouchableOpacity>
      </View>

      {showPicker && (
        <FlatList
          style={{ marginTop: spacing(2) }}
          data={activeAddrs}
          keyExtractor={(item) => item.address}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.addrRow, item.address === current.address && styles.addrRowActive]}
              onPress={() => switchTo(item.address)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.addrText} numberOfLines={1}>{item.address}</Text>
                <Text style={styles.addrMeta}>
                  {item.label || `Address #${item.derivation_index}`} · {item.balance_sats} sats
                </Text>
              </View>
              {item.address === current.address && <Text style={styles.currentTag}>CURRENT</Text>}
            </TouchableOpacity>
          )}
        />
      )}

      <Text style={styles.note}>
        Every address listed here is still active and can receive funds — switching or generating a
        new one doesn't disable the old ones. Manage that from the Addresses screen.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing(3), alignItems: "center" },
  qrCard: { backgroundColor: "#FFFFFF", padding: spacing(2), borderRadius: 16, marginTop: spacing(2) },
  address: { color: colors.text, fontSize: 13, marginTop: spacing(3), textAlign: "center", paddingHorizontal: spacing(2) },
  tapToCopy: { color: colors.subtext, fontSize: 11, textAlign: "center", marginTop: 4 },
  buttonRow: { flexDirection: "row", gap: spacing(1.5), marginTop: spacing(3), width: "100%" },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: spacing(1.5), alignItems: "center" },
  secondaryButtonText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  primaryButton: { flex: 1, backgroundColor: colors.orange, borderRadius: 12, paddingVertical: spacing(1.5), alignItems: "center" },
  primaryButtonText: { color: "#0B0B0F", fontSize: 13, fontWeight: "700" },
  addrRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, padding: spacing(1.5), marginBottom: spacing(1), width: "100%",
  },
  addrRowActive: { borderColor: colors.orange },
  addrText: { color: colors.text, fontSize: 12 },
  addrMeta: { color: colors.subtext, fontSize: 11, marginTop: 2 },
  currentTag: { color: colors.orange, fontSize: 10, fontWeight: "700", marginLeft: spacing(1) },
  note: { color: colors.subtext, fontSize: 11, textAlign: "center", marginTop: spacing(3), lineHeight: 16 },
});
