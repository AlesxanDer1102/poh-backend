import { Router } from 'express';
import { ethers } from 'ethers';
import { validateBiometrics } from '../services/biometrics.js';
import { findExistingHuman, registerHuman } from '../services/identity.js';
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

  // 2. Biometric uniqueness — enforce "one human, one proof" regardless of wallet.
  //    A matching descriptor means this person is already registered, so we reject
  //    BEFORE spending any gas. This is the system's off-chain Sybil resistance.
  //    This is an O(N) descriptor scan and the real cost of off-chain validation,
  //    so it is timed separately from the trivial trust-check above. `registrySize`
  //    is the N scanned, letting Track 1 plot matching time against registry growth.
  const tMatch = Date.now();
  const { match, nearestDistance, registrySize } = await findExistingHuman(faceDescriptor);
  const matchingMs = Date.now() - tMatch;
  if (match) {
    const sameWallet = match.address.toLowerCase() === address.toLowerCase();
    await recordValidation({
      address,
      humanityHash: '',
      verified: false,
      livenessPassed: true,
      faceDistance: nearestDistance,
      validationMs,
      matchingMs,
      registrySize,
    });
    return res.status(409).json({
      error: sameWallet ? 'already_registered' : 'duplicate_human',
      reason: sameWallet
        ? 'This person is already registered with this wallet.'
        : 'This person is already registered under a different wallet. One human can hold only one proof.',
      faceDistance: nearestDistance,
      ...(sameWallet ? {} : { boundAddress: match.address }),
    });
  }

  // 3. Derive humanity hash.
  const humanityHash = deriveHumanityHash(address, faceDescriptor);

  // 4. Register on-chain (if configured).
  if (!chainConfigured()) {
    await registerHuman({ address, humanityHash, descriptor: faceDescriptor });
    return res.status(200).json({
      address,
      humanityHash,
      onChain: false,
      note: 'chain_not_configured — validation passed but proof not registered on-chain',
      metrics: { validationMs, matchingMs, registrySize, faceDistance: nearestDistance },
    });
  }

  try {
    const { txHash, gasUsed, confirmationMs } = await registerProof(address, humanityHash);

    // Commit the human to the registry only after the on-chain proof succeeds.
    await registerHuman({ address, humanityHash, descriptor: faceDescriptor });

    await recordValidation({
      address,
      humanityHash,
      txHash,
      verified: true,
      livenessPassed: true,
      faceDistance: nearestDistance,
      validationMs,
      matchingMs,
      registrySize,
      confirmationMs,
      gasUsed,
    });

    return res.status(201).json({
      address,
      humanityHash,
      onChain: true,
      txHash,
      metrics: { validationMs, matchingMs, registrySize, confirmationMs, gasUsed, faceDistance: nearestDistance },
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
      COUNT(*) FILTER (WHERE NOT verified AND liveness_passed) AS rejected_duplicates,
      (SELECT COUNT(*) FROM humans)     AS unique_humans,
      ROUND(AVG(validation_ms))         AS avg_validation_ms,
      ROUND(AVG(matching_ms))           AS avg_matching_ms,
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
        (user_address, humanity_hash, tx_hash, verified, liveness_passed, face_distance, validation_ms, matching_ms, registry_size, confirmation_ms, gas_used)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        v.address,
        v.humanityHash,
        v.txHash ?? null,
        v.verified,
        v.livenessPassed,
        v.faceDistance ?? null,
        v.validationMs ?? null,
        v.matchingMs ?? null,
        v.registrySize ?? null,
        v.confirmationMs ?? null,
        v.gasUsed ?? null,
      ],
    );
  } catch (err) {
    console.warn(`[db] failed to record validation: ${err.message}`);
  }
}
