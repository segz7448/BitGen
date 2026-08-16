import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import * as Crypto from "expo-crypto";

const PIN_HASH_KEY = "bitgen_pin_hash_v1";

async function hashPin(pin) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin);
}

export async function hasPin() {
  return !!(await SecureStore.getItemAsync(PIN_HASH_KEY));
}

export async function setPin(pin) {
  const hash = await hashPin(pin);
  await SecureStore.setItemAsync(PIN_HASH_KEY, hash);
}

export async function verifyPin(pin) {
  const stored = await SecureStore.getItemAsync(PIN_HASH_KEY);
  if (!stored) return false;
  const hash = await hashPin(pin);
  return hash === stored;
}

export async function clearPin() {
  await SecureStore.deleteItemAsync(PIN_HASH_KEY);
}

export async function biometricAvailable() {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return hasHardware && enrolled;
}

export async function biometricAuth() {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock BITGEN",
    cancelLabel: "Use PIN instead",
    disableDeviceFallback: false,
  });
  return result.success;
}
