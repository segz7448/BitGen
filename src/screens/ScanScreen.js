import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { colors, spacing } from "../theme";

export default function ScanScreen({ navigation }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    requestPermission();
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission is required to scan QR codes.</Text>
      </View>
    );
  }

  const onScan = ({ data }) => {
    if (scanned) return;
    setScanned(true);
    const address = data.startsWith("bitcoin:") ? data.slice(8).split("?")[0] : data;
    navigation.navigate("Send", { scannedAddress: address });
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={scanned ? undefined : onScan}
      />
      <View style={styles.overlay}>
        <View style={styles.frame} />
        <Text style={styles.hint}>Point at a Bitcoin address QR code</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  text: { color: colors.text, textAlign: "center", padding: spacing(3) },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: { width: 240, height: 240, borderWidth: 2, borderColor: colors.orange, borderRadius: 16 },
  hint: { color: "#FFFFFF", marginTop: spacing(2), fontSize: 13 },
});
