import { initDb, pool } from './pool.js';

const ok = await initDb();
await pool.end();
process.exit(ok ? 0 : 1);
