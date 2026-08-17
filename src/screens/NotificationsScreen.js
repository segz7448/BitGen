import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { spacing, useTheme } from "../theme";
import { listNotifications, markAllNotificationsRead } from "../db/notificationRepo";
import { GlassCard } from "../components/Glass";

function timeAgo(ms) {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const rows = await listNotifications();
    setItems(rows);
    setLoading(false);
    markAllNotificationsRead().catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!loading && items.length === 0) {
    return (
      <View style={[styles.container, styles.emptyWrap]}>
        <Text style={styles.emptyTitle}>No notifications yet</Text>
        <Text style={styles.emptyBody}>
          BTC/USDT received, transaction confirmations, and price-move alerts will show up here as
          they happen.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: spacing(2) }}
      data={items}
      keyExtractor={(item) => String(item.id)}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.orange} />}
      renderItem={({ item }) => (
        <GlassCard style={styles.row}>
          <Text style={styles.title}>{item.title}</Text>
          {!!item.body && <Text style={styles.body}>{item.body}</Text>}
          <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
        </GlassCard>
      )}
    />
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    emptyWrap: { alignItems: "center", justifyContent: "center", padding: spacing(4) },
    emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: spacing(1) },
    emptyBody: { color: colors.subtext, fontSize: 13, textAlign: "center", lineHeight: 19 },
    row: { padding: spacing(2), marginBottom: spacing(1.25) },
    title: { color: colors.text, fontSize: 14, fontWeight: "700" },
    body: { color: colors.subtext, fontSize: 13, marginTop: 4, lineHeight: 18 },
    time: { color: colors.subtext, fontSize: 11, marginTop: spacing(1) },
  });
}
