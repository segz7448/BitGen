import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { spacing, useTheme } from "../theme";
import { ASSET_IDS, getAsset } from "../wallet/assets";
import {
  getCurrentAddress,
  getActiveAddresses,
  setCurrentAddress,
  generateNextAddress,
  generateNextAddressFromXpub,
} from "../db/addressRepo";
import { loadMnemonic, loadPassphrase } from "../wallet/secureSeed";
import { isWatchOnly, getStoredXpub } from "../wallet/walletMode";
import { getOrCreateAddress, generateNextAccountAddress } from "../wallet/multiAssetAddress";
import { GlassCard } from "../components/Glass";

const NETWORK_LABEL = {
  USDT_TRC20: "TRC20 (Tron)",
  USDT_ERC20: "ERC20 (Ethereum)",
  USDT_BEP20: "BEP20 (BNB Smart Chain)",
  ETH_ETHEREUM: "Ethereum Mainnet",
  ETH_MORPH: "Morph",
  ETH_BEP20: "BEP20 (BNB Smart Chain)",
};

/**
 * BTC and account-model assets (USDT/ETH variants) share the same
 * switch/generate UI now — BTC generates a fresh address per receive by
 * convention (see ReceiveScreen), account-model assets default to one
 * reused address but can add more the same way if wanted (mirrors
 * MetaMask's "Add account"). Every address stays fully active and
 * watched once created; nothing is ever deactivated by switching.
 */
