import { config } from '../config.js';

/**
 * Off-chain biometric validation.
 *
 * The heavy face-recognition + liveness computation runs in the FRONTEND (face-api.js /
 * MediaPipe) and the resulting face descriptor + liveness outcome are sent here. This
 * service applies the trust checks the backend is responsible for:
 *   - liveness must have passed (anti-spoofing),
 *   - the face descriptor distance must be under the configured threshold.
 *
 * @param {object} input
 * @param {number[]} input.faceDescriptor  128-d descriptor from face-api.js
 * @param {boolean}  input.livenessPassed  liveness challenge result from the frontend
 * @param {number}   [input.faceDistance]  optional precomputed distance to a reference
 * @returns {{ ok: boolean, faceDistance: number, reason?: string }}
 */
export function validateBiometrics({ faceDescriptor, livenessPassed, faceDistance }) {
  if (!livenessPassed) {
    return { ok: false, faceDistance: 1, reason: 'liveness_failed' };
  }
  if (!Array.isArray(faceDescriptor) || faceDescriptor.length !== 128) {
    return { ok: false, faceDistance: 1, reason: 'invalid_descriptor' };
  }

  // In the full system the distance is compared against a stored reference during
  // re-verification. For first-time registration we accept a provided distance (or 0).
  const distance = typeof faceDistance === 'number' ? faceDistance : 0;
  if (distance > config.faceMatchThreshold) {
    return { ok: false, faceDistance: distance, reason: 'face_mismatch' };
  }

  return { ok: true, faceDistance: distance };
}
