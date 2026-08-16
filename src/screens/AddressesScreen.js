import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Switch, TouchableOpacity, Alert, TextInput } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { colors, spacing } from "../theme";
import { getAllAddresses, setAddressActive, setAddressLabel, setCurrentAddress } from "../db/addressRepo";

export default function AddressesScreen() {
  const [addresses, setAddresses] = useState([]);
  const [editingLabel, setEditingLabel] = useState(null);
  const [labelDraft, setLabelDraft] = useState("");

  const refresh = useCallback(async () => {
    setAddresses(await getAllAddresses({ change: 0, includeInactive: true }));
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const toggleActive = async (item) => {
    if (item.is_active && item.balance_sats > 0) {
      Alert.alert(
        "Disable this address?",
        "It still holds a balance and Bitcoin will still deliver funds sent to it — BITGEN will just hide it from the Receive picker. You can re-enable it anytime.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Disable anyway", style: "destructive", onPress: async () => { await setAddressActive(item.address, false); refresh(); } },
        ]
      );
      return;
    }
    await setAddressActive(item.address, !item.is_active);
    refresh();
  };

  const saveLabel = async (address) => {
    await setAddressLabel(address, labelDraft.trim());
    setEditingLabel(null);
    refresh();
  };

  const makeCurrent = async (address) => {
    await setCurrentAddress(address);
    Alert.alert("Set as current", "This address is now shown on the Receive screen.");
    refresh();
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={addresses}
        keyExtractor={(item) => item.address}
        contentContainerStyle={{ padding: spacing(2) }}
        renderItem={({ item }) => (
          <View style={[styles.row, !item.is_active && styles.rowInactive]}>
            <View style={{ flex: 1 }}>
              {editingLabel === item.address ? (
                <TextInput
                  style={styles.labelInput}
                  value={labelDraft}
                  onChangeText={setLabelDraft}
                  onSubmitEditing={() => saveLabel(item.address)}
                  onBlur={() => saveLabel(item.address)}
                  autoFocus
                  placeholder="Label this address"
                  placeholderTextColor={colors.subtext}
                />
              ) : (
                <TouchableOpacity onPress={() => { setEditingLabel(item.address); setLabelDraft(item.label || ""); }}>
                  <Text style={styles.label}>{item.label || `Address #${item.derivation_index}`}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.address} numberOfLines={1}>{item.address}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.balance}>{item.balance_sats} sats</Text>
                {item.is_current === 1 && <Text style={styles.currentTag}>CURRENT</Text>}
                {!item.is_active && <Text style={styles.disabledTag}>DISABLED</Text>}
              </View>
              {item.is_active === 1 && item.is_current !== 1 && (
                <TouchableOpacity onPress={() => makeCurrent(item.address)}>
                  <Text style={styles.setCurrentLink}>Set as current</Text>
                </TouchableOpacity>
              )}
            </View>
            <Switch
              value={!!item.is_active}
              onValueChange={() => toggleActive(item)}
              trackColor={{ false: colors.border, true: colors.orange }}
              thumbColor="#FFFFFF"
            />
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No addresses yet.</Text>}
        ListFooterComponent={
          <Text style={styles.footnote}>
            Disabling an address only hides it in BITGEN. It's still a valid Bitcoin address and can
            still receive funds — the wallet keeps syncing its balance in the background.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  row: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: spacing(2), marginBottom: spacing(1.5),
  },
  rowInactive: { opacity: 0.55 },
  label: { color: colors.text, fontWeight: "600", fontSize: 14 },
  labelInput: { color: colors.text, fontWeight: "600", fontSize: 14, borderBottomWidth: 1, borderBottomColor: colors.orange, paddingVertical: 2 },
  address: { color: colors.subtext, fontSize: 11, marginTop: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing(1), marginTop: 4 },
  balance: { color: colors.text, fontSize: 12 },
  currentTag: { color: colors.orange, fontSize: 10, fontWeight: "700" },
  disabledTag: { color: colors.red, fontSize: 10, fontWeight: "700" },
  setCurrentLink: { color: colors.orange, fontSize: 11, marginTop: 6 },
  empty: { color: colors.subtext, textAlign: "center", marginTop: spacing(4) },
  footnote: { color: colors.subtext, fontSize: 11, textAlign: "center", marginTop: spacing(2), lineHeight: 16, paddingHorizontal: spacing(2) },
});
