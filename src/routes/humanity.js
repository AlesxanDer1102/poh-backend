import { Router } from 'express';
import { ethers } from 'ethers';
import { validateBiometrics } from '../services/biometrics.js';
import {
  deriveHumanityHash,
  registerProof,
  isHuman,
  getProof,
  chainConfigured,
} from '../services/blockchain.js';
import { pool, dbReady } from '../db/pool.js';

export const humanityRouter = Router();

/**
 * POST /api/validate
 * Body: { address, faceDescriptor: number[128], livenessPassed: boolean, faceDistance?: number }
 * Runs off-chain validation, registers the proof on-chain, and records metrics.
 */
humanityRouter.post('/validate', async (req, res) => {
  const { address, faceDescriptor, livenessPassed, faceDistance } = req.body ?? {};

  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: 'invalid_address' });
  }

  // 1. Off-chain biometric validation (timed).
  const t0 = Date.now();
  const bio = validateBiometrics({ faceDescriptor, livenessPassed, faceDistance });
  const validationMs = Date.now() - t0;

  if (!bio.ok) {
    await recordValidation({
      address,
      humanityHash: '',
      verified: false,
      livenessPassed: Boolean(livenessPassed),
      faceDistance: bio.faceDistance,
      validationMs,
    });
    return res.status(422).json({ error: 'validation_failed', reason: bio.reason });
  }

  // 2. Derive humanity hash.
  const humanityHash = deriveHumanityHash(address, faceDescriptor);

  // 3. Register on-chain (if configured).
  if (!chainConfigured()) {
    return res.status(200).json({
      address,
      humanityHash,
      onChain: false,
      note: 'chain_not_configured — validation passed but proof not registered on-chain',
      metrics: { validationMs },
    });
  }

  try {
    const { txHash, gasUsed, confirmationMs } = await registerProof(address, humanityHash);

    await recordValidation({
      address,
      humanityHash,
      txHash,
      verified: true,
      livenessPassed: true,
      faceDistance: bio.faceDistance,
      validationMs,
      confirmationMs,
      gasUsed,
    });

    return res.status(201).json({
      address,
      humanityHash,
      onChain: true,
      txHash,
      metrics: { validationMs, confirmationMs, gasUsed },
    });
  } catch (err) {
    const reason = err.reason ?? err.shortMessage ?? err.message;
    return res.status(502).json({ error: 'onchain_register_failed', reason });
  }
});

/** GET /api/verify/:address — current verification status + proof. */
humanityRouter.get('/verify/:address', async (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: 'invalid_address' });
  }
  if (!chainConfigured()) {
    return res.status(503).json({ error: 'chain_not_configured' });
  }
  try {
    const verified = await isHuman(address);
    const proof = verified ? await getProof(address) : null;
    return res.json({ address, verified, proof });
  } catch (err) {
    return res.status(502).json({ error: 'onchain_read_failed', reason: err.message });
  }
});

/** GET /api/metrics — aggregate metrics for the thesis "Resultados" chapter. */
humanityRouter.get('/metrics', async (_req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'db_unavailable' });
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)                          AS total,
      COUNT(*) FILTER (WHERE verified)  AS verified,
      ROUND(AVG(validation_ms))         AS avg_validation_ms,
      ROUND(AVG(confirmation_ms))       AS avg_confirmation_ms,
      ROUND(AVG(gas_used))              AS avg_gas_used
    FROM validations
  `);
  return res.json(rows[0]);
});

async function recordValidation(v) {
  if (!dbReady()) return;
  try {
    await pool.query(
      `INSERT INTO validations
        (user_address, humanity_hash, tx_hash, verified, liveness_passed, face_distance, validation_ms, confirmation_ms, gas_used)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        v.address,
        v.humanityHash,
        v.txHash ?? null,
        v.verified,
        v.livenessPassed,
        v.faceDistance ?? null,
        v.validationMs ?? null,
        v.confirmationMs ?? null,
        v.gasUsed ?? null,
      ],
    );
  } catch (err) {
    console.warn(`[db] failed to record validation: ${err.message}`);
  }
}
