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
  confirmation_ms INTEGER,
  gas_used        BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_validations_user ON validations (user_address);
`;
