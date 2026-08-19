import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, useTheme } from "../theme";
import { getBtcAccountBalances, getPooledUsdtAccountBalances, getPooledEthAccountBalances, POOLED_USDT_ASSET_ID, POOLED_ETH_ASSET_ID } from "../db/accountLedgerRepo";
import { satsToFiat, formatFiat } from "../network/priceFeed";
import { useTicker, useEthTicker, startPriceStream, stopPriceStream, startEthPriceStream, stopEthPriceStream } from "../store/priceStore";
import { useDisplayCurrency } from "../hooks/useDisplayCurrency";
import { GlassCard, GlassIcon } from "../components/Glass";

const ASSET_PANELS = [
  {
    assetId: "BTC", label: "BTC", unitsPerWhole: 100_000_000, decimals: 8,
    fetchBalances: getBtcAccountBalances, toFiat: (ticker) => ticker.usd, icon: "logo-bitcoin", iconColor: (c) => c.orange,
  },
  {
    assetId: POOLED_USDT_ASSET_ID, label: "USDT", unitsPerWhole: 1_000_000, decimals: 2,
    fetchBalances: getPooledUsdtAccountBalances, toFiat: () => 1, icon: "cash", iconColor: (c) => c.green,
  },
  {
    assetId: POOLED_ETH_ASSET_ID, label: "ETH", unitsPerWhole: 100_000_000, decimals: 6,
    // ETH_POOL_DECIMALS is 8 (see ethPool.js) — same scale as BTC's sats,
    // coincidentally, so unitsPerWhole matches BTC's here too.
    fetchBalances: getPooledEthAccountBalances, toFiat: (ticker, ethTicker) => ethTicker?.usd, icon: "diamond", iconColor: () => "#627EEA",
  },
];

const ACCOUNT_TABS = [
  { key: "funding", label: "Funding" },
  { key: "unified", label: "Unified" },
];

export default function AccountsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [balancesByAsset, setBalancesByAsset] = useState({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("funding");
  const [hidden, setHidden] = useState(false);

  const isFocused = useIsFocused();
  const ticker = useTicker();
  const ethTicker = useEthTicker();
  const { currency } = useDisplayCurrency();

  React.useEffect(() => {
    if (!isFocused) return;
    startPriceStream();
    startEthPriceStream();
    return () => {
      stopPriceStream();
      stopEthPriceStream();
    };
  }, [isFocused]);

  const load = useCallback(async () => {
    try {
      const entries = await Promise.all(
        ASSET_PANELS.map(async (panel) => [panel.assetId, await panel.fetchBalances()])
      );
      setBalancesByAsset(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Total est. value across all assets, for whichever tab (account) is active.
  const totalFiat = ASSET_PANELS.reduce((sum, panel) => {
    const b = balancesByAsset[panel.assetId] || { funding: 0, unified: 0 };
    const fiatPrice = panel.toFiat(ticker, ethTicker);
    const units = tab === "funding" ? b.funding : b.unified;
    const val = satsToFiat(units, fiatPrice);
    return sum + (val || 0);
  }, 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(3) }}>
      <GlassCard style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <Text style={styles.heroLabel}>Est. value</Text>
          <TouchableOpacity onPress={() => setHidden((h) => !h)}>
            <Ionicons name={hidden ? "eye-off" : "eye"} size={18} color={colors.subtext} />
          </TouchableOpacity>
        </View>
        <Text style={styles.heroValue}>{hidden ? "••••••" : formatFiat(totalFiat, currency)}</Text>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate("AssetPicker", { mode: "deposit" })}>
            <GlassIcon size={44}><Ionicons name="add" size={22} color={colors.orange} /></GlassIcon>
            <Text style={styles.actionLabel}>Add funds</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate("AssetPicker", { mode: "withdraw" })}>
            <GlassIcon size={44}><Ionicons name="arrow-up" size={20} color={colors.text} /></GlassIcon>
            <Text style={styles.actionLabel}>Withdraw</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate("TransferAccounts")}>
            <GlassIcon size={44}><Ionicons name="swap-horizontal" size={20} color={colors.text} /></GlassIcon>
            <Text style={styles.actionLabel}>Transfer</Text>
          </TouchableOpacity>
        </View>
      </GlassCard>

      <View style={styles.tabRow}>
        {ACCOUNT_TABS.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.orange} style={{ marginTop: spacing(4) }} />
      ) : (
        ASSET_PANELS.map((panel) => {
          const b = balancesByAsset[panel.assetId] || { funding: 0, unified: 0 };
          const units = tab === "funding" ? b.funding : b.unified;
          const fiatPrice = panel.toFiat(ticker, ethTicker);
          const fiatVal = satsToFiat(units, fiatPrice);
          const amountDisplay = (units / panel.unitsPerWhole).toFixed(panel.decimals);

          return (
            <GlassCard key={panel.assetId} style={styles.assetRow}>
              <GlassIcon size={40}>
                <Ionicons name={panel.icon} size={panel.icon === "cash" ? 20 : 22} color={panel.iconColor(colors)} />
              </GlassIcon>
              <View style={{ flex: 1, marginLeft: spacing(1.5) }}>
                <Text style={styles.assetLabel}>{panel.label}</Text>
                <Text style={styles.assetSub}>{tab === "funding" ? "Plain custody" : "Backs open trades"}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.assetAmount}>{hidden ? "••••" : `${amountDisplay} ${panel.label}`}</Text>
                {fiatVal != null && <Text style={styles.assetFiat}>{hidden ? "••••" : formatFiat(fiatVal, currency)}</Text>}
              </View>
            </GlassCard>
          );
        })
      )}

      <Text style={styles.note}>
        Funding is plain custody — the coin quantity there never changes on its own. Unified backs
        open spot trades; buying/selling moves this balance directly. Use Transfer to move funds
        between them.
      </Text>
    </ScrollView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    heroCard: { padding: spacing(2.5), marginBottom: spacing(2) },
    heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    heroLabel: { color: colors.subtext, fontSize: 12, fontWeight: "600" },
    heroValue: { color: colors.text, fontSize: 32, fontWeight: "800", marginTop: 4, marginBottom: spacing(2) },
    actionRow: { flexDirection: "row", justifyContent: "space-around" },
    actionBtn: { alignItems: "center" },
    actionLabel: { color: colors.text, fontSize: 11, fontWeight: "600", marginTop: 6 },
    tabRow: { flexDirection: "row", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 4, marginBottom: spacing(2) },
    tab: { flex: 1, paddingVertical: spacing(1.2), borderRadius: 9, alignItems: "center" },
    tabActive: { backgroundColor: colors.orange },
    tabText: { color: colors.subtext, fontSize: 13, fontWeight: "600" },
    tabTextActive: { color: "#0B0B0F" },
    assetRow: { flexDirection: "row", alignItems: "center", padding: spacing(2), marginBottom: spacing(1.25) },
    assetLabel: { color: colors.text, fontSize: 15, fontWeight: "700" },
    assetSub: { color: colors.subtext, fontSize: 11, marginTop: 2 },
    assetAmount: { color: colors.text, fontSize: 14, fontWeight: "700" },
    assetFiat: { color: colors.subtext, fontSize: 12, marginTop: 2 },
    note: { color: colors.subtext, fontSize: 11, lineHeight: 16, marginTop: spacing(2), textAlign: "center" },
  });
}
