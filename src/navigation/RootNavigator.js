import React, { useEffect, useState, useRef } from "react";
import { View, ActivityIndicator, AppState } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { hasMnemonic } from "../wallet/secureSeed";
import { hasPin } from "../wallet/appLock";
import { isWatchOnly } from "../wallet/walletMode";
import { startRealtimeNotifications } from "../realtime/realtimeManager";

import WelcomeScreen from "../screens/WelcomeScreen";
import CreateWalletScreen from "../screens/CreateWalletScreen";
import ImportWalletScreen from "../screens/ImportWalletScreen";
import ConfirmSeedScreen from "../screens/ConfirmSeedScreen";
import SetPinScreen from "../screens/SetPinScreen";
import LockScreen from "../screens/LockScreen";
import HomeScreen from "../screens/HomeScreen";
import ReceiveScreen from "../screens/ReceiveScreen";
import SendScreen from "../screens/SendScreen";
import AddressesScreen from "../screens/AddressesScreen";
import SettingsScreen from "../screens/SettingsScreen";
import ScanScreen from "../screens/ScanScreen";
import TransactionHistoryScreen from "../screens/TransactionHistoryScreen";
import BumpFeeScreen from "../screens/BumpFeeScreen";
import CpfpScreen from "../screens/CpfpScreen";
import WatchOnlyImportScreen from "../screens/WatchOnlyImportScreen";
import ExportBackupScreen from "../screens/ExportBackupScreen";
import ImportBackupScreen from "../screens/ImportBackupScreen";
import SwapScreen from "../screens/SwapScreen";
import ChartScreen from "../screens/ChartScreen";
import AccountsScreen from "../screens/AccountsScreen";
import DexTradeScreen from "../screens/DexTradeScreen";
import AssetPickerScreen from "../screens/AssetPickerScreen";
import DepositScreen from "../screens/DepositScreen";
import WithdrawScreen from "../screens/WithdrawScreen";
import TransferScreen from "../screens/TransferScreen";

const Stack = createNativeStackNavigator();

const screenOptions = {
  headerStyle: { backgroundColor: "#0B0B0F" },
  headerTintColor: "#F7931A",
  headerTitleStyle: { color: "#FFFFFF" },
  contentStyle: { backgroundColor: "#0B0B0F" },
};

export default function RootNavigator() {
  const [initializing, setInitializing] = useState(true);
  const [walletExists, setWalletExists] = useState(false);
  const [pinExists, setPinExists] = useState(false);
  const [locked, setLocked] = useState(false);
  const appState = useRef(AppState.currentState);

  const bootstrap = async () => {
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

  if (initializing) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0B0B0F", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#F7931A" />
      </View>
    );
  }

  if (walletExists && pinExists && locked) {
    return <LockScreen onUnlock={() => setLocked(false)} />;
  }

  return (
    <Stack.Navigator
      initialRouteName={walletExists ? "Home" : "Welcome"}
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
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: "BITGEN", headerBackVisible: false }} />
      <Stack.Screen name="Receive" component={ReceiveScreen} options={{ title: "Receive" }} />
      <Stack.Screen name="Send" component={SendScreen} options={{ title: "Send" }} />
      <Stack.Screen name="Swap" component={SwapScreen} options={{ title: "Swap" }} />
      <Stack.Screen name="Chart" component={ChartScreen} options={{ title: "BTC Price" }} />
      <Stack.Screen name="Accounts" component={AccountsScreen} options={{ title: "Funding & Trading" }} />
      <Stack.Screen name="DexTrade" component={DexTradeScreen} options={{ title: "DEX Trade" }} />
      <Stack.Screen name="AssetPicker" component={AssetPickerScreen} options={{ title: "Select Coin" }} />
      <Stack.Screen name="Deposit" component={DepositScreen} options={{ title: "Add Funds" }} />
      <Stack.Screen name="Withdraw" component={WithdrawScreen} options={{ title: "Withdraw" }} />
      <Stack.Screen name="TransferAccounts" component={TransferScreen} options={{ title: "Transfer" }} />
      <Stack.Screen name="Addresses" component={AddressesScreen} options={{ title: "Your Addresses" }} />
      <Stack.Screen name="History" component={TransactionHistoryScreen} options={{ title: "Transaction History" }} />
      <Stack.Screen name="BumpFee" component={BumpFeeScreen} options={{ title: "Bump Fee" }} />
      <Stack.Screen name="Cpfp" component={CpfpScreen} options={{ title: "Speed Up Payment" }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
      <Stack.Screen name="ExportBackup" component={ExportBackupScreen} options={{ title: "Export Backup" }} />
      <Stack.Screen name="Scan" component={ScanScreen} options={{ title: "Scan QR" }} />
    </Stack.Navigator>
  );
}
