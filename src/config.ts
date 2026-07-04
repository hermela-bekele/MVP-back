import dotenv from 'dotenv';

dotenv.config();

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing env: ${key}`);
  return v.replace(/^['"]|['"]$/g, '');
}

export const config = {
  port: parseInt(env('PORT', '3004'), 10),
  nodeEnv: env('NODE_ENV', 'development'),
  pg: {
    connectionString: process.env.DATABASE_URL
      ? env('DATABASE_URL')
      : undefined,
    user: env('PG_USER_NAME', 'postgres'),
    password: env('PG_PASSWORD', 'password'),
    host: env('PG_HOST', 'localhost'),
    port: parseInt(env('PG_PORT', '5432'), 10),
    database: env('PG_DATABASE', 'Prime'),
  },
};
