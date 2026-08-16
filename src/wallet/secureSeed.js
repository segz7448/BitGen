import * as SecureStore from "expo-secure-store";

const SEED_KEY = "bitgen_mnemonic_v1";
const PASSPHRASE_KEY = "bitgen_passphrase_v1";

// expo-secure-store on Android is backed by the Android Keystore + EncryptedSharedPreferences.
// The mnemonic NEVER touches SQLite, AsyncStorage, or any plain-text file.

export async function saveMnemonic(mnemonic) {
  await SecureStore.setItemAsync(SEED_KEY, mnemonic.trim(), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

export async function loadMnemonic() {
  return SecureStore.getItemAsync(SEED_KEY);
}

export async function hasMnemonic() {
  const m = await loadMnemonic();
  return !!m;
}

export async function deleteMnemonic() {
  await SecureStore.deleteItemAsync(SEED_KEY);
  await SecureStore.deleteItemAsync(PASSPHRASE_KEY);
}

// Optional BIP39 passphrase ("25th word") for a hidden wallet — advanced users only.
export async function savePassphrase(passphrase) {
  await SecureStore.setItemAsync(PASSPHRASE_KEY, passphrase);
}

export async function loadPassphrase() {
  return (await SecureStore.getItemAsync(PASSPHRASE_KEY)) || "";
}
