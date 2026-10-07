#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

function changelog() {
  const log = execFileSync(
    'git',
    ['log', '--first-parent', '-8', '--format=%s'],
    { cwd: ROOT },
  ).toString();
  return log.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8);
}

const a = args(process.argv.slice(2));
for (const required of ['out', 'version', 'code', 'native', 'base', 'apk', 'web']) {
  if (!a[required]) throw new Error(`missing --${required}`);
}
if (!/^[0-9a-f]{24}$/.test(a.native)) throw new Error(`bad native fingerprint: ${a.native}`);

const manifest = {
  format: 2,
  channel: 'debug-cinema-petrol-teal',
  versionName: a.version,
  versionCode: Number(a.code),
  native: a.native,
  minimumSupportedVersionCode: 0,
  changelog: changelog(),
  apk: {
    url: `${a.base}/VANTARA-debug.apk`,
    sha256: sha256(a.apk),
    size: statSync(a.apk).size,
  },
  web: {
    url: `${a.base}/VANTARA-debug-web.zip`,
    sha256: sha256(a.web),
    size: statSync(a.web).size,
  },
  nativeApi: 2,
  notes: 'قناة Debug خاصة — لا تؤثر على Stable.',
};

writeFileSync(a.out, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
