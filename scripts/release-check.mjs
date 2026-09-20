import { readFileSync } from 'node:fs';

const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
const tauriVersion = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version;
const cargoToml = readFileSync('src-tauri/Cargo.toml', 'utf8');
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

if (!cargoVersion || new Set([packageVersion, tauriVersion, cargoVersion]).size !== 1) {
  console.error(`Version mismatch: package=${packageVersion}, tauri=${tauriVersion}, cargo=${cargoVersion || 'missing'}`);
  process.exit(1);
}

console.log(`Release metadata verified: v${packageVersion}`);
