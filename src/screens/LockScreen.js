import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { colors, spacing } from "../theme";
import { verifyPin, biometricAvailable, biometricAuth } from "../wallet/appLock";

export default function LockScreen({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [tryBiometricFirst, setTryBiometricFirst] = useState(true);

  useEffect(() => {
    (async () => {
      if (await biometricAvailable()) {
        const ok = await biometricAuth();
        if (ok) onUnlock();
      }
      setTryBiometricFirst(false);
    })();
  }, []);

  const digit = async (d) => {
    if (pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    setError(false);
    if (next.length === 6) {
      const ok = await verifyPin(next);
      if (ok) {
        onUnlock();
      } else {
        setError(true);
        setTimeout(() => setPin(""), 400);
      }
    }
  };

  const backspace = () => setPin((p) => p.slice(0, -1));

  const retryBiometric = async () => {
    if (await biometricAvailable()) {
      const ok = await biometricAuth();
      if (ok) onUnlock();
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>₿</Text>
      <Text style={styles.title}>Enter PIN</Text>
      {error && <Text style={styles.error}>Incorrect PIN</Text>}

      <View style={styles.dots}>
        {[...Array(6)].map((_, i) => (
          <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled, error && styles.dotError]} />
        ))}
      </View>

      <View style={styles.keypad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) => (
          <TouchableOpacity
            key={i}
            style={styles.key}
            disabled={k === ""}
            onPress={() => (k === "⌫" ? backspace() : k !== "" && digit(k))}
          >
            <Text style={styles.keyText}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity onPress={retryBiometric}>
        <Text style={styles.biometricLink}>Use biometrics instead</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  logo: { fontSize: 48, color: colors.orange, marginBottom: spacing(2) },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  error: { color: colors.red, fontSize: 12, marginTop: spacing(1) },
  dots: { flexDirection: "row", gap: spacing(1.5), marginVertical: spacing(4) },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: colors.border },
  dotFilled: { backgroundColor: colors.orange, borderColor: colors.orange },
  dotError: { backgroundColor: colors.red, borderColor: colors.red },
  keypad: { flexDirection: "row", flexWrap: "wrap", width: 260, justifyContent: "center" },
  key: { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  keyText: { color: colors.text, fontSize: 24 },
  biometricLink: { color: colors.orange, marginTop: spacing(3), fontSize: 13 },
});
