import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, useWindowDimensions } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { colors, spacing } from "../theme";
import PriceChart from "../components/PriceChart";
import LiveIndicator from "../components/LiveIndicator";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { useDisplayCurrency } from "../hooks/useDisplayCurrency";
import CurrencySelector from "../components/CurrencySelector";
import { formatFiat, sma, ema } from "../network/priceFeed";
import {
  startPriceStream,
  stopPriceStream,
  loadCandles,
  useTicker,
  useConnectionStatus,
  useCandles,
  useVolumes,
  CHART_RANGES,
} from "../store/priceStore";

// Historical bars are no longer polled to stay "live" — the WebSocket
// feed patches the current candle in real time. This interval just
// re-syncs bar boundaries/volume from the REST source periodically as a
// background catch-up, far less aggressive than the old 15s poll.
const HISTORY_RESYNC_MS = 60_000;

const MA_DEFS = [
  { id: "sma7", label: "MA 7", color: "#F7931A", fn: (c) => sma(c, 7) },
  { id: "sma25", label: "MA 25", color: "#5AC8FA", fn: (c) => sma(c, 25) },
  { id: "ema12", label: "EMA 12", color: "#B57BFF", fn: (c) => ema(c, 12) },
];

export default function ChartScreen() {
  const { width } = useWindowDimensions();
  const isFocused = useIsFocused();
  const [range, setRange] = useState(CHART_RANGES[1]); // default 7D
  const [chartMode, setChartMode] = useState("candles");
  const [activeMAs, setActiveMAs] = useState(["sma7"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Each of these subscribes to exactly one store slice: the live ticker,
  // the socket's connection state, and this range's candle/volume series.
  // A trade tick that patches the current candle re-renders the chart via
  // `candles` without touching `connectionStatus`, and vice versa.
  const ticker = useTicker();
  const connectionStatus = useConnectionStatus();
  const { currency, setCurrency } = useDisplayCurrency();
  const candles = useCandles(range.days, currency);
  const volumes = useVolumes(range.days, currency);
  const livePrice = ticker[currency];

  // Keep the WebSocket feed alive while this screen is focused. Reference
  // -counted against HomeScreen, so navigating Home -> Chart doesn't drop
  // and reopen the connection.
  useEffect(() => {
    if (!isFocused) return;
    startPriceStream();
    return () => stopPriceStream();
  }, [isFocused]);

  // Full (spinner) reload of *history* whenever the user picks a
  // different timeframe — this is a REST call for bars, independent of
  // the live socket which keeps ticking regardless of range.
  const load = useCallback(async (r, { silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const ohlc = await loadCandles(r.days, currency);
      if (!ohlc.length && !silent) setError("No data returned — pull to retry.");
    } catch (e) {
      if (!silent) setError("Couldn't load chart data.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [currency]);

  useEffect(() => {
    load(range);
  }, [range, currency, load]);

  // Light background re-sync of bar boundaries/volume only — the live
  // price itself never depends on this, it's already pushed via socket.
  useAutoRefresh(
    useCallback(() => load(range, { silent: true }), [load, range]),
    HISTORY_RESYNC_MS,
    isFocused
  );

  const overlays = useMemo(() => {
    if (chartMode !== "candles" || !candles.length) return [];
    return MA_DEFS.filter((d) => activeMAs.includes(d.id)).map((d) => ({
      id: d.id,
      color: d.color,
      label: d.label,
      values: d.fn(candles),
    }));
  }, [candles, activeMAs, chartMode]);

  const stats = useMemo(() => {
    if (!candles.length) return null;
    let high = -Infinity;
    let low = Infinity;
    for (const c of candles) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
    }
    const openRef = candles[0].open;
    const lastClose = candles[candles.length - 1].close;
    const change = lastClose - openRef;
    const changePct = openRef ? (change / openRef) * 100 : 0;
    const lastVolume = volumes.length ? volumes[volumes.length - 1].volume : null;
    return { high, low, change, changePct, lastVolume };
  }, [candles, volumes]);

  const toggleMA = (id) => {
    setActiveMAs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const chartWidth = width - spacing(3) * 2;
  const up = (stats?.change ?? 0) >= 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(3), paddingBottom: spacing(6) }}>
      <View style={styles.priceHeader}>
        <View style={styles.pairRow}>
          <Text style={styles.pair}>BTC / {currency.toUpperCase()}</Text>
          <LiveIndicator status={connectionStatus} />
          <View style={{ flex: 1 }} />
          <CurrencySelector value={currency} onChange={setCurrency} />
        </View>
        <Text style={styles.price}>{livePrice != null ? formatFiat(livePrice, currency) : "—"}</Text>
        {stats && (
          <Text style={[styles.change, { color: up ? colors.green : colors.red }]}>
            {up ? "▲" : "▼"} {formatFiat(Math.abs(stats.change), currency)} ({Math.abs(stats.changePct).toFixed(2)}%)
            <Text style={styles.changeRangeLabel}> {range.label}</Text>
          </Text>
        )}
      </View>

      <View style={styles.tabsRow}>
        {CHART_RANGES.map((r) => (
          <TouchableOpacity
            key={r.label}
            style={[styles.tab, range.label === r.label && styles.tabActive]}
            onPress={() => setRange(r)}
          >
            <Text style={[styles.tabText, range.label === r.label && styles.tabTextActive]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.chartCard}>
        {loading ? (
          <View style={{ height: 320, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={colors.orange} />
          </View>
        ) : error ? (
          <View style={{ height: 320, alignItems: "center", justifyContent: "center" }}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => load(range)} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <PriceChart
            key={range.label}
            candles={candles}
            volumes={volumes}
            overlays={overlays}
            mode={chartMode}
            currency={currency}
            width={chartWidth}
            height={320}
          />
        )}
      </View>

      <View style={styles.controlsRow}>
        <View style={styles.segmented}>
          {["candles", "line"].map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.segment, chartMode === m && styles.segmentActive]}
              onPress={() => setChartMode(m)}
            >
              <Text style={[styles.segmentText, chartMode === m && styles.segmentTextActive]}>
                {m === "candles" ? "Candles" : "Line"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {chartMode === "candles" && (
          <View style={styles.maRow}>
            {MA_DEFS.map((d) => {
              const active = activeMAs.includes(d.id);
              return (
                <TouchableOpacity
                  key={d.id}
                  style={[styles.maChip, active && { borderColor: d.color, backgroundColor: d.color + "22" }]}
                  onPress={() => toggleMA(d.id)}
                >
                  <View style={[styles.maDot, { backgroundColor: d.color }]} />
                  <Text style={[styles.maChipText, active && { color: d.color }]}>{d.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {stats && (
        <View style={styles.statsCard}>
          <StatCell label={`${range.label} High`} value={formatFiat(stats.high, currency)} />
          <StatCell label={`${range.label} Low`} value={formatFiat(stats.low, currency)} />
          <StatCell
            label="24h Volume"
            value={stats.lastVolume ? formatFiat(stats.lastVolume, currency) : "—"}
          />
        </View>
      )}

      <Text style={styles.hint}>Drag to scrub the crosshair · pinch with two fingers to zoom &amp; pan</Text>
      <Text style={styles.source}>Live price via Binance · history via CoinGecko</Text>
    </ScrollView>
  );
}

function StatCell({ label, value }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statCellLabel}>{label}</Text>
      <Text style={styles.statCellValue}>{value}</Text>
    </View>
  );
}

function compact(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  priceHeader: { marginBottom: spacing(2) },
  pairRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pair: { color: colors.subtext, fontSize: 13, fontWeight: "600" },
  price: { color: colors.text, fontSize: 32, fontWeight: "700", marginTop: 2 },
  change: { fontSize: 14, fontWeight: "600", marginTop: 2 },
  changeRangeLabel: { color: colors.subtext, fontWeight: "400" },
  tabsRow: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    marginBottom: spacing(2),
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  tabActive: { backgroundColor: colors.orange },
  tabText: { color: colors.subtext, fontSize: 12, fontWeight: "600" },
  tabTextActive: { color: "#1A1300" },
  chartCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(1.5),
  },
  errorText: { color: colors.subtext, fontSize: 13, marginBottom: spacing(1.5) },
  retryBtn: { backgroundColor: colors.orange, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 18 },
  retryText: { color: "#1A1300", fontWeight: "700", fontSize: 13 },
  controlsRow: { marginTop: spacing(2), gap: spacing(1.5) },
  segmented: {
    flexDirection: "row",
    alignSelf: "flex-start",
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  segment: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8 },
  segmentActive: { backgroundColor: colors.border },
  segmentText: { color: colors.subtext, fontSize: 12, fontWeight: "600" },
  segmentTextActive: { color: colors.text },
  maRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  maChip: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 10,
    gap: 5,
  },
  maDot: { width: 7, height: 7, borderRadius: 4 },
  maChipText: { color: colors.subtext, fontSize: 11, fontWeight: "600" },
  statsCard: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(2),
    marginTop: spacing(2),
  },
  statCell: { flex: 1, alignItems: "center" },
  statCellLabel: { color: colors.subtext, fontSize: 11, marginBottom: 3 },
  statCellValue: { color: colors.text, fontSize: 13, fontWeight: "700" },
  hint: { color: colors.subtext, fontSize: 11, textAlign: "center", marginTop: spacing(2) },
  source: { color: colors.subtext, fontSize: 10, textAlign: "center", marginTop: spacing(0.5), opacity: 0.7 },
});
