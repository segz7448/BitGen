import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, RefreshControl, ScrollView, ActivityIndicator } from "react-native";
import { useIsFocused, useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, useTheme } from "../theme";
import { getTotalBalance, getCurrentAddress, getCurrentAddress as getAssetAddress } from "../db/addressRepo";
import { syncWallet } from "../wallet/sync";
import { satsToFiat, formatFiat } from "../network/priceFeed";
import { startPriceStream, stopPriceStream, useTicker, useConnectionStatus } from "../store/priceStore";
import { isWatchOnly } from "../wallet/walletMode";
import { ASSET_IDS, getAsset } from "../wallet/assets";
import { getOrCreateAddress } from "../wallet/multiAssetAddress";
import { loadMnemonic, loadPassphrase } from "../wallet/secureSeed";
import { getAssetBalanceDisplay } from "../network/multiAssetBalance";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { useDisplayCurrency } from "../hooks/useDisplayCurrency";
import { unreadNotificationCount } from "../db/notificationRepo";
import LiveIndicator from "../components/LiveIndicator";
import CurrencySelector from "../components/CurrencySelector";
import { GlassCard, GlassIcon } from "../components/Glass";

const AUTO_REFRESH_MS = 15_000;

function formatSats(sats) {
  return (sats / 100_000_000).toFixed(8);
}

const USDT_VARIANT_IDS = [ASSET_IDS.USDT_TRC20, ASSET_IDS.USDT_ERC20, ASSET_IDS.USDT_BEP20];
const ETH_VARIANT_IDS = [ASSET_IDS.ETH_ETHEREUM, ASSET_IDS.ETH_MORPH, ASSET_IDS.ETH_BEP20];

/**
 * Live balance lookup for the account-model assets (USDT/ETH variants) —
 * unlike BTC, these aren't synced into the local DB by a background job
 * yet, so this fetches directly from each chain's RPC/API on every load.
 * Fine for a personal wallet; worth caching if this gets slow.
 *
 * For a non-watch-only wallet, this also creates the address the first
 * time it's missing (getOrCreateAddress no-ops if one already exists) so
 * a network doesn't sit at "Not set up yet" until the user happens to
 * open Deposit for that specific one — the mnemonic is only touched once
 * per call, on whichever load first finds an address actually missing.
 */
async function loadBalancesFor(assetIds, watchOnly) {
  let mnemonic, passphrase;
  const results = await Promise.all(
    assetIds.map(async (assetId) => {
      let addrRow = await getAssetAddress(assetId);
      if (!addrRow && !watchOnly) {
        try {
          if (!mnemonic) {
            mnemonic = await loadMnemonic();
            passphrase = await loadPassphrase();
          }
          const address = await getOrCreateAddress(assetId, mnemonic, passphrase);
          addrRow = { address };
        } catch {
          // Leave addrRow null — surfaces as "Setting up…" below rather
          // than crashing the whole balance row for one bad derivation.
        }
      }
      if (!addrRow) return { assetId, display: null, address: null };
      const display = await getAssetBalanceDisplay(assetId, addrRow.address);
      return { assetId, address: addrRow.address, display };
    })
  );
  return results;
}

