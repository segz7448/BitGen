# BITGEN

A fully non-custodial, on-device Bitcoin wallet. No backend, no server you run,
no account. Your seed phrase never leaves the device.

## Features

- **Non-custodial HD wallet** — BIP84 native SegWit, seed never leaves the device
- **Multiple addresses, all live** — generate/switch addresses freely; disabling one only hides it from the picker, it stays watched and spendable
- **App lock** — PIN + biometric, re-locks on backgrounding
- **Transaction history** — full in/out list synced from Esplora, with labels for sent-to addresses
- **RBF fee bumping** — every send is replaceable by default; bump a stuck tx's fee from the History screen
- **Input validation** — address format, dust threshold, balance checks before any tx is built
- **Gap-limit address scan** — importing a seed or backup walks derivation indices (20-unused-in-a-row cutoff) to recover full address history, not just the first few
- **Unconfirmed-UTXO-aware coin selection** — spends confirmed funds by default, only falls back to unconfirmed with an explicit on-screen warning
- **Fiat display** — BTC balance shown alongside USD via CoinGecko's public API
- **BIP39 passphrase support** — optional 25th word, threaded through derivation and signing
- **Watch-only mode** — import a zpub with no private key on the device, monitoring-only
- **Encrypted backup export/import** — AES-256 password-protected seed backup as a shareable file, independent of biometrics/PIN

## Architecture

```
[HD Wallet Core]  bitcoinjs-lib + bip32 + bip39 — key derivation, tx signing
       |
[SQLite]           addresses, utxos, tx cache, settings (expo-sqlite)
       |
[SecureStore]       seed phrase, Android Keystore-backed (expo-secure-store)
       |
[Esplora REST API]  balance/UTXO lookups + broadcast (public: blockstream.info, mempool.space)
```

- Derivation: BIP84 (native SegWit, `bc1...` addresses), path `m/84'/0'/0'/<change>/<index>`
- Every generated address stays valid and watched forever. "Disabling" an
  address in the Addresses screen only hides it from the Receive picker —
  BITGEN keeps syncing its balance, and Bitcoin itself has no concept of a
  disabled address.
- The only network calls are outbound HTTPS to a public Esplora-compatible
  API for balance checks and broadcast. Swap `electrum_servers` rows in
  `src/db/database.js` for a self-hosted Esplora/Electrs instance later if
  you want to stop leaking address queries to a third party.

## Project structure

```
src/
  wallet/       hdWallet.js (key derivation), txBuilder.js (sign/build tx),
                secureSeed.js (SecureStore wrapper), sync.js (chain sync)
  db/           database.js (schema), addressRepo.js (address CRUD + active flag)
  network/      esplora.js (REST client with server fallback)
  screens/      all UI screens
  navigation/   RootNavigator.js
```

## Building (matches your existing workflow: Termux push → GitHub Actions build)

1. From Termux: `git add . && git commit -m "..." && git push`
2. GitHub Actions (`.github/workflows/build-android.yml`) runs automatically on push to `main`:
   - `expo prebuild` generates the native `android/` project
   - Gradle builds `app-release-unsigned.apk`
   - Download the artifact from the Actions run

### Important: signing

The workflow currently produces an **unsigned** release APK — Android won't
install it as-is. You have two options:

- **Quick path**: change the Gradle task to `assembleDebug` instead of
  `assembleRelease` in the workflow — debug APKs are auto-signed with a
  debug key and install directly, fine for personal use/testing.
- **Proper path**: generate a release keystore, add it as GitHub Secrets
  (`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`), and
  add a signing step to the workflow before `assembleRelease`. Ask me and
  I'll wire this up — it's a few added steps.

## Known limitations / next steps

- Coin selection is largest-first, not optimal (no branch-and-bound) — fine
  for personal use, revisit if UTXO fragmentation becomes an issue
- CPFP (Child-Pays-For-Parent) fee bumping isn't implemented — only RBF.
  RBF requires the original tx to have signaled replaceability (BITGEN
  always does this for outgoing sends), so this covers the common case.
- No CoinJoin/PayJoin — addresses avoid *reuse* by default (fresh address
  per receive), but on-chain analysis can still cluster your addresses via
  common-input-ownership heuristics. This is inherent to Bitcoin, not an app
  limitation.
- App-lock PIN is a soft lock at the JS/navigation layer, not full-device
  encryption — someone with USB debugging access and a rooted device could
  still reach the SecureStore-backed Keystore in theory. This matches the
  security model of most mobile wallets; the seed itself is still
  Keystore-encrypted at rest either way.
- Currently mainnet only (`NETWORK` in `hdWallet.js`) — switch to
  `bitcoin.networks.testnet` for testing with faucet coins before using
  real funds
- Watch-only wallets don't yet support importing/scanning an already-used
  zpub with a gap-limit scan (only the first address is derived) — worth
  adding if you plan to actually use watch-only day to day
