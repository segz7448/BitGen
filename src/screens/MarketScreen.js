import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, useTheme } from "../theme";
import { useTicker, useConnectionStatus, startPriceStream, stopPriceStream, useEthTicker, useEthConnectionStatus, startEthPriceStream, stopEthPriceStream } from "../store/priceStore";
import { formatFiat } from "../network/priceFeed";
import { useDisplayCurrency } from "../hooks/useDisplayCurrency";
import { GlassCard, GlassIcon } from "../components/Glass";
import CurrencySelector from "../components/CurrencySelector";
import CoinSelector from "../components/CoinSelector";

export default function MarketScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const ticker = useTicker();
  const connection = useConnectionStatus();
  const { currency, setCurrency } = useDisplayCurrency();

  useEffect(() => {
    startPriceStream();
    startEthPriceStream();
    return () => {
      stopPriceStream();
      stopEthPriceStream();
    };
  }, []);

  const ethTicker = useEthTicker();
  const ethConnection = useEthConnectionStatus();
  const ethStatusLabel = { open: "Live", connecting: "Connecting…", reconnecting: "Reconnecting…", polling: "Live (backup feed)", closed: "Offline", idle: "Idle" }[ethConnection] || ethConnection;
  const ethStatusColor = ethConnection === "open" || ethConnection === "polling" ? colors.green : colors.subtext;

  const price = ticker[currency];
  const statusLabel = { open: "Live", connecting: "Connecting…", reconnecting: "Reconnecting…", polling: "Live (backup feed)", closed: "Offline", idle: "Idle" }[connection] || connection;
  const statusColor = connection === "open" || connection === "polling" ? colors.green : colors.subtext;

  // Two-way converter — crypto amount <-> fiat amount. Rate for the
  // selected coin is derived as coinUsdPrice * (ticker[currency]/ticker.usd),
  // reusing BTC's own multi-currency ticker purely as the USD->currency FX
  // cross-rate (that ratio is currency math, not a BTC-specific fact) so
  // ETH/USDT conversion doesn't need its own NGN/EUR/GBP price fetch.
  const [convCoin, setConvCoin] = useState("BTC");
  const [coinAmount, setCoinAmount] = useState("1");
  const [fiatAmount, setFiatAmount] = useState("");
  const [lastEdited, setLastEdited] = useState("coin");
  const [convCurrency, setConvCurrency] = useState("usd");

  const coinUsdPrice = { BTC: ticker.usd, ETH: ethTicker.usd, USDT: 1 }[convCoin];
  const fxMultiplier = convCurrency === "usd" ? 1 : ticker.usd ? ticker[convCurrency] / ticker.usd : null;
  const convRate = coinUsdPrice != null && fxMultiplier != null ? coinUsdPrice * fxMultiplier : null;
  const coinDecimals = convCoin === "USDT" ? 2 : convCoin === "ETH" ? 6 : 8;

  useEffect(() => {
    if (convRate == null) return;
    if (lastEdited === "coin") {
      const n = parseFloat(coinAmount);
      setFiatAmount(Number.isFinite(n) ? (n * convRate).toFixed(2) : "");
    } else {
      const n = parseFloat(fiatAmount);
      setCoinAmount(Number.isFinite(n) ? (n / convRate).toFixed(coinDecimals) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convRate, convCurrency, convCoin]);

  const onCoinChange = (v) => {
    setLastEdited("coin");
    setCoinAmount(v);
    const n = parseFloat(v);
    setFiatAmount(Number.isFinite(n) && convRate != null ? (n * convRate).toFixed(2) : "");
  };
  const onFiatChange = (v) => {
    setLastEdited("fiat");
    setFiatAmount(v);
    const n = parseFloat(v);
    setCoinAmount(Number.isFinite(n) && convRate != null ? (n / convRate).toFixed(coinDecimals) : "");
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(3) }}>
      {/* --- Coin list --- */}
      <Text style={styles.sectionTitle}>Coins</Text>

      <TouchableOpacity onPress={() => navigation.navigate("Chart")}>
        <GlassCard style={styles.coinRow}>
          <GlassIcon size={40}>
            <Ionicons name="logo-bitcoin" size={22} color={colors.orange} />
          </GlassIcon>
          <View style={{ flex: 1, marginLeft: spacing(1.5) }}>
            <Text style={styles.coinSymbol}>BTC</Text>
            <Text style={styles.coinName}>Bitcoin</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.coinPrice}>{price != null ? formatFiat(price, currency) : "—"}</Text>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.subtext} style={{ marginLeft: spacing(1) }} />
        </GlassCard>
      </TouchableOpacity>

      <GlassCard style={styles.coinRow}>
        <GlassIcon size={40}>
          <Ionicons name="diamond" size={18} color="#627EEA" />
        </GlassIcon>
        <View style={{ flex: 1, marginLeft: spacing(1.5) }}>
          <Text style={styles.coinSymbol}>ETH</Text>
          <Text style={styles.coinName}>Ethereum</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.coinPrice}>{ethTicker.usd != null ? formatFiat(ethTicker[currency], currency) : "—"}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: ethStatusColor }]} />
            <Text style={[styles.statusText, { color: ethStatusColor }]}>{ethStatusLabel}</Text>
          </View>
        </View>
      </GlassCard>
      <Text style={styles.usdtNote}>
        Available on Ethereum, Morph, and BEP20 (see Wallet → Add funds to pick a network). No
        candlestick history for ETH yet — that's coming alongside BTC's.
      </Text>

      <GlassCard style={styles.coinRow}>
        <GlassIcon size={40}>
          <Ionicons name="cash" size={20} color={colors.green} />
        </GlassIcon>
        <View style={{ flex: 1, marginLeft: spacing(1.5) }}>
          <Text style={styles.coinSymbol}>USDT</Text>
          <Text style={styles.coinName}>Tether · USD-pegged</Text>
        </View>
        <Text style={styles.coinPrice}>{formatFiat(1, "usd")}</Text>
      </GlassCard>
      <Text style={styles.usdtNote}>
        USDT tracks $1 by design — no meaningful chart to show. Available on TRC20, ERC20, and BEP20 (see
        Wallet → Add funds to pick a network).
      </Text>

      {/* --- Converter --- */}
      <Text style={styles.sectionTitle}>Convert</Text>
      <GlassCard style={styles.convCard}>
        <View style={styles.convRow}>
          <TextInput
            style={styles.convInput}
            keyboardType="decimal-pad"
            value={coinAmount}
            onChangeText={onCoinChange}
            placeholder="0"
            placeholderTextColor={colors.subtext}
          />
          <CoinSelector value={convCoin} onChange={setConvCoin} />
        </View>

        <Ionicons name="swap-vertical" size={20} color={colors.subtext} style={{ alignSelf: "center", marginVertical: spacing(1) }} />

        <View style={styles.convRow}>
          <TextInput
            style={styles.convInput}
            keyboardType="decimal-pad"
            value={fiatAmount}
            onChangeText={onFiatChange}
            placeholder="0"
            placeholderTextColor={colors.subtext}
          />
          <View style={styles.currencyPicker}>
            <CurrencySelector value={convCurrency} onChange={setConvCurrency} />
          </View>
        </View>
      </GlassCard>

      <Text style={styles.note}>
        More coins and per-coin history are coming to this tab as the wallet adds support for them.
      </Text>
    </ScrollView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    sectionTitle: { color: colors.subtext, fontSize: 12, fontWeight: "700", marginBottom: spacing(1), marginTop: spacing(2), textTransform: "uppercase" },
    coinRow: { flexDirection: "row", alignItems: "center", padding: spacing(2), marginBottom: spacing(1) },
    coinSymbol: { color: colors.text, fontSize: 15, fontWeight: "700" },
    coinName: { color: colors.subtext, fontSize: 12, marginTop: 2 },
    coinPrice: { color: colors.text, fontSize: 15, fontWeight: "700" },
    statusRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
    dot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
    statusText: { fontSize: 10, fontWeight: "600" },
    coinSubStatus: { color: colors.subtext, fontSize: 10, fontWeight: "600", marginTop: 2 },
    usdtNote: { color: colors.subtext, fontSize: 11, lineHeight: 16, marginBottom: spacing(1) },
    convCard: { padding: spacing(2.5) },
    convRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    convInput: { color: colors.text, fontSize: 22, fontWeight: "700", flex: 1 },
    convUnit: { color: colors.subtext, fontSize: 14, fontWeight: "700", marginLeft: spacing(1) },
    currencyPicker: { flexDirection: "row", gap: spacing(1.5) },
    note: { color: colors.subtext, fontSize: 12, marginTop: spacing(3), textAlign: "center" },
  });
}
