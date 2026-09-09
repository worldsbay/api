import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync('dist', { recursive: true });