export default function HomeScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [balance, setBalance] = useState(0);
  const [currentAddress, setCurrentAddress] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const [error, setError] = useState(null);
  const [watchOnly, setWatchOnly] = useState(false);
  const [usdtBalances, setUsdtBalances] = useState([]);
  const [ethBalances, setEthBalances] = useState([]);
  const [unread, setUnread] = useState(0);
  const isFocused = useIsFocused();

  const ticker = useTicker();
  const connectionStatus = useConnectionStatus();
  const { currency, setCurrency } = useDisplayCurrency();
  const fiat = useMemo(() => satsToFiat(balance, ticker[currency]), [balance, ticker, currency]);

  useEffect(() => {
    if (!isFocused) return;
    startPriceStream();
    return () => stopPriceStream();
  }, [isFocused]);

  useFocusEffect(useCallback(() => {
    unreadNotificationCount().then(setUnread).catch(() => {});
  }, []));

  const load = useCallback(async (withNetwork = true) => {
    try {
      if (withNetwork) await syncWallet();
      const sats = await getTotalBalance();
      setBalance(sats);
      setCurrentAddress(await getCurrentAddress());
      const wo = await isWatchOnly();
      setWatchOnly(wo);
      loadBalancesFor(USDT_VARIANT_IDS, wo).then(setUsdtBalances).catch(() => {});
      loadBalancesFor(ETH_VARIANT_IDS, wo).then(setEthBalances).catch(() => {});
      setError(null);
    } catch (e) {
      setError("Couldn't reach the network. Showing last known balance.");
    }
  }, []);

  useAutoRefresh(
    useCallback(async () => { await load(true); setSyncing(false); }, [load]),
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
      <View style={styles.topBar}>
        <Text style={styles.appName}>BITGEN</Text>
        <TouchableOpacity onPress={() => navigation.navigate("Notifications")}>
          <GlassIcon size={38}>
            <Ionicons name="notifications-outline" size={19} color={colors.text} />
            {unread > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
              </View>
            )}
          </GlassIcon>
        </TouchableOpacity>
      </View>

      {watchOnly && (
        <View style={styles.watchOnlyBanner}>
          <Text style={styles.watchOnlyBannerText}>Watch-only wallet — sending is disabled</Text>
        </View>
      )}

      <GlassCard style={styles.balanceCard}>
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
            {fiat != null && <Text style={styles.fiatValue}>{formatFiat(fiat, currency)}</Text>}
          </>
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
        {currentAddress && (
          <Text style={styles.addressPreview} numberOfLines={1}>{currentAddress.address}</Text>
        )}
      </GlassCard>

      <TouchableOpacity onPress={() => navigation.navigate("Chart")}>
        <GlassCard style={styles.priceTile}>
          <View>
            <Text style={styles.priceTileLabel}>BTC / {currency.toUpperCase()}</Text>
            <Text style={styles.priceTileValue}>
              {ticker[currency] != null ? formatFiat(ticker[currency], currency) : "—"}
            </Text>
          </View>
          <View style={styles.priceTileChartHint}>
            <Ionicons name="stats-chart" size={16} color={colors.orange} />
            <Text style={styles.priceTileChartText}>View chart</Text>
          </View>
        </GlassCard>
      </TouchableOpacity>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate("AssetPicker", { mode: "deposit" })}>
          <GlassIcon><Ionicons name="add" size={22} color={colors.orange} /></GlassIcon>
          <Text style={styles.actionLabel}>Add funds</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, watchOnly && styles.actionButtonDisabled]}
          onPress={() => !watchOnly && navigation.navigate("AssetPicker", { mode: "withdraw" })}
        >
          <GlassIcon><Ionicons name="arrow-up" size={20} color={colors.text} /></GlassIcon>
          <Text style={styles.actionLabel}>Withdraw</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate("TransferAccounts")}>
          <GlassIcon><Ionicons name="swap-horizontal" size={20} color={colors.text} /></GlassIcon>
          <Text style={styles.actionLabel}>Transfer</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate("Scan")}>
          <GlassIcon><Ionicons name="qr-code-outline" size={19} color={colors.text} /></GlassIcon>
          <Text style={styles.actionLabel}>Scan</Text>
        </TouchableOpacity>
      </View>

      <GlassCard style={styles.otherAssetsCard}>
        <Text style={styles.otherAssetsTitle}>USDT</Text>
        {usdtBalances.map((b) => {
          const asset = getAsset(b.assetId);
          return (
            <View key={b.assetId} style={styles.otherAssetRow}>
              <Text style={styles.otherAssetChain}>{asset.displayName}</Text>
              <Text style={styles.otherAssetValue}>
                {b.display == null
                  ? b.address
                    ? "—"
                    : watchOnly
                      ? "Not available (watch-only)"
                      : "Setting up…"
                  : `${b.display} USDT`}
              </Text>
            </View>
          );
        })}
      </GlassCard>

      <GlassCard style={styles.otherAssetsCard}>
        <Text style={styles.otherAssetsTitle}>ETH</Text>
        {ethBalances.map((b) => {
          const asset = getAsset(b.assetId);
          return (
            <View key={b.assetId} style={styles.otherAssetRow}>
              <Text style={styles.otherAssetChain}>{asset.displayName}</Text>
              <Text style={styles.otherAssetValue}>
                {b.display == null
                  ? b.address
                    ? "—"
                    : watchOnly
                      ? "Not available (watch-only)"
                      : "Setting up…"
                  : `${b.display} ETH`}
              </Text>
            </View>
          );
        })}
      </GlassCard>

      <TouchableOpacity onPress={() => navigation.navigate("Wallet")}>
        <GlassCard style={styles.historyRow}>
          <Text style={styles.historyRowText}>Funding & Trading Accounts</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
        </GlassCard>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate("Addresses")}>
        <GlassCard style={styles.historyRow}>
          <Text style={styles.historyRowText}>Your Addresses</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
        </GlassCard>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate("History")}>
        <GlassCard style={styles.historyRow}>
          <Text style={styles.historyRowText}>Transaction History</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
        </GlassCard>
      </TouchableOpacity>
    </ScrollView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing(2) },
    appName: { color: colors.text, fontSize: 20, fontWeight: "800", letterSpacing: 0.5 },
    badge: {
      position: "absolute", top: -3, right: -3, backgroundColor: colors.red, borderRadius: 8,
      minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
    },
    badgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "700" },
    watchOnlyBanner: { backgroundColor: "#1F1F2A", borderRadius: 10, padding: spacing(1.2), marginBottom: spacing(2) },
    watchOnlyBannerText: { color: colors.subtext, fontSize: 12, textAlign: "center" },
    balanceCard: { padding: spacing(3), alignItems: "center", marginBottom: spacing(2) },
    balanceLabel: { color: colors.subtext, fontSize: 13 },
    balanceLabelRow: { flexDirection: "row", alignItems: "center", gap: 8, width: "100%" },
    balanceValue: { color: colors.text, fontSize: 30, fontWeight: "700", marginVertical: spacing(1) },
    fiatValue: { color: colors.subtext, fontSize: 14, marginBottom: spacing(1) },
    errorText: { color: colors.red, fontSize: 12, marginBottom: spacing(1), textAlign: "center" },
    addressPreview: { color: colors.subtext, fontSize: 11, marginTop: spacing(1) },
    priceTile: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing(2), marginBottom: spacing(2) },
    priceTileLabel: { color: colors.subtext, fontSize: 11, fontWeight: "600" },
    priceTileValue: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: 2 },
    priceTileChartHint: { flexDirection: "row", alignItems: "center", gap: 4 },
    priceTileChartText: { color: colors.orange, fontSize: 12, fontWeight: "600" },
    actionsRow: { flexDirection: "row", justifyContent: "space-around", marginBottom: spacing(2) },
    actionButton: { alignItems: "center" },
    actionButtonDisabled: { opacity: 0.4 },
    actionLabel: { color: colors.text, marginTop: spacing(0.75), fontSize: 12, fontWeight: "600" },
    otherAssetsCard: { padding: spacing(2), marginBottom: spacing(1.5) },
    otherAssetsTitle: { color: colors.subtext, fontSize: 12, fontWeight: "700", marginBottom: spacing(1) },
    otherAssetRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing(0.75) },
    otherAssetChain: { color: colors.text, fontSize: 13 },
    otherAssetValue: { color: colors.subtext, fontSize: 13 },
    historyRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing(2), marginBottom: spacing(1.25) },
    historyRowText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  });
}
