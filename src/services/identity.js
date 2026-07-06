import { pool, dbReady } from '../db/pool.js';
import { config } from '../config.js';

/**
 * Off-chain biometric uniqueness registry.
 *
 * This is where "one human, one proof — regardless of wallet" is actually
 * enforced. A face descriptor is a fuzzy 128-d vector: the same person never
 * produces the exact same values twice, so uniqueness cannot be decided by
 * hash equality. Instead we compare an incoming descriptor against every
 * registered descriptor by Euclidean distance (the same metric face-api.js
 * uses) and treat anything under `faceMatchThreshold` as the same human.
 */

/** Euclidean distance between two equal-length numeric vectors. */
export function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Search the registry for a human whose face matches `descriptor` within the
 * match threshold.
 *
 * @returns {Promise<{ match: { address: string, humanityHash: string, distance: number } | null,
 *                     nearestDistance: number | null }>}
 *          `match` is the closest human under the threshold (null if this face
 *          is new). `nearestDistance` is the minimum distance to any registered
 *          human (null when the registry is empty) — recorded as a metric.
 */
export async function findExistingHuman(descriptor) {
  if (!dbReady()) return { match: null, nearestDistance: null };

  const { rows } = await pool.query('SELECT user_address, humanity_hash, descriptor FROM humans');

  let match = null;
  let nearestDistance = null;

  for (const row of rows) {
    const distance = euclideanDistance(descriptor, row.descriptor);
    if (nearestDistance === null || distance < nearestDistance) nearestDistance = distance;

    if (distance < config.faceMatchThreshold && (!match || distance < match.distance)) {
      match = { address: row.user_address, humanityHash: row.humanity_hash, distance };
    }
  }

  return { match, nearestDistance };
}

/** Persist a newly registered human's biometric template. */
export async function registerHuman({ address, humanityHash, descriptor }) {
  if (!dbReady()) return;
  await pool.query(
    `INSERT INTO humans (user_address, humanity_hash, descriptor)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_address) DO NOTHING`,
    [address, humanityHash, JSON.stringify(descriptor)],
  );
}
