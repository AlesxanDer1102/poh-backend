/**
 * Track 1 — synthetic system-performance collection.
 *
 * Fires N sequential registrations against POST /api/validate, each with a FRESH
 * random address and a distinct random 128-d descriptor. Measures the metrics that
 * do NOT depend on a real face: off-chain validation time, on-chain confirmation
 * time and gas. Writes a self-contained CSV (the authoritative Track 1 dataset) and
 * prints aggregate statistics.
 *
 * Design notes:
 *  - Sequential, never parallel: all txs come from the same validator wallet, so
 *    concurrent requests would collide on the nonce.
 *  - Fresh address per run: gas for a first-time write (zero -> non-zero storage) is
 *    what production sees; re-writing a used slot would understate it.
 *  - The first run is flagged as a cold start and excluded from the aggregates.
 *
 * Usage:  node scripts/collect-track1.mjs [N]        (default N = 40)
 *         API_URL=http://host:port node scripts/collect-track1.mjs 50
 */
import { ethers } from 'ethers';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const N = Number(process.argv[2] ?? 40);

const randomDescriptor = () => Array.from({ length: 128 }, () => Math.random() * 2 - 1);

async function validateOne(address, descriptor) {
  const t = Date.now();
  const res = await fetch(`${API_URL}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, faceDescriptor: descriptor, livenessPassed: true, faceDistance: 0 }),
  });
  const clientMs = Date.now() - t;
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, clientMs, data };
}

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return null;
  const n = v.length;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const sorted = [...v].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { n, mean, sd, median, min: sorted[0], max: sorted[n - 1] };
}

console.log(`Track 1 — synthetic performance collection`);
console.log(`API: ${API_URL} | runs: ${N}\n`);

try {
  const h = await (await fetch(`${API_URL}/health`)).json();
  if (!h.chainConfigured) {
    console.error('Backend has no chain configured — there would be no gas/confirmation metrics. Aborting.');
    process.exit(1);
  }
  console.log(`Backend healthy (chain=${h.chainConfigured}, db=${h.dbReady})\n`);
} catch {
  console.error(`Cannot reach backend at ${API_URL}. Is it running?`);
  process.exit(1);
}

const rows = [];
for (let i = 0; i < N; i++) {
  const address = ethers.Wallet.createRandom().address;
  const coldStart = i === 0;
  try {
    const r = await validateOne(address, randomDescriptor());
    const m = r.data.metrics ?? {};
    rows.push({
      index: i,
      coldStart,
      address,
      status: r.status,
      ok: r.ok,
      validationMs: m.validationMs ?? '',
      confirmationMs: m.confirmationMs ?? '',
      gasUsed: m.gasUsed ?? '',
      faceDistance: m.faceDistance ?? '',
      clientMs: r.clientMs,
      txHash: r.data.txHash ?? '',
      error: r.ok ? '' : `${r.data.error ?? ''}${r.data.reason ? ': ' + r.data.reason : ''}`,
    });
    console.log(
      `[${i + 1}/${N}]${coldStart ? ' (cold)' : ''} ${r.ok ? 'OK  ' : 'FAIL ' + r.status} ` +
        `gas=${m.gasUsed ?? '-'} conf=${m.confirmationMs ?? '-'}ms val=${m.validationMs ?? '-'}ms ` +
        (r.ok ? '' : `-> ${r.data.error ?? ''} ${r.data.reason ?? ''}`),
    );
  } catch (err) {
    rows.push({ index: i, coldStart, address, status: 0, ok: false, error: err.message });
    console.log(`[${i + 1}/${N}] ERROR ${err.message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', 'data');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const csvPath = join(outDir, `track1-performance-${stamp}.csv`);

const cols = [
  'index', 'coldStart', 'address', 'status', 'ok',
  'validationMs', 'confirmationMs', 'gasUsed', 'faceDistance', 'clientMs', 'txHash', 'error',
];
const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? '')).join(','))].join('\n');
writeFileSync(csvPath, csv);

const warm = rows.filter((r) => r.ok && !r.coldStart);
console.log(`\n=== Aggregates (n=${warm.length}, excluding cold start & failures) ===`);
for (const key of ['validationMs', 'confirmationMs', 'gasUsed']) {
  const s = stats(warm.map((r) => Number(r[key])));
  if (s) {
    console.log(
      `${key.padEnd(15)} mean=${s.mean.toFixed(1)}  sd=${s.sd.toFixed(1)}  ` +
        `median=${s.median}  min=${s.min}  max=${s.max}`,
    );
  }
}
const cold = rows.find((r) => r.coldStart && r.ok);
if (cold) {
  console.log(`cold start     val=${cold.validationMs}ms  conf=${cold.confirmationMs}ms  gas=${cold.gasUsed}`);
}
const failed = rows.filter((r) => !r.ok).length;
console.log(`\nSuccess: ${rows.length - failed}/${rows.length}  |  CSV: ${csvPath}`);
if (failed) console.log('Some runs failed — check the "error" column (e.g. validator wallet out of Sepolia ETH).');
console.log(
  '\nNOTE: these synthetic registrations now sit in the DB (humans + validations).\n' +
    'The CSV above is your authoritative Track 1 dataset. Before running Track 2 with real\n' +
    'participants, reset the tables so /api/metrics reflects only real humans:\n' +
    "  docker exec poh-db psql -U poh -d poh -c 'TRUNCATE validations, humans;'",
);
