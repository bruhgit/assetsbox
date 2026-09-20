import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const files = [
  'src/tauriBridge.js',
  'src/renderer.js',
  ...readdirSync('src/modules', { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => `src/modules/${entry.name}`),
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', resolve(file)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
