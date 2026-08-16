import React, { useMemo, useRef, useState } from "react";
import { View, StyleSheet, PanResponder, Text } from "react-native";
import Svg, { Line, Rect, Polyline, Circle, Text as SvgText, G } from "react-native-svg";
import { colors } from "../theme";

const MIN_VISIBLE_CANDLES = 12;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Picks a "nice" step size (1/2/5 * 10^n) for grid lines. */
function niceStep(rawStep) {
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const n = rawStep / pow;
  let nice;
  if (n <= 1) nice = 1;
  else if (n <= 2) nice = 2;
  else if (n <= 5) nice = 5;
  else nice = 10;
  return nice * pow;
}

function priceGridLines(min, max, targetCount = 5) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const step = niceStep((max - min) / targetCount);
  const start = Math.ceil(min / step) * step;
  const lines = [];
  for (let v = start; v <= max; v += step) lines.push(v);
  return lines;
}

function formatPrice(v, currency) {
  if (v == null || isNaN(v)) return "";
  const symbols = { usd: "$", ngn: "₦", eur: "€", gbp: "£" };
  const sym = symbols[currency] || "";
  if (v >= 1000) return `${sym}${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `${sym}${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatVolume(v) {
  if (v == null || isNaN(v)) return "";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${v.toFixed(0)}`;
}

function formatTime(ms, spanMs) {
  const d = new Date(ms);
  if (spanMs <= 2 * 24 * 60 * 60 * 1000) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (spanMs <= 120 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

/**
 * Advanced price chart: candlestick or line/area mode, with a volume panel,
 * moving-average overlays, pinch-to-zoom + two-finger pan, and single-finger
 * crosshair scrubbing with a live OHLC readout. Built on react-native-svg +
 * the core PanResponder (no extra native gesture deps).
 *
 * Props:
 *  - candles: [{ time, open, high, low, close }] ascending by time
 *  - volumes: [{ time, volume }] ascending by time (optional)
 *  - overlays: [{ id, color, label, values }] values aligned 1:1 with candles
 *  - mode: 'candles' | 'line'
 *  - currency, width, height
 */
export default function PriceChart({
  candles,
  volumes = [],
  overlays = [],
  mode = "candles",
  currency = "usd",
  width,
  height = 320,
}) {
  const total = candles.length;
  const [visibleCount, setVisibleCount] = useState(total);
  const [startIndex, setStartIndex] = useState(0);
  const [crosshair, setCrosshair] = useState(null); // { index }

  // Keep the window valid as new data (different timeframe) comes in.
  const clampedVisible = clamp(visibleCount, Math.min(MIN_VISIBLE_CANDLES, total || 1), total || 1);
  const clampedStart = clamp(startIndex, 0, Math.max(0, total - clampedVisible));

  const gesture = useRef({
    mode: null, // 'pinch' | 'scrub'
    initialDistance: 0,
    initialVisible: clampedVisible,
    initialStart: clampedStart,
    initialMidX: 0,
  }).current;

  const volPanelH = volumes.length ? Math.round(height * 0.2) : 0;
  const priceH = height - volPanelH - (volumes.length ? 8 : 0);
  const axisW = 56; // right-side price-axis label gutter
  const chartW = Math.max(0, width - axisW);

  const visibleCandles = useMemo(
    () => candles.slice(clampedStart, clampedStart + clampedVisible),
    [candles, clampedStart, clampedVisible]
  );
  const visibleOverlays = useMemo(
    () =>
      overlays.map((ov) => ({
        ...ov,
        values: ov.values.slice(clampedStart, clampedStart + clampedVisible),
      })),
    [overlays, clampedStart, clampedVisible]
  );

  const { min: priceMin, max: priceMax } = useMemo(() => {
    if (!visibleCandles.length) return { min: 0, max: 1 };
    let min = Infinity;
    let max = -Infinity;
    for (const c of visibleCandles) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
    }
    for (const ov of visibleOverlays) {
      for (const v of ov.values) {
        if (v == null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const pad = (max - min) * 0.08 || max * 0.01 || 1;
    return { min: min - pad, max: max + pad };
  }, [visibleCandles, visibleOverlays]);

  const maxVolume = useMemo(() => {
    let max = 0;
    for (const c of visibleCandles) {
      const vp = nearestVolume(volumes, c.time);
      if (vp != null && vp > max) max = vp;
    }
    return max || 1;
  }, [visibleCandles, volumes]);

  const slotW = clampedVisible > 0 ? chartW / clampedVisible : 0;
  const priceToY = (p) => priceH - ((p - priceMin) / (priceMax - priceMin || 1)) * priceH;
  const indexToX = (i) => i * slotW + slotW / 2;

  // ---- gestures ---------------------------------------------------------
  const applyPinch = (touches) => {
    const [t0, t1] = touches;
    const dx = t0.pageX - t1.pageX;
    const dy = t0.pageY - t1.pageY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const midX = (t0.pageX + t1.pageX) / 2;

    if (gesture.mode !== "pinch") {
      gesture.mode = "pinch";
      gesture.initialDistance = distance || 1;
      gesture.initialVisible = clampedVisible;
      gesture.initialStart = clampedStart;
      gesture.initialMidX = midX;
      return;
    }

    const scaleFactor = distance / (gesture.initialDistance || 1);
    const newVisible = clamp(Math.round(gesture.initialVisible / scaleFactor), Math.min(MIN_VISIBLE_CANDLES, total), total);

    // Pan follows the average finger movement so the pinch stays anchored
    // under the fingers instead of jumping.
    const panPx = midX - gesture.initialMidX;
    const panCandles = slotW > 0 ? -panPx / slotW : 0;

    const newStart = clamp(
      Math.round(gesture.initialStart + (gesture.initialVisible - newVisible) / 2 + panCandles),
      0,
      Math.max(0, total - newVisible)
    );

    setVisibleCount(newVisible);
    setStartIndex(newStart);
  };

  const applyScrub = (locationX) => {
    if (!clampedVisible) return;
    const idx = clamp(Math.round(locationX / (slotW || 1) - 0.5), 0, clampedVisible - 1);
    setCrosshair({ index: idx });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          gesture.mode = null; // force re-init on first move
        } else {
          gesture.mode = "scrub";
          applyScrub(evt.nativeEvent.locationX);
        }
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          applyPinch(touches);
        } else if (gesture.mode !== "pinch") {
          gesture.mode = "scrub";
          applyScrub(evt.nativeEvent.locationX);
        }
      },
      onPanResponderRelease: () => {
        gesture.mode = null;
        setCrosshair(null);
      },
      onPanResponderTerminate: () => {
        gesture.mode = null;
        setCrosshair(null);
      },
    })
  ).current;

  if (!total) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyText}>No chart data yet</Text>
      </View>
    );
  }

  const gridLines = priceGridLines(priceMin, priceMax);
  const spanMs = visibleCandles.length > 1 ? visibleCandles[visibleCandles.length - 1].time - visibleCandles[0].time : 0;
  const crosshairCandle = crosshair ? visibleCandles[crosshair.index] : null;
  const crosshairVol = crosshairCandle ? nearestVolume(volumes, crosshairCandle.time) : null;
  const prevClose = crosshairCandle && crosshair.index > 0 ? visibleCandles[crosshair.index - 1].close : null;

  return (
    <View style={{ width, height: height + 24 }}>
      <View {...panResponder.panHandlers}>
        <Svg width={width} height={height}>
          {/* --- grid + price axis --- */}
          {gridLines.map((p) => (
            <G key={`grid-${p}`}>
              <Line
                x1={0}
                x2={chartW}
                y1={priceToY(p)}
                y2={priceToY(p)}
                stroke={colors.border}
                strokeWidth={1}
                strokeDasharray="2,4"
              />
              <SvgText x={chartW + 6} y={priceToY(p) + 3} fontSize={10} fill={colors.subtext}>
                {formatPrice(p, currency)}
              </SvgText>
            </G>
          ))}

          {/* --- candles or line/area --- */}
          {mode === "candles" ? (
            visibleCandles.map((c, i) => {
              const x = indexToX(i);
              const up = c.close >= c.open;
              const color = up ? colors.green : colors.red;
              const bodyTop = priceToY(Math.max(c.open, c.close));
              const bodyBottom = priceToY(Math.min(c.open, c.close));
              const bodyW = Math.max(1, slotW * 0.62);
              return (
                <G key={c.time}>
                  <Line x1={x} x2={x} y1={priceToY(c.high)} y2={priceToY(c.low)} stroke={color} strokeWidth={1} />
                  <Rect
                    x={x - bodyW / 2}
                    y={bodyTop}
                    width={bodyW}
                    height={Math.max(1, bodyBottom - bodyTop)}
                    fill={color}
                  />
                </G>
              );
            })
          ) : (
            <LineArea visibleCandles={visibleCandles} indexToX={indexToX} priceToY={priceToY} chartW={chartW} priceH={priceH} />
          )}

          {/* --- moving-average overlays --- */}
          {visibleOverlays.map((ov) => {
            const pts = ov.values
              .map((v, i) => (v == null ? null : `${indexToX(i)},${priceToY(v)}`))
              .filter(Boolean)
              .join(" ");
            if (!pts) return null;
            return <Polyline key={ov.id} points={pts} fill="none" stroke={ov.color} strokeWidth={1.5} />;
          })}

          {/* --- volume panel --- */}
          {volumes.length > 0 &&
            visibleCandles.map((c, i) => {
              const vp = nearestVolume(volumes, c.time);
              if (vp == null) return null;
              const x = indexToX(i);
              const barW = Math.max(1, slotW * 0.62);
              const barH = (vp / maxVolume) * (volPanelH - 4);
              const up = c.close >= c.open;
              return (
                <Rect
                  key={`vol-${c.time}`}
                  x={x - barW / 2}
                  y={priceH + 8 + (volPanelH - barH)}
                  width={barW}
                  height={barH}
                  fill={up ? colors.green : colors.red}
                  opacity={0.5}
                />
              );
            })}

          {/* --- crosshair --- */}
          {crosshairCandle && (
            <G>
              <Line
                x1={indexToX(crosshair.index)}
                x2={indexToX(crosshair.index)}
                y1={0}
                y2={priceH + 8 + volPanelH}
                stroke={colors.subtext}
                strokeWidth={1}
                strokeDasharray="3,3"
              />
              <Line
                x1={0}
                x2={chartW}
                y1={priceToY(crosshairCandle.close)}
                y2={priceToY(crosshairCandle.close)}
                stroke={colors.subtext}
                strokeWidth={1}
                strokeDasharray="3,3"
              />
              <Circle
                cx={indexToX(crosshair.index)}
                cy={priceToY(crosshairCandle.close)}
                r={3.5}
                fill={colors.orange}
              />
            </G>
          )}
        </Svg>
      </View>

      {/* --- x-axis time labels --- */}
      <View style={styles.xAxisRow}>
        <Text style={styles.axisLabel}>{visibleCandles[0] && formatTime(visibleCandles[0].time, spanMs)}</Text>
        <Text style={styles.axisLabel}>
          {visibleCandles.length > 1 && formatTime(visibleCandles[visibleCandles.length - 1].time, spanMs)}
        </Text>
      </View>

      {/* --- crosshair readout --- */}
      {crosshairCandle && (
        <View style={styles.tooltip} pointerEvents="none">
          <Text style={styles.tooltipTime}>
            {new Date(crosshairCandle.time).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
          <View style={styles.tooltipRow}>
            <OhlcStat label="O" value={formatPrice(crosshairCandle.open, currency)} />
            <OhlcStat label="H" value={formatPrice(crosshairCandle.high, currency)} />
            <OhlcStat label="L" value={formatPrice(crosshairCandle.low, currency)} />
            <OhlcStat
              label="C"
              value={formatPrice(crosshairCandle.close, currency)}
              color={
                prevClose != null ? (crosshairCandle.close >= prevClose ? colors.green : colors.red) : colors.text
              }
            />
            {crosshairVol != null && <OhlcStat label="24h Vol" value={formatVolume(crosshairVol)} />}
          </View>
        </View>
      )}
    </View>
  );
}

function OhlcStat({ label, value, color }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color && { color }]}>{value}</Text>
    </View>
  );
}

function LineArea({ visibleCandles, indexToX, priceToY, chartW, priceH }) {
  if (!visibleCandles.length) return null;
  const linePts = visibleCandles.map((c, i) => `${indexToX(i)},${priceToY(c.close)}`).join(" ");
  const firstX = indexToX(0);
  const lastX = indexToX(visibleCandles.length - 1);
  const areaPts = `${firstX},${priceH} ${linePts} ${lastX},${priceH}`;
  const rising = visibleCandles[visibleCandles.length - 1].close >= visibleCandles[0].close;
  const lineColor = rising ? colors.green : colors.red;
  return (
    <G>
      <Polyline points={areaPts} fill={lineColor} fillOpacity={0.12} stroke="none" />
      <Polyline points={linePts} fill="none" stroke={lineColor} strokeWidth={2} />
    </G>
  );
}

/** Nearest-time lookup (volumes are a coarser/denser series than candles). */
function nearestVolume(volumes, time) {
  if (!volumes.length) return null;
  let lo = 0;
  let hi = volumes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (volumes[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(volumes[lo - 1].time - time) < Math.abs(volumes[lo].time - time)) lo -= 1;
  return volumes[lo].volume;
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", justifyContent: "center" },
  emptyText: { color: colors.subtext, fontSize: 13 },
  xAxisRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 4, paddingHorizontal: 2 },
  axisLabel: { color: colors.subtext, fontSize: 10 },
  tooltip: {
    position: "absolute",
    top: 4,
    left: 4,
    backgroundColor: "#0000009A",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tooltipTime: { color: colors.subtext, fontSize: 10, marginBottom: 3 },
  tooltipRow: { flexDirection: "row", gap: 10 },
  stat: { alignItems: "flex-start" },
  statLabel: { color: colors.subtext, fontSize: 9 },
  statValue: { color: colors.text, fontSize: 11, fontWeight: "600" },
});
