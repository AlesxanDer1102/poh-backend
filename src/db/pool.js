import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({ connectionString: config.db.url });

let ready = false;

/** Attempt to connect and create tables. Never throws — logs and marks DB unavailable. */
export async function initDb() {
  try {
    await pool.query(SCHEMA);
    ready = true;
    console.log('[db] connected and schema ready');
  } catch (err) {
    ready = false;
    console.warn(`[db] unavailable (${err.code ?? err.message}) — metrics will not be persisted`);
  }
  return ready;
}

export const dbReady = () => ready;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS validations (
  id              BIGSERIAL PRIMARY KEY,
  user_address    TEXT        NOT NULL,
  humanity_hash   TEXT        NOT NULL,
  tx_hash         TEXT,
  verified        BOOLEAN     NOT NULL DEFAULT false,
  liveness_passed BOOLEAN     NOT NULL DEFAULT false,
  face_distance   NUMERIC,
  validation_ms   INTEGER,
  matching_ms     INTEGER,
  registry_size   INTEGER,
  confirmation_ms INTEGER,
  gas_used        BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_validations_user ON validations (user_address);

-- Backfill columns on databases created before these metrics existed.
ALTER TABLE validations ADD COLUMN IF NOT EXISTS matching_ms   INTEGER;
ALTER TABLE validations ADD COLUMN IF NOT EXISTS registry_size INTEGER;

-- Biometric registry: the off-chain source of truth for human uniqueness.
-- One row per registered human. Sybil resistance (one human, one proof —
-- regardless of wallet) is enforced by comparing an incoming face descriptor
-- against every stored descriptor by Euclidean distance.
CREATE TABLE IF NOT EXISTS humans (
  id            BIGSERIAL PRIMARY KEY,
  user_address  TEXT        NOT NULL UNIQUE,
  humanity_hash TEXT        NOT NULL,
  descriptor    JSONB       NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
