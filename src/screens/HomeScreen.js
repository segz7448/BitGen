import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, RefreshControl, ScrollView, ActivityIndicator } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { colors, spacing } from "../theme";
import { getTotalBalance, getCurrentAddress, getCurrentAddress as getAssetAddress } from "../db/addressRepo";
import { syncWallet } from "../wallet/sync";
import { satsToFiat, formatFiat } from "../network/priceFeed";
import { startPriceStream, stopPriceStream, useTicker, useConnectionStatus } from "../store/priceStore";
import { isWatchOnly } from "../wallet/walletMode";
import { ASSET_IDS, listAssets, getAsset } from "../wallet/assets";
import { fromBaseUnits } from "../wallet/units";
import { getErc20Balance } from "../network/evmClient";
import { getTrc20Balance } from "../network/tronClient";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { useDisplayCurrency } from "../hooks/useDisplayCurrency";
import LiveIndicator from "../components/LiveIndicator";
import CurrencySelector from "../components/CurrencySelector";

const AUTO_REFRESH_MS = 15_000;

function formatSats(sats) {
  return (sats / 100_000_000).toFixed(8);
}

const OTHER_ASSET_IDS = [ASSET_IDS.USDT_TRC20, ASSET_IDS.USDT_ERC20, ASSET_IDS.USDT_BEP20];

/**
 * Live balance lookup for the USDT variants — unlike BTC, these aren't
 * synced into the local DB by a background job yet, so this fetches
 * directly from each chain's RPC/API on every load. Fine for a personal
 * wallet; worth caching if this gets slow.
 */
async function loadOtherBalances() {
  const results = await Promise.all(
    OTHER_ASSET_IDS.map(async (assetId) => {
      const asset = getAsset(assetId);
      const addrRow = await getAssetAddress(assetId);
      if (!addrRow) return { assetId, display: null };
      try {
        const raw =
          asset.chain === "tron"
            ? await getTrc20Balance(addrRow.address, asset.contractAddress)
            : await getErc20Balance(asset.chain, addrRow.address, asset.contractAddress);
        return { assetId, address: addrRow.address, display: fromBaseUnits(raw, asset.decimals) };
      } catch {
        return { assetId, address: addrRow.address, display: null };
      }
    })
  );
  return results;
}

