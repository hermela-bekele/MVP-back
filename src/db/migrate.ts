import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  for (const file of ['schema.sql', 'schema_portal.sql', 'schema_community.sql', 'schema_hr.sql']) {
    const schemaPath = path.join(__dirname, file);
    const sql = fs.readFileSync(schemaPath, 'utf-8');
    await pool.query(sql);
    console.log(`Applied ${file}`);
  }
  console.log('Database schema applied successfully.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
