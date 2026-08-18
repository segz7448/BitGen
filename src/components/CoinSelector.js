import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable } from "react-native";
import { spacing, useTheme } from "../theme";

const COINS = ["BTC", "ETH", "USDT"];

/**
 * Same pill+dropdown pattern as CurrencySelector, for picking which
 * crypto asset the converter's top field represents.
 */
export default function CoinSelector({ value, onChange }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity style={styles.pill} onPress={() => setOpen(true)}>
        <Text style={styles.pillText}>{value}</Text>
        <Text style={styles.caret}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.menu}>
            {COINS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.menuItem, c === value && styles.menuItemActive]}
                onPress={() => {
                  setOpen(false);
                  onChange(c);
                }}
              >
                <Text style={[styles.menuItemText, c === value && styles.menuItemTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    pill: {
      flexDirection: "row", alignItems: "center", gap: 4,
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
      borderRadius: 8, paddingHorizontal: spacing(1.25), paddingVertical: spacing(0.5),
    },
    pillText: { color: colors.text, fontSize: 13, fontWeight: "600" },
    caret: { color: colors.subtext, fontSize: 12 },
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
    menu: {
      backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
      minWidth: 160, paddingVertical: spacing(0.5), overflow: "hidden",
    },
    menuItem: { paddingVertical: spacing(1.5), paddingHorizontal: spacing(2) },
    menuItemActive: { backgroundColor: colors.bg },
    menuItemText: { color: colors.subtext, fontSize: 14 },
    menuItemTextActive: { color: colors.orange, fontWeight: "700" },
  });
}
