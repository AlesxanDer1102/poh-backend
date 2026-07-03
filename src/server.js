import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { config, chainConfigured } from './config.js';
import { initDb, dbReady } from './db/pool.js';
import { humanityRouter } from './routes/humanity.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    chainConfigured: chainConfigured(),
    dbReady: dbReady(),
    env: config.env,
  });
});

app.use('/api', humanityRouter);

app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

async function start() {
  await initDb();
  app.listen(config.port, () => {
    console.log(`[poh-backend] listening on http://localhost:${config.port}`);
    console.log(`[poh-backend] chain configured: ${chainConfigured()} | db ready: ${dbReady()}`);
  });
}

start();

export { app };
