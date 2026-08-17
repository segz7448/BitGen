import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";

import HomeScreen from "../screens/HomeScreen";
import MarketScreen from "../screens/MarketScreen";
import AccountsScreen from "../screens/AccountsScreen"; // stands in as the Wallet tab for now — full wallet-tab redesign is a separate pass
import SettingsScreen from "../screens/SettingsScreen";

const Tab = createBottomTabNavigator();

const ICONS = {
  Home: "home",
  Market: "bar-chart",
  Wallet: "wallet",
  Settings: "settings",
};

/**
 * The four-tab shell (Home / Market / Wallet / Settings) requested as the
 * app's main structure. This is step one of the redesign — it wires the
 * navigation frame and points each tab at its screen; the Wallet tab
 * currently reuses the existing AccountsScreen (Funding & Trading) as a
 * placeholder until that screen gets its own redesign pass, and Market
 * is a first-pass screen (coin list + live BTC price) rather than the
 * full per-coin chart + converter experience, which is its own step.
 */
export default function MainTabs() {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.orange,
        headerTitleStyle: { color: colors.text },
        tabBarActiveTintColor: colors.orange,
        tabBarInactiveTintColor: colors.subtext,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons
            name={focused ? ICONS[route.name] : `${ICONS[route.name]}-outline`}
            color={color}
            size={size ?? 22}
          />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: "BITGEN" }} />
      <Tab.Screen name="Market" component={MarketScreen} options={{ title: "Market" }} />
      <Tab.Screen name="Wallet" component={AccountsScreen} options={{ title: "Funding & Trading" }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
    </Tab.Navigator>
  );
}