export default function DepositScreen({ route }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const assetId = route.params?.assetId || ASSET_IDS.BTC;
  const asset = getAsset(assetId);
  const isBtc = assetId === ASSET_IDS.BTC;

  const [current, setCurrent] = useState(null);
  const [activeAddrs, setActiveAddrs] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [watchOnly, setWatchOnly] = useState(false);

  const refresh = useCallback(async () => {
    const wo = await isWatchOnly();
    setWatchOnly(wo);
    if (isBtc) {
      setCurrent(await getCurrentAddress());
      setActiveAddrs(await getActiveAddresses(0));
      setLoading(false);
      return;
    }
    try {
      if (wo) {
        const existing = await getCurrentAddress(assetId);
        setCurrent(existing || null);
      } else {
        const mnemonic = await loadMnemonic();
        const passphrase = await loadPassphrase();
        await getOrCreateAddress(assetId, mnemonic, passphrase); // no-ops if one already exists
        setCurrent(await getCurrentAddress(assetId));
      }
      setActiveAddrs(await getActiveAddresses(0, assetId));
    } catch (e) {
      Alert.alert("Couldn't load address", e.message);
    } finally {
      setLoading(false);
    }
  }, [assetId, isBtc]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const copyAddress = async () => {
    if (!current) return;
    await Clipboard.setStringAsync(current.address);
    Alert.alert("Copied", "Address copied to clipboard.");
  };

  const switchTo = async (address) => {
    await setCurrentAddress(address, assetId);
    setShowPicker(false);
    refresh();
  };

  const generateNew = async () => {
    setGenerating(true);
    try {
      if (watchOnly) {
        if (!isBtc) {
          Alert.alert("Not available", "Watch-only wallets have no private key on this device to derive a new address from.");
          return;
        }
        const xpub = await getStoredXpub();
        await generateNextAddressFromXpub(xpub);
      } else {
        const mnemonic = await loadMnemonic();
        const passphrase = await loadPassphrase();
        if (isBtc) {
          await generateNextAddress(mnemonic, passphrase);
        } else {
          await generateNextAccountAddress(assetId, mnemonic, passphrase);
        }
      }
      await refresh();
      setShowPicker(false);
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.orange} style={{ marginTop: spacing(6) }} />
      </View>
    );
  }

  if (!current) {
    return (
      <View style={styles.container}>
        <Text style={styles.note}>No address set up for this asset on this device yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.assetLabel}>
        Deposit {asset.symbol}{!isBtc ? ` · ${NETWORK_LABEL[assetId] || asset.displayName}` : ""}
      </Text>

      <View style={styles.qrCard}>
        <QRCode value={isBtc ? `bitcoin:${current.address}` : current.address} size={220} backgroundColor="#FFFFFF" />
      </View>

      <TouchableOpacity onPress={copyAddress}>
        <GlassCard style={styles.addressCard}>
          <Text style={styles.address}>{current.address}</Text>
          <Text style={styles.tapToCopy}>Tap to copy</Text>
        </GlassCard>
      </TouchableOpacity>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowPicker((s) => !s)}>
          <Text style={styles.secondaryButtonText}>
            {showPicker ? "Hide addresses" : `Switch address (${activeAddrs.length} active)`}
          </Text>
        </TouchableOpacity>
        {!watchOnly && (
          <TouchableOpacity style={styles.primaryButton} onPress={generateNew} disabled={generating}>
            <Text style={styles.primaryButtonText}>{generating ? "Generating…" : "+ New address"}</Text>
          </TouchableOpacity>
        )}
      </View>

      {showPicker && (
        <FlatList
          style={{ marginTop: spacing(2), width: "100%" }}
          data={activeAddrs}
          keyExtractor={(item) => item.address}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => switchTo(item.address)} style={{ width: "100%" }}>
              <GlassCard style={[styles.addrRow, item.address === current.address && styles.addrRowActive]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.addrText} numberOfLines={1}>{item.address}</Text>
                  <Text style={styles.addrMeta}>
                    {item.label || `Address #${item.derivation_index}`}
                    {isBtc ? ` · ${item.balance_sats} sats` : ""}
                  </Text>
                </View>
                {item.address === current.address && <Text style={styles.currentTag}>CURRENT</Text>}
              </GlassCard>
            </TouchableOpacity>
          )}
        />
      )}

      <Text style={styles.note}>
        {isBtc
          ? "Every address listed here is still active and can receive funds — switching or generating a new one doesn't disable the old ones. Manage that from the Addresses screen."
          : `Only send ${asset.symbol} on ${NETWORK_LABEL[assetId] || asset.chain} to this address, or your funds may be lost. Adding another address here is optional — most people just reuse one, like MetaMask.`}
      </Text>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, padding: spacing(3), alignItems: "center" },
    assetLabel: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: spacing(2) },
    qrCard: { backgroundColor: "#FFFFFF", padding: spacing(2), borderRadius: 16, marginTop: spacing(1) },
    addressCard: { marginTop: spacing(3), padding: spacing(2), width: "100%" },
    address: { color: colors.text, fontSize: 13, textAlign: "center" },
    tapToCopy: { color: colors.subtext, fontSize: 11, textAlign: "center", marginTop: 4 },
    buttonRow: { flexDirection: "row", gap: spacing(1.5), marginTop: spacing(3), width: "100%" },
    secondaryButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: spacing(1.5), alignItems: "center" },
    secondaryButtonText: { color: colors.text, fontSize: 13, fontWeight: "600" },
    primaryButton: { flex: 1, backgroundColor: colors.orange, borderRadius: 12, paddingVertical: spacing(1.5), alignItems: "center" },
    primaryButtonText: { color: "#0B0B0F", fontSize: 13, fontWeight: "700" },
    addrRow: {
      flexDirection: "row", alignItems: "center", padding: spacing(1.5), marginBottom: spacing(1), width: "100%",
    },
    addrRowActive: { borderColor: colors.orange },
    addrText: { color: colors.text, fontSize: 12 },
    addrMeta: { color: colors.subtext, fontSize: 11, marginTop: 2 },
    currentTag: { color: colors.orange, fontSize: 10, fontWeight: "700", marginLeft: spacing(1) },
    note: { color: colors.subtext, fontSize: 11, textAlign: "center", marginTop: spacing(3), lineHeight: 16 },
  });
}
