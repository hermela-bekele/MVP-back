import { pool } from '../db/pool.js';
import { runBillingJobs } from '../services/jobs.js';

runBillingJobs()
  .then((result) => {
    console.log('[billing-jobs]', result);
    return pool.end();
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[billing-jobs] failed', err);
    pool.end().finally(() => process.exit(1));
  });
