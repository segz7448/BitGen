import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, useTheme } from "../theme";
import { getAsset } from "../wallet/assets";

// Static, illustrative per-network info shown in the picker — matches the
// shape of what exchanges show (confirmations/min deposit), but timing is
// deliberately vague ("varies with network congestion") rather than a
// fixed minute count, since actual confirmation time is chain-driven and
// promising a fixed number in a wallet's own UI would be misleading.
const NETWORK_META = {
  USDT_TRC20: { label: "TRC20 (Tron)", confirmations: "3", minDeposit: "0.01 USDT" },
  USDT_ERC20: { label: "ERC20 (Ethereum)", confirmations: "12", minDeposit: "0.5 USDT" },
  USDT_BEP20: { label: "BEP20 (BNB Smart Chain)", confirmations: "15", minDeposit: "0.01 USDT" },
  ETH_ETHEREUM: { label: "Ethereum Mainnet", confirmations: "12", minDeposit: "0.001 ETH" },
  ETH_MORPH: { label: "Morph", confirmations: "1", minDeposit: "0.001 ETH" },
  ETH_BEP20: { label: "BEP20 (BNB Smart Chain)", confirmations: "15", minDeposit: "0.001 ETH" },
};

/**
 * Bottom-sheet network picker — tap "USDT" once, then choose which chain
 * (each chain is a distinct assetId under the hood, since this wallet
 * derives and stores a separate address per USDT network).
 */
export default function NetworkPickerSheet({ visible, onClose, assetIds, onSelect }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Choose network</Text>

        <View style={styles.warning}>
          <Ionicons name="alert-circle" size={18} color={colors.orange} style={{ marginRight: 8, marginTop: 1 }} />
          <Text style={styles.warningText}>
            Ensure the network you select matches the withdrawal platform, or your assets may be lost.
          </Text>
        </View>

        {assetIds.map((assetId) => {
          const asset = getAsset(assetId);
          const meta = NETWORK_META[assetId];
          return (
            <TouchableOpacity
              key={assetId}
              style={styles.row}
              onPress={() => {
                onClose();
                onSelect(assetId);
              }}
            >
              <Text style={styles.rowTitle}>{meta?.label || asset.displayName}</Text>
              <Text style={styles.rowMeta}>
                {meta?.confirmations} block confirmation(s) · Min deposit: {meta?.minDeposit}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Modal>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.overlay },
    sheet: {
      backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: spacing(3), paddingBottom: spacing(4),
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing(2) },
    title: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: spacing(2) },
    warning: {
      flexDirection: "row", backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
      borderRadius: 12, padding: spacing(1.5), marginBottom: spacing(2),
    },
    warningText: { color: colors.subtext, fontSize: 12, lineHeight: 17, flex: 1 },
    row: {
      borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: spacing(2),
      marginBottom: spacing(1.25),
    },
    rowTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
    rowMeta: { color: colors.subtext, fontSize: 12, marginTop: 4 },
  });
}
