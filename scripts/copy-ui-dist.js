import { cpSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = resolve(root, 'src', 'ui', 'dist');
const dest = resolve(root, 'dist', 'ui', 'dist');
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('[def] Copied UI dist to dist/ui/dist/');