export default function HomeScreen({ navigation }) {
  const [balance, setBalance] = useState(0);
  const [currentAddress, setCurrentAddress] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(true); // only true until the first load completes
  const [error, setError] = useState(null);
  const [watchOnly, setWatchOnly] = useState(false);
  const [otherBalances, setOtherBalances] = useState([]);
  const isFocused = useIsFocused();

  // Live BTC/USD ticker and socket status — each is its own store slice,
  // so a price tick re-renders only the balance card's fiat line below,
  // not this whole screen (balance, addresses, other-asset rows, etc.
  // are untouched by a price update).
  const ticker = useTicker();
  const connectionStatus = useConnectionStatus();
  const { currency, setCurrency } = useDisplayCurrency();
  const fiat = useMemo(
    () => satsToFiat(balance, ticker[currency]),
    [balance, ticker, currency]
  );

  // Wallet sync (on-chain balance) and the live price feed are independent
  // real-time concerns updating on their own schedules — the socket
  // pushes price ticks continuously, wallet sync still runs on its own
  // timer since it requires a chain-indexer round trip, not a stream.
  useEffect(() => {
    if (!isFocused) return;
    startPriceStream();
    return () => stopPriceStream();
  }, [isFocused]);

  const load = useCallback(async (withNetwork = true) => {
    try {
      if (withNetwork) await syncWallet();
      const sats = await getTotalBalance();
      setBalance(sats);
      setCurrentAddress(await getCurrentAddress());
      setWatchOnly(await isWatchOnly());
      loadOtherBalances().then(setOtherBalances).catch(() => {});
      setError(null);
    } catch (e) {
      setError("Couldn't reach the network. Showing last known balance.");
    }
  }, []);

  // Auto-syncs the on-chain wallet balance on a timer — no manual pull
  // needed. The spinner only shows for the very first load; every tick
  // after that (and every return from background) updates quietly. The
  // BTC price itself is not part of this cycle — it streams in live via
  // the WebSocket feed above, independent of this interval.
  useAutoRefresh(
    useCallback(
      async () => {
        await load(true);
        setSyncing(false);
      },
      [load]
    ),
    AUTO_REFRESH_MS,
    isFocused
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: spacing(3) }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.orange} />}
    >
      {watchOnly && (
        <View style={styles.watchOnlyBanner}>
          <Text style={styles.watchOnlyBannerText}>Watch-only wallet — sending is disabled</Text>
        </View>
      )}

      <View style={styles.balanceCard}>
        <View style={styles.balanceLabelRow}>
          <Text style={styles.balanceLabel}>Total Balance</Text>
          <LiveIndicator status={connectionStatus} />
          <View style={{ flex: 1 }} />
          <CurrencySelector value={currency} onChange={setCurrency} />
        </View>
        {syncing ? (
          <ActivityIndicator color={colors.orange} style={{ marginVertical: spacing(2) }} />
        ) : (
          <>
            <Text style={styles.balanceValue}>{formatSats(balance)} BTC</Text>
            {fiat != null && (
              <TouchableOpacity onPress={() => navigation.navigate("Chart")}>
                <Text style={styles.fiatValue}>{formatFiat(fiat, currency)} · Chart →</Text>
              </TouchableOpacity>
            )}
          </>
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
        {currentAddress && (
          <Text style={styles.addressPreview} numberOfLines={1}>
            {currentAddress.address}
          </Text>
        )}
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate("AssetPicker", { mode: "deposit" })}
        >
          <Text style={styles.actionIcon}>↓</Text>
          <Text style={styles.actionLabel}>Add funds</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, watchOnly && styles.actionButtonDisabled]}
          onPress={() => !watchOnly && navigation.navigate("AssetPicker", { mode: "withdraw" })}
        >
          <Text style={styles.actionIcon}>↑</Text>
          <Text style={styles.actionLabel}>Withdraw</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate("TransferAccounts")}>
          <Text style={styles.actionIcon}>⇄</Text>
          <Text style={styles.actionLabel}>Transfer</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate("Addresses")}>
          <Text style={styles.actionIcon}>⋯</Text>
          <Text style={styles.actionLabel}>Addresses</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate("Scan")}>
          <Text style={styles.actionIcon}>▦</Text>
          <Text style={styles.actionLabel}>Scan QR</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.otherAssetsCard}>
        <Text style={styles.otherAssetsTitle}>USDT</Text>
        {otherBalances.map((b) => {
          const asset = getAsset(b.assetId);
          return (
            <View key={b.assetId} style={styles.otherAssetRow}>
              <Text style={styles.otherAssetChain}>{asset.displayName}</Text>
              <Text style={styles.otherAssetValue}>
                {b.display == null ? (b.address ? "—" : "Not set up yet") : `${b.display} USDT`}
              </Text>
            </View>
          );
        })}
      </View>

      <TouchableOpacity style={styles.historyRow} onPress={() => navigation.navigate("Accounts")}>
        <Text style={styles.historyRowText}>Funding & Trading Accounts</Text>
        <Text style={styles.historyRowArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.historyRow} onPress={() => navigation.navigate("Chart")}>
        <Text style={styles.historyRowText}>BTC Price Chart</Text>
        <Text style={styles.historyRowArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.historyRow} onPress={() => navigation.navigate("History")}>
        <Text style={styles.historyRowText}>Transaction History</Text>
        <Text style={styles.historyRowArrow}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.settingsLink} onPress={() => navigation.navigate("Settings")}>
        <Text style={styles.settingsLinkText}>Settings</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  watchOnlyBanner: { backgroundColor: "#1F1F2A", borderRadius: 10, padding: spacing(1.2), marginBottom: spacing(2) },
  watchOnlyBannerText: { color: colors.subtext, fontSize: 12, textAlign: "center" },
  balanceCard: {
    backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border,
    padding: spacing(3), alignItems: "center", marginBottom: spacing(3),
  },
  balanceLabel: { color: colors.subtext, fontSize: 13 },
  balanceLabelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  balanceValue: { color: colors.text, fontSize: 30, fontWeight: "700", marginVertical: spacing(1) },
  fiatValue: { color: colors.subtext, fontSize: 14, marginBottom: spacing(1) },
  errorText: { color: colors.red, fontSize: 12, marginBottom: spacing(1), textAlign: "center" },
  addressPreview: { color: colors.subtext, fontSize: 11, marginTop: spacing(1) },
  actionsRow: { flexDirection: "row", gap: spacing(1.5) },
  actionButton: {
    flex: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing(2.5), alignItems: "center",
  },
  actionButtonDisabled: { opacity: 0.4 },
  actionIcon: { color: colors.orange, fontSize: 22, fontWeight: "700" },
  actionLabel: { color: colors.text, marginTop: spacing(0.5), fontSize: 13, fontWeight: "600" },
  otherAssetsCard: {
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    padding: spacing(2), marginTop: spacing(1.5),
  },
  otherAssetsTitle: { color: colors.subtext, fontSize: 12, fontWeight: "700", marginBottom: spacing(1) },
  otherAssetRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing(0.75) },
  otherAssetChain: { color: colors.text, fontSize: 13 },
  otherAssetValue: { color: colors.subtext, fontSize: 13 },
  historyRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    padding: spacing(2), marginTop: spacing(1.5),
  },
  historyRowText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  historyRowArrow: { color: colors.subtext, fontSize: 14 },
  settingsLink: { alignItems: "center", marginTop: spacing(4) },
  settingsLinkText: { color: colors.subtext, fontSize: 13 },
});
