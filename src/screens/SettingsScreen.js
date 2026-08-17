import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Switch } from "react-native";
import * as Clipboard from "expo-clipboard";
import { spacing, useTheme } from "../theme";
import { loadMnemonic, deleteMnemonic, loadPassphrase } from "../wallet/secureSeed";
import { resetDatabase } from "../db/database";
import { getAccountXpub } from "../wallet/hdWallet";
import { isWatchOnly } from "../wallet/walletMode";
import { hasPin, clearPin } from "../wallet/appLock";
import { requestLock } from "../wallet/lockBus";

const APPEARANCE_OPTIONS = [
  { key: "system", label: "System" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];

export default function SettingsScreen({ navigation }) {
  const { colors, pref, setMode } = useTheme();
  const styles = makeStyles(colors);
  const [revealedSeed, setRevealedSeed] = useState(null);
  const [watchOnly, setWatchOnly] = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);

  useEffect(() => {
    isWatchOnly().then(setWatchOnly);
    hasPin().then(setPinEnabled);
  }, []);

  const revealSeed = () => {
    Alert.alert(
      "View recovery phrase",
      "Make sure no one is watching your screen. Anyone who sees these words can steal your funds.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Show",
          onPress: async () => {
            const m = await loadMnemonic();
            setRevealedSeed(m);
          },
        },
      ]
    );
  };

  const copySeed = async () => {
    if (!revealedSeed) return;
    await Clipboard.setStringAsync(revealedSeed);
    Alert.alert("Copied", "Clear your clipboard after you're done using it.");
  };

  const exportXpub = async () => {
    try {
      const mnemonic = await loadMnemonic();
      const passphrase = await loadPassphrase();
      const xpub = getAccountXpub(mnemonic, passphrase);
      await Clipboard.setStringAsync(xpub);
      Alert.alert("Public key copied", "This zpub can be imported into another device as watch-only. It cannot spend funds.");
    } catch (e) {
      Alert.alert("Error", e.message);
    }
  };

  const togglePinLock = async () => {
    if (pinEnabled) {
      Alert.alert("Turn off PIN lock?", "Anyone with this device could then open BITGEN directly.", [
        { text: "Cancel", style: "cancel" },
        { text: "Turn off", style: "destructive", onPress: async () => { await clearPin(); setPinEnabled(false); } },
      ]);
    } else {
      navigation.navigate("SetPin");
    }
  };

  const deleteWallet = () => {
    Alert.alert(
      "Delete this wallet from device?",
      "Make sure you've backed up your recovery phrase first. Without it, any funds in this wallet are permanently unrecoverable.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteMnemonic();
            await clearPin();
            await resetDatabase();
            navigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
          },
        },
      ]
    );
  };

  const logout = () => {
    if (!pinEnabled) {
      Alert.alert(
        "Set a PIN first",
        "Logout locks the app behind your PIN. Turn on App lock above, then Logout will be available.",
      );
      return;
    }
    Alert.alert("Log out?", "You'll need your PIN or biometrics to open BITGEN again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", onPress: () => requestLock() },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(3) }}>
      <Text style={styles.sectionTitle}>Appearance</Text>
      <View style={styles.segmentRow}>
        {APPEARANCE_OPTIONS.map((opt) => {
          const active = pref === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.segment, active && styles.segmentActive]}
              onPress={() => setMode(opt.key)}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>Security</Text>
      <View style={styles.row}>
        <Text style={styles.rowText}>App lock (PIN)</Text>
        <Switch value={pinEnabled} onValueChange={togglePinLock} trackColor={{ false: colors.border, true: colors.orange }} thumbColor="#FFFFFF" />
      </View>
      <TouchableOpacity style={[styles.row, !pinEnabled && styles.rowDisabled]} onPress={logout}>
        <Text style={[styles.rowText, !pinEnabled && styles.rowTextDisabled]}>Log out</Text>
      </TouchableOpacity>

      {!watchOnly && (
        <>
          <Text style={styles.sectionTitle}>Backup</Text>
          <TouchableOpacity style={styles.row} onPress={revealSeed}>
            <Text style={styles.rowText}>View recovery phrase</Text>
          </TouchableOpacity>

          {revealedSeed && (
            <View style={styles.seedBox}>
              <Text style={styles.seedText}>{revealedSeed}</Text>
              <TouchableOpacity onPress={copySeed}>
                <Text style={styles.copyLink}>Copy to clipboard</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setRevealedSeed(null)}>
                <Text style={styles.hideLink}>Hide</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("ExportBackup")}>
            <Text style={styles.rowText}>Export encrypted backup file</Text>
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>Watch-Only Access</Text>
          <TouchableOpacity style={styles.row} onPress={exportXpub}>
            <Text style={styles.rowText}>Export public key (zpub)</Text>
          </TouchableOpacity>
        </>
      )}

      <Text style={styles.sectionTitle}>Network</Text>
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          BITGEN connects to public Esplora servers (blockstream.info, mempool.space) to check
          balances and broadcast transactions, and CoinGecko for fiat price display. These
          services can see which addresses you query, but never your private keys or seed phrase.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Danger Zone</Text>
      <TouchableOpacity style={[styles.row, styles.dangerRow]} onPress={deleteWallet}>
        <Text style={styles.dangerText}>Delete wallet from this device</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    sectionTitle: { color: colors.subtext, fontSize: 12, fontWeight: "700", marginTop: spacing(3), marginBottom: spacing(1), textTransform: "uppercase" },
    segmentRow: {
      flexDirection: "row", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
      borderRadius: 12, padding: 4, marginBottom: spacing(1),
    },
    segment: { flex: 1, paddingVertical: spacing(1.2), borderRadius: 9, alignItems: "center" },
    segmentActive: { backgroundColor: colors.orange },
    segmentText: { color: colors.subtext, fontSize: 13, fontWeight: "600" },
    segmentTextActive: { color: "#0B0B0F" },
    row: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(2), marginBottom: spacing(1),
    },
    rowText: { color: colors.text, fontSize: 14 },
    rowDisabled: { opacity: 0.5 },
    rowTextDisabled: { color: colors.subtext },
    seedBox: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.orange, borderRadius: 12, padding: spacing(2), marginTop: spacing(1), marginBottom: spacing(1) },
    seedText: { color: colors.text, fontSize: 14, lineHeight: 22 },
    copyLink: { color: colors.orange, marginTop: spacing(1), fontWeight: "600" },
    hideLink: { color: colors.subtext, marginTop: spacing(1) },
    infoBox: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(2) },
    infoText: { color: colors.subtext, fontSize: 12, lineHeight: 18 },
    dangerRow: { borderColor: colors.red },
    dangerText: { color: colors.red, fontSize: 14, fontWeight: "600" },
  });
}
