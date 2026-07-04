import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const pool = config.pg.connectionString
  ? new Pool({
      connectionString: config.pg.connectionString,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      user: config.pg.user,
      password: config.pg.password,
      host: config.pg.host,
      port: config.pg.port,
      database: config.pg.database,
    });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
) {
  return pool.query<T>(text, params);
}
