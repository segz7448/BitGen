import React, { useEffect, useState, useRef } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, AppState, StyleSheet } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { hasMnemonic } from "../wallet/secureSeed";
import { hasPin } from "../wallet/appLock";
import { onLockRequested } from "../wallet/lockBus";
import { isWatchOnly } from "../wallet/walletMode";
import { startRealtimeNotifications } from "../realtime/realtimeManager";

import WelcomeScreen from "../screens/WelcomeScreen";
import CreateWalletScreen from "../screens/CreateWalletScreen";
import ImportWalletScreen from "../screens/ImportWalletScreen";
import ConfirmSeedScreen from "../screens/ConfirmSeedScreen";
import SetPinScreen from "../screens/SetPinScreen";
import LockScreen from "../screens/LockScreen";
import MainTabs from "./MainTabs";
import ReceiveScreen from "../screens/ReceiveScreen";
import SendScreen from "../screens/SendScreen";
import AddressesScreen from "../screens/AddressesScreen";
import ScanScreen from "../screens/ScanScreen";
import TransactionHistoryScreen from "../screens/TransactionHistoryScreen";
import BumpFeeScreen from "../screens/BumpFeeScreen";
import CpfpScreen from "../screens/CpfpScreen";
import WatchOnlyImportScreen from "../screens/WatchOnlyImportScreen";
import ExportBackupScreen from "../screens/ExportBackupScreen";
import ImportBackupScreen from "../screens/ImportBackupScreen";
import ChartScreen from "../screens/ChartScreen";
import DexTradeScreen from "../screens/DexTradeScreen";
import AssetPickerScreen from "../screens/AssetPickerScreen";
import DepositScreen from "../screens/DepositScreen";
import WithdrawScreen from "../screens/WithdrawScreen";
import TransferScreen from "../screens/TransferScreen";
import NotificationsScreen from "../screens/NotificationsScreen";
import { useTheme } from "../theme";

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { colors } = useTheme();
  const screenOptions = {
    headerStyle: { backgroundColor: colors.bg },
    headerTintColor: colors.orange,
    headerTitleStyle: { color: colors.text },
    contentStyle: { backgroundColor: colors.bg },
  };
  const [initializing, setInitializing] = useState(true);
  const [walletExists, setWalletExists] = useState(false);
  const [pinExists, setPinExists] = useState(false);
  const [locked, setLocked] = useState(false);
  const [bootError, setBootError] = useState(null);
  const appState = useRef(AppState.currentState);

  const bootstrap = async () => {
    setBootError(null);
    try {
      const exists = await hasMnemonic();
      const watchOnly = await isWatchOnly();
      const pin = watchOnly ? false : await hasPin();
      setWalletExists(exists || watchOnly);
      setPinExists(pin);
      setLocked(pin); // require unlock on cold start if a PIN is configured
      setInitializing(false);

      // Automatic, no toggle: the moment a wallet exists on this device,
      // BTC/USDT-received, tx-confirmed, and price-move notifications start
      // running for the lifetime of the app — including while the lock
      // screen is showing, since funds don't wait for the user to unlock.
      if (exists || watchOnly) {
        startRealtimeNotifications().catch(() => {});
      }
    } catch (e) {
      // CRITICAL: hasMnemonic() reads from the Android Keystore-backed
      // SecureStore, which can occasionally throw (transient keystore
      // lock, OS-level hiccup) rather than just resolve to null. Treating
      // a failed READ the same as "no wallet" would silently route to
      // the Welcome/create-wallet screen — a real wallet with real funds
      // would look deleted, and worse, the user could create a NEW
      // wallet believing the old one is gone. Surface this as a distinct
      // error state with a retry instead of ever guessing "no wallet."
      setBootError(e.message || "Couldn't access secure storage");
      setInitializing(false);
    }
  };

  useEffect(() => {
    bootstrap();
  }, []);

  // Re-lock whenever the app comes back from background, if a PIN is set.
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === "active") {
        if (pinExists) setLocked(true);
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [pinExists]);

  // "Log out" in Settings — this is a non-custodial wallet with no server
  // session to end, so logging out means locking the app immediately,
  // same screen the user would hit backgrounding and returning.
  useEffect(() => onLockRequested(() => { if (pinExists) setLocked(true); }), [pinExists]);

  if (initializing) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  if (bootError) {
    return (
      <View style={[bootErrorStyles.container, { backgroundColor: colors.bg }]}>
        <Text style={[bootErrorStyles.title, { color: colors.text }]}>Couldn't unlock wallet storage</Text>
        <Text style={[bootErrorStyles.body, { color: colors.subtext }]}>
          BITGEN couldn't read your device's secure storage just now — this is usually temporary (a
          keystore hiccup or the OS still finishing startup). Your wallet has NOT been deleted; nothing
          gets removed just because this check failed. Tap Retry, or fully close and reopen the app if
          it keeps happening.
        </Text>
        <TouchableOpacity style={[bootErrorStyles.button, { backgroundColor: colors.orange }]} onPress={bootstrap}>
          <Text style={bootErrorStyles.buttonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (walletExists && pinExists && locked) {
    return <LockScreen onUnlock={() => setLocked(false)} />;
  }

  return (
    <Stack.Navigator
      initialRouteName={walletExists ? "MainTabs" : "Welcome"}
      screenOptions={screenOptions}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CreateWallet" component={CreateWalletScreen} options={{ title: "Create Wallet" }} />
      <Stack.Screen name="ConfirmSeed" component={ConfirmSeedScreen} options={{ title: "Confirm Backup" }} />
      <Stack.Screen name="ImportWallet" component={ImportWalletScreen} options={{ title: "Import Wallet" }} />
      <Stack.Screen name="WatchOnlyImport" component={WatchOnlyImportScreen} options={{ title: "Watch-Only Wallet" }} />
      <Stack.Screen name="ImportBackup" component={ImportBackupScreen} options={{ title: "Restore Backup" }} />
      <Stack.Screen
        name="SetPin"
        component={SetPinScreen}
        options={{ title: "Set PIN", headerBackVisible: false, gestureEnabled: false }}
        listeners={{
          beforeRemove: () => {
            setPinExists(true);
            setWalletExists(true);
            // First-time wallet creation/import in this session — bootstrap()
            // ran before the wallet existed, so kick the realtime watchers
            // off now instead of waiting for the next cold start.
            startRealtimeNotifications().catch(() => {});
          },
        }}
      />
      <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen name="Receive" component={ReceiveScreen} options={{ title: "Receive" }} />
      <Stack.Screen name="Send" component={SendScreen} options={{ title: "Send" }} />
      <Stack.Screen name="Chart" component={ChartScreen} options={{ title: "BTC Price" }} />
      <Stack.Screen name="DexTrade" component={DexTradeScreen} options={{ title: "DEX Trade" }} />
      <Stack.Screen name="AssetPicker" component={AssetPickerScreen} options={{ title: "Select Coin" }} />
      <Stack.Screen name="Deposit" component={DepositScreen} options={{ title: "Add Funds" }} />
      <Stack.Screen name="Withdraw" component={WithdrawScreen} options={{ title: "Withdraw" }} />
      <Stack.Screen name="TransferAccounts" component={TransferScreen} options={{ title: "Transfer" }} />
      <Stack.Screen name="Addresses" component={AddressesScreen} options={{ title: "Your Addresses" }} />
      <Stack.Screen name="History" component={TransactionHistoryScreen} options={{ title: "Transaction History" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
      <Stack.Screen name="BumpFee" component={BumpFeeScreen} options={{ title: "Bump Fee" }} />
      <Stack.Screen name="Cpfp" component={CpfpScreen} options={{ title: "Speed Up Payment" }} />
      <Stack.Screen name="ExportBackup" component={ExportBackupScreen} options={{ title: "Export Backup" }} />
      <Stack.Screen name="Scan" component={ScanScreen} options={{ title: "Scan QR" }} />
    </Stack.Navigator>
  );
}

const bootErrorStyles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  title: { fontSize: 17, fontWeight: "700", marginBottom: 12, textAlign: "center" },
  body: { fontSize: 13, lineHeight: 19, textAlign: "center", marginBottom: 24 },
  button: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  buttonText: { color: "#0B0B0F", fontWeight: "700", fontSize: 15 },
});
