import express from 'express';
import cors from 'cors';
import http from 'http';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { ensurePortalAuthSchema } from './db/ensureSchema.js';
import { apiRouter } from './routes/api.js';
import { uploadsDir } from './lib/uploads.js';
import { runBillingJobs } from './services/jobs.js';
import { initCommunityRealtime } from './lib/communityRealtime.js';

const app = express();
const server = http.createServer(app);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadsDir));

app.use('/api', apiRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL connected.');
    await ensurePortalAuthSchema();
    console.log('Portal auth schema verified.');
  } catch (err) {
    console.error('PostgreSQL connection failed:', err);
    console.error(
      config.pg.connectionString
        ? 'Check DATABASE_URL and run: npm run db:setup'
        : 'Run: npm run db:setup (from backend/) after creating database "Prime"'
    );
    process.exit(1);
  }

  initCommunityRealtime(server);

  // Billing automation: reminders, unpaid admission expiry, late fees, monthly invoices
  const JOB_MS = 60 * 60 * 1000;
  setInterval(() => {
    runBillingJobs()
      .then((r) => console.log('[billing-jobs]', r))
      .catch((err) => console.error('[billing-jobs] failed', err));
  }, JOB_MS);
  setTimeout(() => {
    runBillingJobs().catch((err) => console.error('[billing-jobs] startup failed', err));
  }, 15_000);

  server.listen(config.port, () => {
    console.log(`PRIME EduAI API listening on http://localhost:${config.port}`);
  });
}

start();
