import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { ensurePortalAuthSchema, ensureRegistrationFormsSchema, ensureAcademicResultsSchema, ensureTeacherStaffingSchema } from './db/ensureSchema.js';
import { apiRouter } from './routes/api.js';
import { uploadsDir } from './lib/uploads.js';
import { initCommunityRealtime } from './lib/communityRealtime.js';

const app = express();
const server = http.createServer(app);

// CORS_ORIGINS is a comma-separated allowlist (e.g. "https://app.example.com,https://www.example.com").
// In production it must be set explicitly — no wildcard fallback. In dev it defaults to common localhost ports.
const configuredOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (config.nodeEnv === 'production' && configuredOrigins.length === 0) {
  throw new Error('CORS_ORIGINS must be set in production (comma-separated list of allowed origins).');
}

const allowedOrigins =
  configuredOrigins.length > 0
    ? configuredOrigins
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser requests (no Origin header, e.g. server-to-server, curl).
      callback(null, !origin || allowedOrigins.includes(origin));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadsDir));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error', error: (err as Error).message });
  }
});

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
    await ensureRegistrationFormsSchema();
    await ensureAcademicResultsSchema();
    await ensureTeacherStaffingSchema();
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

  // Billing automation (reminders, unpaid admission expiry, late fees, monthly invoices)
  // no longer runs in-process: an in-process interval would duplicate itself once this
  // service scales beyond one instance. Run it via `npm run jobs:billing` on a schedule
  // instead (Render Cron Jobs, or any external scheduler) — see src/scripts/runBillingJobs.ts.

  server.listen(config.port, () => {
    console.log(`PRIME EduAI API listening on http://localhost:${config.port}`);
  });
}

start();
