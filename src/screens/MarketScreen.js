import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, useTheme } from "../theme";
import { useTicker, useConnectionStatus, startPriceStream, stopPriceStream } from "../store/priceStore";
import { formatFiat } from "../network/priceFeed";
import { useDisplayCurrency } from "../hooks/useDisplayCurrency";
import { GlassCard, GlassIcon } from "../components/Glass";

const CURRENCIES = ["usd", "ngn", "eur", "gbp"];

export default function MarketScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const ticker = useTicker();
  const connection = useConnectionStatus();
  const { currency, setCurrency } = useDisplayCurrency();

  useEffect(() => {
    startPriceStream();
    return () => stopPriceStream();
  }, []);

  const price = ticker[currency];
  const statusLabel = { open: "Live", connecting: "Connecting…", reconnecting: "Reconnecting…", closed: "Offline", idle: "Idle" }[connection] || connection;
  const statusColor = connection === "open" ? colors.green : colors.subtext;

  // Two-way converter — BTC amount <-> fiat amount, using ticker[currency]
  // (already "price of 1 BTC in that currency", so no extra rate lookup).
  const [btcAmount, setBtcAmount] = useState("1");
  const [fiatAmount, setFiatAmount] = useState("");
  const [lastEdited, setLastEdited] = useState("btc");
  const [convCurrency, setConvCurrency] = useState("usd");

  const convRate = ticker[convCurrency];

  useEffect(() => {
    if (convRate == null) return;
    if (lastEdited === "btc") {
      const n = parseFloat(btcAmount);
      setFiatAmount(Number.isFinite(n) ? (n * convRate).toFixed(2) : "");
    } else {
      const n = parseFloat(fiatAmount);
      setBtcAmount(Number.isFinite(n) ? (n / convRate).toFixed(8) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convRate, convCurrency]);

  const onBtcChange = (v) => {
    setLastEdited("btc");
    setBtcAmount(v);
    const n = parseFloat(v);
    setFiatAmount(Number.isFinite(n) && convRate != null ? (n * convRate).toFixed(2) : "");
  };
  const onFiatChange = (v) => {
    setLastEdited("fiat");
    setFiatAmount(v);
    const n = parseFloat(v);
    setBtcAmount(Number.isFinite(n) && convRate != null ? (n / convRate).toFixed(8) : "");
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
            value={btcAmount}
            onChangeText={onBtcChange}
            placeholder="0"
            placeholderTextColor={colors.subtext}
          />
          <Text style={styles.convUnit}>BTC</Text>
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
            {CURRENCIES.map((c) => (
              <TouchableOpacity key={c} onPress={() => setConvCurrency(c)}>
                <Text style={[styles.convUnit, convCurrency === c && { color: colors.orange }]}>{c.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
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
    usdtNote: { color: colors.subtext, fontSize: 11, lineHeight: 16, marginBottom: spacing(1) },
    convCard: { padding: spacing(2.5) },
    convRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    convInput: { color: colors.text, fontSize: 22, fontWeight: "700", flex: 1 },
    convUnit: { color: colors.subtext, fontSize: 14, fontWeight: "700", marginLeft: spacing(1) },
    currencyPicker: { flexDirection: "row", gap: spacing(1.5) },
    note: { color: colors.subtext, fontSize: 12, marginTop: spacing(3), textAlign: "center" },
  });
}
