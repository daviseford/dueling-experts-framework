import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Only run in a git checkout (not when installed from npm registry)
if (!existsSync(resolve(root, '.git'))) process.exit(0);

console.log('[def] Dev setup: installing UI dependencies and building...');
execSync('npm install', { cwd: resolve(root, 'src', 'ui'), stdio: 'inherit' });
execSync('npm run build', { cwd: resolve(root, 'src', 'ui'), stdio: 'inherit' });
