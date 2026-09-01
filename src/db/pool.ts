import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

// Cap the pool so N backend instances never exceed the Postgres plan's
// connection limit (N instances * POOL_MAX must stay under that ceiling).
const POOL_MAX = parseInt(process.env.PG_POOL_MAX || '20', 10);

// Render's Postgres cert isn't in Node's default CA store, so full chain
// validation is off by default. If DATABASE_URL ever points at a database
// reachable over the public internet (not Render's private network), set
// PGSSL_REJECT_UNAUTHORIZED=true and supply the provider's CA via PGSSL_CA.
const sslRejectUnauthorized = process.env.PGSSL_REJECT_UNAUTHORIZED === 'true';
const sslCa = process.env.PGSSL_CA;

export const pool = config.pg.connectionString
  ? new Pool({
      connectionString: config.pg.connectionString,
      ssl: {
        rejectUnauthorized: sslRejectUnauthorized,
        ca: sslCa,
      },
      max: POOL_MAX,
    })
  : new Pool({
      user: config.pg.user,
      password: config.pg.password,
      host: config.pg.host,
      port: config.pg.port,
      database: config.pg.database,
      max: POOL_MAX,
    });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
) {
  return pool.query<T>(text, params);
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}
