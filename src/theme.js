import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Appearance } from "react-native";
import * as SecureStore from "expo-secure-store";

// ---------------------------------------------------------------------
// Palettes. Same key set in both modes so every screen can read
// `colors.bg`, `colors.card`, etc. without caring which mode is active.
// `glass`/`glassBorder` are a translucent surface for glassmorphic
// cards/icons, meant to sit over a blurred background.
// ---------------------------------------------------------------------
const dark = {
  mode: "dark",
  bg: "#0B0B0F",
  card: "#16161D",
  border: "#26262F",
  text: "#FFFFFF",
  subtext: "#8B8B96",
  orange: "#F7931A",
  green: "#2ECC71",
  red: "#FF5C5C",
  glass: "rgba(255,255,255,0.06)",
  glassBorder: "rgba(255,255,255,0.12)",
  overlay: "rgba(0,0,0,0.55)",
};

const light = {
  mode: "light",
  bg: "#F5F5F7",
  card: "#FFFFFF",
  border: "#E4E4EA",
  text: "#0B0B0F",
  subtext: "#6B6B76",
  orange: "#F7931A",
  green: "#1FA557",
  red: "#E0453F",
  glass: "rgba(255,255,255,0.55)",
  glassBorder: "rgba(0,0,0,0.08)",
  overlay: "rgba(0,0,0,0.35)",
};

const PALETTES = { dark, light };
const PREF_KEY = "bitgen_theme_mode_v1"; // "dark" | "light" | "system"

// ---------------------------------------------------------------------
// Legacy compatibility: every existing screen does
// `import { colors, spacing } from "../theme"` and reads e.g. `colors.bg`
// inside a module-level `StyleSheet.create({...})`, which runs ONCE at
// import time. Mutating `colors` later can't retroactively re-theme
// those already-created stylesheets — only screens migrated to read
// colors from `useTheme()` inside the component body re-render on a
// mode change. `colors` stays exported as a live object (starts dark,
// matching the app's original look) so unmigrated screens behave
// exactly as before until they're moved over to useTheme().
// ---------------------------------------------------------------------
export const colors = { ...dark };
export const spacing = (n) => n * 8;

const ThemeContext = createContext({ colors: dark, mode: "dark", pref: "dark", setMode: () => {} });

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState("dark"); // resolved: "dark" | "light"
  const [pref, setPref] = useState("dark"); // stored preference: "dark" | "light" | "system"
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(PREF_KEY).then((stored) => {
      const initialPref = stored || "dark";
      setPref(initialPref);
      setModeState(resolveMode(initialPref));
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (pref !== "system") return;
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setModeState(colorScheme === "light" ? "light" : "dark");
    });
    return () => sub.remove();
  }, [pref]);

  const setMode = (nextPref) => {
    setPref(nextPref);
    setModeState(resolveMode(nextPref));
    SecureStore.setItemAsync(PREF_KEY, nextPref).catch(() => {});
  };

  const active = PALETTES[mode];

  // Keep the legacy shared `colors` object in sync too, so any screen
  // reading `colors.x` at RENDER time (rather than baked into a
  // module-level StyleSheet at import time) still tracks the mode.
  useEffect(() => {
    Object.assign(colors, active);
  }, [active]);

  const value = useMemo(() => ({ colors: active, mode, pref, setMode }), [active, mode, pref]);

  if (!loaded) return null; // avoid a flash of the wrong theme on cold start

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function resolveMode(pref) {
  if (pref === "system") return Appearance.getColorScheme() === "light" ? "light" : "dark";
  return pref === "light" ? "light" : "dark";
}

/**
 * Use inside a component body — re-renders that component whenever the
 * mode changes. `const { colors } = useTheme();` then build styles from
 * `colors` at render time (inline, or via a `StyleSheet.create` call
 * placed INSIDE the component) rather than a module-level StyleSheet.
 */
export function useTheme() {
  return useContext(ThemeContext);
}
