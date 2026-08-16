// Must be imported FIRST, before any bitcoinjs-lib / bip32 / bip39 code runs.
// React Native has no native crypto.getRandomValues or Buffer global — these
// libraries assume a Node-like environment, so we polyfill it.
import "react-native-get-random-values";
import { Buffer } from "buffer";
import process from "process";

if (typeof global.Buffer === "undefined") {
  global.Buffer = Buffer;
}

// React Native's built-in `global.process` shim has no `.version`, but
// readable-stream (a dependency of stream-browserify, used by
// bitcoinjs-lib/bip32) reads `process.version.slice(1)` at MODULE LOAD
// TIME to pick its implementation. That throws
// "Cannot read property 'slice' of undefined" immediately on app start,
// before anything even renders. Replace the whole process object with the
// full browserify polyfill, which defines process.version as '' (empty
// string) — so `.slice()` never throws, and version-check guards like
// `if (process.version)` correctly evaluate falsy and skip.
global.process = process;

