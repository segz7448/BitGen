import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { colors } from "../theme";

const STATUS_CONFIG = {
  open: { color: colors.green, label: "Live", pulse: true },
  connecting: { color: colors.orange, label: "Connecting", pulse: true },
  reconnecting: { color: colors.orange, label: "Reconnecting", pulse: true },
  closed: { color: colors.red, label: "Offline", pulse: false },
  idle: { color: colors.subtext, label: "Offline", pulse: false },
};

/**
 * Pulsing dot + label reflecting the *actual* WebSocket connection state
 * for the live price feed — not just decorative. Pass `status` from
 * `useConnectionStatus()` (src/store/priceStore.js); omit it to fall back
 * to a plain always-on "Live" pulse for non-price contexts.
 */
export default function LiveIndicator({ status, label, style }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const cfg = status
    ? STATUS_CONFIG[status] || STATUS_CONFIG.idle
    : { color: colors.green, label: "Live", pulse: true };
  const shouldPulse = cfg.pulse;

  useEffect(() => {
    if (!shouldPulse) {
      pulse.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse, shouldPulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] });
  const displayLabel = label ?? cfg.label;

  return (
    <View style={[styles.row, style]}>
      <View style={styles.dotWrap}>
        {shouldPulse && (
          <Animated.View style={[styles.ping, { backgroundColor: cfg.color, transform: [{ scale }], opacity }]} />
        )}
        <View style={[styles.dot, { backgroundColor: cfg.color }]} />
      </View>
      {!!displayLabel && <Text style={styles.label}>{displayLabel}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 5 },
  dotWrap: { width: 8, height: 8, alignItems: "center", justifyContent: "center" },
  dot: { width: 6, height: 6, borderRadius: 3, position: "absolute" },
  ping: { width: 6, height: 6, borderRadius: 3, position: "absolute" },
  label: { color: colors.subtext, fontSize: 10, fontWeight: "600", letterSpacing: 0.3 },
});
