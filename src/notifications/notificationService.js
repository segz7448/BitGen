import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { claimNotification, pruneOldNotifications, logNotification } from "../db/notificationRepo";

/**
 * BITGEN's local (device-only) notification layer. There is no server —
 * this is a non-custodial wallet, so nothing about your wallet ever
 * leaves the device to power these — every alert is generated on-device
 * by the realtime watchers in src/realtime/ and fired as a local
 * notification via Notifications.scheduleNotificationAsync with
 * trigger: null (fire immediately).
 *
 * There is deliberately no in-app on/off switch for this: the whole
 * point is that receiving funds notifies you without you having to
 * configure anything. The only "toggle" that exists is the OS-level
 * notification permission, which every app must ask the user for —
 * that's requested once, automatically, on first launch.
 *
 * IMPORTANT HONEST LIMITATION: iOS and Android both suspend a plain JS
 * WebSocket once the app is fully killed (not just backgrounded) — no
 * app without a push-notification server can get around this. So this
 * system delivers true, instant push while BITGEN is open or
 * backgrounded-but-alive, and catches up the moment the app is
 * reopened (any events missed while fully killed still show up in
 * Transaction History and fire once as "backlog" is reconciled on
 * next launch). Turning this into always-on background push while the
 * app is fully closed would require a server-side watcher + APNs/FCM,
 * which is out of scope for a wallet with no backend.
 */

let channelReady = false;
let permissionReady = false;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Call once, early (App.js / RootNavigator). Sets up the Android
 * notification channel and requests the OS permission if it hasn't been
 * granted or denied yet. Safe to call multiple times — it no-ops after
 * the first successful setup.
 */
export async function ensureNotificationsReady() {
  if (Platform.OS === "android" && !channelReady) {
    await Notifications.setNotificationChannelAsync("wallet-events", {
      name: "Wallet activity",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 100, 250],
      lightColor: "#F7931A",
      sound: "default",
      bypassDnd: false,
    });
    channelReady = true;
  }

  if (!permissionReady) {
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== "granted") {
      // Automatic — fired on first launch, no manual settings toggle in
      // BITGEN itself. If the user declines at the OS prompt, notifications
      // simply won't show (same as any other app); nothing else in the
      // realtime system is gated behind this.
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      });
    }
    permissionReady = true;
  }

  pruneOldNotifications().catch(() => {});
}

/**
 * Fire a local notification for `eventKey`, but only the first time ever
 * seen — every realtime watcher and every poll/reconnect cycle can call
 * this freely for the same underlying chain event without risking a
 * duplicate push. Returns true if it actually fired.
 */
export async function notifyOnce(eventKey, { title, body, data } = {}) {
  const claimed = await claimNotification(eventKey).catch(() => false);
  if (!claimed) return false;

  logNotification({ title, body }).catch(() => {});
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data || {},
        sound: "default",
      },
      trigger: null, // fire immediately
    });
  } catch {
    // Scheduling can fail if permission was denied — silently drop rather
    // than throw and take down whichever watcher called this.
  }
  return true;
}

/**
 * Fire a local notification unconditionally (no txid-style dedupe key) —
 * used for things like price-move alerts, where the caller already does
 * its own threshold/throttle logic instead of a one-shot event id.
 */
export async function notifyNow({ title, body, data } = {}) {
  logNotification({ title, body }).catch(() => {});
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: data || {}, sound: "default" },
      trigger: null,
    });
  } catch {
    // see notifyOnce
  }
}
