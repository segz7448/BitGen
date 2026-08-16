import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { colors, spacing } from "../theme";
import { ASSET_IDS, getAsset } from "../wallet/assets";

// Same four assets the wallet already supports elsewhere (Swap, Send).
const PICKABLE = [ASSET_IDS.BTC, ASSET_IDS.USDT_TRC20, ASSET_IDS.USDT_ERC20, ASSET_IDS.USDT_BEP20];

/**
 * route.params.mode: "deposit" | "withdraw" — only changes the title/copy,
 * both modes list the same four assets and forward to the matching screen.
 */
export default function AssetPickerScreen({ route, navigation }) {
  const mode = route.params?.mode || "deposit";
  const isDeposit = mode === "deposit";

  const choose = (assetId) => {
    navigation.navigate(isDeposit ? "Deposit" : "Withdraw", { assetId });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(3) }}>
      <Text style={styles.title}>{isDeposit ? "Select a coin to deposit" : "Select a coin to withdraw"}</Text>
      <Text style={styles.subtitle}>
        {isDeposit
          ? "Choose which coin and network you want to receive."
          : "Choose which coin and network to send on-chain."}
      </Text>

      {PICKABLE.map((assetId) => {
        const asset = getAsset(assetId);
        return (
          <TouchableOpacity key={assetId} style={styles.row} onPress={() => choose(assetId)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.symbol}>{asset.symbol}</Text>
              <Text style={styles.chain}>{asset.displayName}</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: spacing(0.5) },
  subtitle: { color: colors.subtext, fontSize: 12, marginBottom: spacing(3), lineHeight: 17 },
  row: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderWidth: 1,
    borderColor: colors.border, borderRadius: 14, padding: spacing(2), marginBottom: spacing(1.5),
  },
  symbol: { color: colors.text, fontSize: 16, fontWeight: "700" },
  chain: { color: colors.subtext, fontSize: 12, marginTop: 2 },
  arrow: { color: colors.subtext, fontSize: 20 },
});
