import { readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const srcDir = join(process.cwd(), 'src', 'db');
const destDir = join(process.cwd(), 'dist', 'db');

mkdirSync(destDir, { recursive: true });

for (const file of readdirSync(srcDir)) {
  if (file.endsWith('.sql')) {
    copyFileSync(join(srcDir, file), join(destDir, file));
  }
}
