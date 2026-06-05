import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { apiRouter } from './routes/api.js';

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

app.use('/api', apiRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL connected.');
  } catch (err) {
    console.error('PostgreSQL connection failed:', err);
    console.error('Run: npm run db:setup (from backend/) after creating database "Prime"');
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`Prime API listening on http://localhost:${config.port}`);
  });
}

start();
