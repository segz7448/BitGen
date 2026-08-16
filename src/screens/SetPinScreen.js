import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { colors, spacing } from "../theme";
import { setPin } from "../wallet/appLock";

export default function SetPinScreen({ navigation, route }) {
  const [stage, setStage] = useState("enter"); // 'enter' | 'confirm'
  const [firstPin, setFirstPin] = useState("");
  const [pin, setPinInput] = useState("");
  const onFinish = route.params?.onFinish; // optional callback route name

  const digit = (d) => {
    if (pin.length >= 6) return;
    const next = pin + d;
    setPinInput(next);
    if (next.length === 6) {
      if (stage === "enter") {
        setFirstPin(next);
        setPinInput("");
        setStage("confirm");
      } else {
        if (next !== firstPin) {
          Alert.alert("PINs don't match", "Let's try again.");
          setStage("enter");
          setFirstPin("");
          setPinInput("");
          return;
        }
        setPin(next).then(() => {
          navigation.reset({ index: 0, routes: [{ name: "Home" }] });
        });
      }
    }
  };

  const backspace = () => setPinInput((p) => p.slice(0, -1));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{stage === "enter" ? "Set a PIN" : "Confirm your PIN"}</Text>
      <Text style={styles.subtitle}>Used to unlock BITGEN each time you open it.</Text>

      <View style={styles.dots}>
        {[...Array(6)].map((_, i) => (
          <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: "center", paddingTop: spacing(8) },
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  subtitle: { color: colors.subtext, fontSize: 13, marginTop: spacing(1), textAlign: "center", paddingHorizontal: spacing(4) },
  dots: { flexDirection: "row", gap: spacing(1.5), marginVertical: spacing(4) },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: colors.border },
  dotFilled: { backgroundColor: colors.orange, borderColor: colors.orange },
  keypad: { flexDirection: "row", flexWrap: "wrap", width: 260, justifyContent: "center" },
  key: { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  keyText: { color: colors.text, fontSize: 24 },
});
