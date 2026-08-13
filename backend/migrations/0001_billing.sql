CREATE TABLE IF NOT EXISTS wallets (
  wallet_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  recovery_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  ledger_id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL,
  reference_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(kind, reference_id)
);
CREATE TABLE IF NOT EXISTS plan_reservations (
  reservation_id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  status TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  completed_at TEXT,
  result_json TEXT
);
CREATE TABLE IF NOT EXISTS paddle_events (
  event_id TEXT PRIMARY KEY,
  transaction_id TEXT UNIQUE,
  wallet_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vouchers (
  code_hash TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  expires_at TEXT,
  max_redemptions INTEGER NOT NULL,
  redeemed_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS voucher_redemptions (
  code_hash TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(code_hash, wallet_id)
);
CREATE INDEX IF NOT EXISTS idx_reservations_expiry ON plan_reservations(status, expires_at);
