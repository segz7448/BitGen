import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { spacing, useTheme } from "../theme";
import { ASSET_IDS } from "../wallet/assets";
import { GlassCard } from "../components/Glass";
import NetworkPickerSheet from "../components/NetworkPickerSheet";

const USDT_VARIANTS = [ASSET_IDS.USDT_TRC20, ASSET_IDS.USDT_ERC20, ASSET_IDS.USDT_BEP20];

// Grouped by symbol first — BTC is its own network, USDT expands into a
// network picker on tap (matches the reference "tap USDT → choose
// network" flow instead of listing three separate USDT rows).
const GROUPS = [
  { key: "BTC", symbol: "BTC", name: "Bitcoin", single: ASSET_IDS.BTC },
  { key: "USDT", symbol: "USDT", name: "Tether", variants: USDT_VARIANTS },
];

/**
 * route.params.mode: "deposit" | "withdraw" — only changes the title/copy,
 * both modes forward to the matching screen once a specific assetId
 * (including, for USDT, a specific network) is chosen.
 */
export default function AssetPickerScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const mode = route.params?.mode || "deposit";
  const isDeposit = mode === "deposit";
  const [networkSheetFor, setNetworkSheetFor] = useState(null);

  const choose = (assetId) => {
    navigation.navigate(isDeposit ? "Deposit" : "Withdraw", { assetId });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(3) }}>
      <Text style={styles.title}>{isDeposit ? "Select a coin to deposit" : "Select a coin to withdraw"}</Text>
      <Text style={styles.subtitle}>
        {isDeposit
          ? "Choose which coin you want to receive. USDT will ask which network next."
          : "Choose which coin to send on-chain. USDT will ask which network next."}
      </Text>

      {GROUPS.map((group) => (
        <TouchableOpacity
          key={group.key}
          onPress={() => (group.single ? choose(group.single) : setNetworkSheetFor(group.variants))}
        >
          <GlassCard style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.symbol}>{group.symbol}</Text>
              <Text style={styles.chain}>{group.name}</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </GlassCard>
        </TouchableOpacity>
      ))}

      <NetworkPickerSheet
        visible={!!networkSheetFor}
        assetIds={networkSheetFor || []}
        onClose={() => setNetworkSheetFor(null)}
        onSelect={choose}
      />
    </ScrollView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    title: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: spacing(0.5) },
    subtitle: { color: colors.subtext, fontSize: 12, marginBottom: spacing(3), lineHeight: 17 },
    row: {
      flexDirection: "row", alignItems: "center", padding: spacing(2), marginBottom: spacing(1.5),
    },
    symbol: { color: colors.text, fontSize: 16, fontWeight: "700" },
    chain: { color: colors.subtext, fontSize: 12, marginTop: 2 },
    arrow: { color: colors.subtext, fontSize: 20 },
  });
}
