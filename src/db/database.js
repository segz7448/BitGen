import * as SQLite from "expo-sqlite";

let dbInstance = null;

export async function getDb() {
  if (dbInstance) return dbInstance;
  dbInstance = await SQLite.openDatabaseAsync("bitgen.db");
  await migrate(dbInstance);
  return dbInstance;
}

async function migrate(db) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT UNIQUE NOT NULL,
      derivation_index INTEGER NOT NULL,
      change_type INTEGER NOT NULL DEFAULT 0, -- 0 = receive, 1 = change
      label TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,   -- app-level show/hide flag, NOT on-chain
      is_current INTEGER NOT NULL DEFAULT 0,  -- the one currently shown on Receive screen
      created_at INTEGER NOT NULL,
      balance_sats INTEGER NOT NULL DEFAULT 0,
      asset_id TEXT NOT NULL DEFAULT 'BTC'    -- 'BTC' | 'USDT_TRC20' | 'USDT_ERC20' | 'USDT_BEP20', see wallet/assets.js
    );

    CREATE TABLE IF NOT EXISTS swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT 'changenow',
      provider_exchange_id TEXT UNIQUE NOT NULL,
      from_asset_id TEXT NOT NULL,
      to_asset_id TEXT NOT NULL,
      from_amount TEXT NOT NULL,
      to_amount_estimate TEXT,
      deposit_address TEXT NOT NULL,
      payout_address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS utxos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      txid TEXT NOT NULL,
      vout INTEGER NOT NULL,
      address TEXT NOT NULL,
      value_sats INTEGER NOT NULL,
      confirmed INTEGER NOT NULL DEFAULT 0,
      spent INTEGER NOT NULL DEFAULT 0,
      UNIQUE(txid, vout)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      txid TEXT PRIMARY KEY,
      amount_sats INTEGER NOT NULL,
      fee_sats INTEGER DEFAULT 0,
      direction TEXT NOT NULL, -- 'in' | 'out'
      confirmed INTEGER NOT NULL DEFAULT 0,
      block_height INTEGER,
      timestamp INTEGER,
      counterparty_address TEXT,
      counterparty_label TEXT DEFAULT '',
      raw_json TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS electrum_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      priority INTEGER DEFAULT 0
    );

    -- One row per (event, txid/height) the realtime notifier has already
    -- fired a push for — see src/notifications/notificationService.js.
    -- Without this, every reconnect/poll cycle that re-observes the same
    -- mempool entry or confirmation would re-notify the user for it.
    CREATE TABLE IF NOT EXISTS notified_events (
      event_key TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );

    -- Human-readable log of every notification actually shown, backing
    -- the in-app Notifications screen (bell icon on Home). Separate from
    -- notified_events above, which only tracks dedupe keys, not content.
    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT,
      created_at INTEGER NOT NULL,
      read INTEGER NOT NULL DEFAULT 0
    );

    -- Internal ledger split of the wallet's real on-chain/on-network
    -- balance into two "accounts" per asset, mirroring exchange-style
    -- Funding vs Unified Trading accounts:
    --   funding  -> plain custody, 1:1 with actual coin quantity, never
    --               moves on its own regardless of price
    --   unified  -> the bucket that backs open positions/spot trades
    --               (see wallet/tradingLedger.js and db/tradeRepo.js);
    --               it's a separate allocation the user moves funds into
    -- This table does NOT hold the source of truth for total owned coins
    -- — that's still addresses.balance_sats / on-chain UTXOs / live
    -- ERC20-TRC20-BEP20 lookups, EXCEPT for the synthetic 'USDT' pooled
    -- row (see below), which has no on-chain address of its own.
    --
    -- asset_id 'USDT' (no chain suffix) is a synthetic pooled row: it
    -- reconciles against the SUM of USDT_TRC20 + USDT_ERC20 + USDT_BEP20
    -- live balances, expressed in a fixed 6-decimal "USDT micros" unit
    -- regardless of source chain decimals. It exists only so Unified has
    -- a single tradeable USDT balance instead of three chain-siloed ones.
    -- Real per-chain USDT_* rows still exist independently for Funding/
    -- deposit/withdraw purposes; usdt_chain_ledger below tracks which
    -- chain a pooled-USDT sat in Unified actually maps back to, so a
    -- transfer out of Unified can pay out on a real chain.
    CREATE TABLE IF NOT EXISTS account_balances (
      asset_id TEXT PRIMARY KEY,
      funding_sats INTEGER NOT NULL DEFAULT 0,
      unified_sats INTEGER NOT NULL DEFAULT 0
    );

    -- Per-chain breakdown of how much of the pooled 'USDT' unified
    -- balance is actually backed by each chain variant. Mirrors
    -- account_balances.unified_sats for asset_id='USDT' — the sum of
    -- these three should always equal that value. Needed because
    -- 'unified_to_funding' transfers of pooled USDT must debit real
    -- USDT_TRC20/ERC20/BEP20 funding rows on a specific chain, not an
    -- imaginary chain-less USDT.
    CREATE TABLE IF NOT EXISTS usdt_chain_ledger (
      chain_asset_id TEXT PRIMARY KEY, -- 'USDT_TRC20' | 'USDT_ERC20' | 'USDT_BEP20'
      unified_micros INTEGER NOT NULL DEFAULT 0
    );

    -- Audit trail of internal Funding <-> Unified transfers. No on-chain
    -- tx, no fee — purely a ledger move, but still recorded so
    -- TransactionHistoryScreen (or a future dedicated view) can show it.
    CREATE TABLE IF NOT EXISTS internal_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL,
      direction TEXT NOT NULL, -- 'funding_to_unified' | 'unified_to_funding'
      amount_sats INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Spot fills executed inside the Unified account: BTC <-> pooled
    -- USDT, priced off the live ticker at execution time (paper trading
    -- — no real exchange, no real order book). side 'buy' spends USDT to
    -- gain BTC, 'sell' spends BTC to gain USDT, both within Unified only;
    -- Funding is never touched by a trade. Kept append-only as the
    -- source of truth for realized P&L and trade history; the current
    -- unified_sats balances are the running total these fills produce.
    --
    -- Columns are named generically (base/quote) rather than btc/usdt so
    -- this table can host other spot pairs later without a migration.
    -- leverage/margin_sats/liquidation_price are NULL for spot fills and
    -- reserved for the future leveraged-positions feature, which will
    -- reuse this table rather than fork a new one.
    -- Real on-chain DEX swap history (1inch Swap API). Kept fully
    -- separate from the 'trades' table below, which is the BTC/USDT
    -- PAPER trading ledger — this table records actual signed/broadcast
    -- transactions with real gas and real slippage, never a simulated
    -- fill. tx_hash is the source of truth; status starts 'pending'
    -- and is updated once the receipt confirms.
    -- Tron "limit orders" — see src/dex/tronLimitWatcher.js for the
    -- full explanation. There is no mature Tron equivalent of 1inch's
    -- Limit Order Protocol, so these are NOT true resting on-chain
    -- orders: no funds are locked, nothing exists on-chain until it
    -- fires, and it ONLY fires if this app is running and polling when
    -- the price condition is met. That's a materially weaker guarantee
    -- than dex_limit_orders (EVM) and the UI must say so.
    CREATE TABLE IF NOT EXISTS tron_watch_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_symbol TEXT NOT NULL,
      to_symbol TEXT NOT NULL,
      human_amount_in TEXT NOT NULL,
      target_price REAL NOT NULL,        -- to_symbol per 1 from_symbol
      direction TEXT NOT NULL,           -- 'above' | 'below' — fire when live price crosses this relative to target
      slippage_percent REAL NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'watching', -- 'watching' | 'filled' | 'cancelled' | 'failed'
      executed_tx_hash TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dex_swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain TEXT NOT NULL,                 -- 'ethereum' | 'bsc'
      src_symbol TEXT NOT NULL,
      dst_symbol TEXT NOT NULL,
      src_amount_base_units TEXT NOT NULL, -- string, exact base units (no float precision loss)
      dst_amount_estimate_base_units TEXT,
      dst_amount_actual_base_units TEXT,
      slippage_percent REAL NOT NULL,
      tx_hash TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'confirmed' | 'failed'
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Real on-chain limit orders (1inch Limit Order Protocol v4).
    -- Off-chain signed, resting on 1inch's orderbook until a resolver
    -- fills it (fully, partially, or never — it can also expire).
    -- order_hash is the LOP-computed hash, used to look up status.
    CREATE TABLE IF NOT EXISTS dex_limit_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain TEXT NOT NULL,
      order_hash TEXT UNIQUE NOT NULL,
      maker_symbol TEXT NOT NULL,          -- what you're giving up
      taker_symbol TEXT NOT NULL,          -- what you're receiving
      making_amount_base_units TEXT NOT NULL,
      taking_amount_base_units TEXT NOT NULL,
      limit_price REAL NOT NULL,           -- taker per 1 maker, for display only
      expiry_at INTEGER,                   -- unix seconds, NULL = no expiry
      status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'filled' | 'partially_filled' | 'cancelled' | 'expired'
      cancel_tx_hash TEXT,
      raw_order_json TEXT NOT NULL,        -- full signed order payload, needed to cancel or resubmit
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_asset_id TEXT NOT NULL DEFAULT 'BTC',
      quote_asset_id TEXT NOT NULL DEFAULT 'USDT',
      side TEXT NOT NULL,              -- 'buy' | 'sell' (buy = acquire base, sell = dispose base)
      base_sats INTEGER NOT NULL,      -- amount of base asset filled, in its base unit (sats for BTC)
      quote_micros INTEGER NOT NULL,   -- amount of quote asset filled, in USDT micros (1e-6)
      price REAL NOT NULL,             -- quote per 1 base at execution time, e.g. USDT per BTC
      leverage REAL,                   -- NULL for spot; reserved for future leveraged positions
      created_at INTEGER NOT NULL
    );
  `);

  // Retrofit asset_id onto addresses tables created before multi-asset
  // support existed. CREATE TABLE IF NOT EXISTS above won't add the column
  // to an already-existing table, so try the ALTER and swallow the error
  // if it's already there.
  try {
    await db.execAsync(`ALTER TABLE addresses ADD COLUMN asset_id TEXT NOT NULL DEFAULT 'BTC';`);
  } catch (e) {
    // column already exists — fine
  }

  // Seed default Esplora endpoints on first run if empty.
  const row = await db.getFirstAsync(`SELECT COUNT(*) as c FROM electrum_servers`);
  if (row.c === 0) {
    await db.execAsync(`
      INSERT INTO electrum_servers (url, priority) VALUES
        ('https://blockstream.info/api', 0),
        ('https://mempool.space/api', 1);
    `);
  }
}

export async function resetDatabase() {
  const db = await getDb();
  await db.execAsync(`
    DELETE FROM addresses;
    DELETE FROM utxos;
    DELETE FROM transactions;
    DELETE FROM settings;
    DELETE FROM notified_events;
    DELETE FROM account_balances;
    DELETE FROM internal_transfers;
    DELETE FROM usdt_chain_ledger;
    DELETE FROM trades;
    DELETE FROM dex_swaps;
    DELETE FROM dex_limit_orders;
    DELETE FROM tron_watch_orders;
  `);
}
