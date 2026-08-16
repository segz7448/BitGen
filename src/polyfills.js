// Must be imported FIRST, before any bitcoinjs-lib / bip32 / bip39 code runs.
// React Native has no native crypto.getRandomValues or Buffer global — these
// libraries assume a Node-like environment, so we polyfill it.
import "react-native-get-random-values";
import { Buffer } from "buffer";

if (typeof global.Buffer === "undefined") {
  global.Buffer = Buffer;
}
