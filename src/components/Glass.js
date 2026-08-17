import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import { BlurView } from "expo-blur";
import { useTheme } from "../theme";

/**
 * Shared glassmorphic primitives used across the redesigned screens.
 *
 * GlassCard: a translucent, blurred surface — the workhorse container for
 * balance cards, list rows, and panels. Falls back to a plain translucent
 * tint on Android where BlurView historically renders inconsistently
 * across OEM skins (MIUI included); the tint alone still reads as
 * "glass" against the themed background, it just doesn't sample what's
 * behind it.
 *
 * GlassIcon: a round glass chip for action-button icons (Add funds,
 * Withdraw, Scan, etc.) — the "premium icon" treatment requested,
 * without depending on any specific icon set beyond what's already
 * installed (@expo/vector-icons).
 */
export function GlassCard({ children, style, intensity = 40, radius = 20, ...props }) {
  const { colors, mode } = useTheme();
  const content = (
    <View
      style={[
        styles.card,
        {
          borderRadius: radius,
          borderColor: colors.glassBorder,
          backgroundColor: Platform.OS === "android" ? colors.glass : "transparent",
        },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );

  if (Platform.OS === "android") return content;

  return (
    <View style={[styles.wrap, { borderRadius: radius }]}>
      <BlurView
        intensity={intensity}
        tint={mode === "light" ? "light" : "dark"}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.card, { borderRadius: radius, borderColor: colors.glassBorder, backgroundColor: colors.glass }, style]} {...props}>
        {children}
      </View>
    </View>
  );
}

export function GlassIcon({ children, size = 46, style }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: colors.glassBorder,
          backgroundColor: colors.glass,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
  card: { borderWidth: 1, overflow: "hidden" },
});
