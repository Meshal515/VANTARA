import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopUpdateFromManifest } from '../apps/web/desktop/update-check.js';

/** Validate an existing stable manifest before adding another platform to it. */
export function validateStableManifest(manifest, { apk, web, desktop } = {}) {
  if (manifest?.format !== 2 || !/^\d+\.\d+\.\d+$/.test(manifest.versionName ?? '') ||
      !Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < 1 ||
      !/^[a-f0-9]{24}$/.test(manifest.native ?? '') ||
      !Number.isSafeInteger(manifest.minimumSupportedVersionCode ?? 0) ||
      (manifest.minimumSupportedVersionCode ?? 0) < 0 ||
      (manifest.minimumSupportedVersionCode ?? 0) > manifest.versionCode) throw new Error('Invalid stable manifest');
  const base = `https://github.com/Meshal515/VANTARA/releases/download/stable-${manifest.versionCode}`;
  for (const [platform, name, local] of [['apk', 'VANTARA-stable.apk', apk], ['web', 'VANTARA-web.zip', web]]) {
    const entry = manifest[platform];
    if (entry?.url !== `${base}/${name}` || !/^[a-f0-9]{64}$/i.test(entry?.sha256 ?? '') ||
        !Number.isSafeInteger(entry?.size) || entry.size < 1) throw new Error(`Invalid ${platform} artifact`);
    if (local && (!statSync(local).isFile() || statSync(local).size !== entry.size ||
        createHash('sha256').update(readFileSync(local)).digest('hex') !== entry.sha256.toLowerCase())) throw new Error(`${platform} integrity mismatch`);
  }
  if (manifest.desktop) {
    if (!desktopUpdateFromManifest(manifest, '0.0.0-preview.0')) throw new Error('Invalid desktop artifact');
    if (desktop && (statSync(desktop).size !== manifest.desktop.size ||
        createHash('sha256').update(readFileSync(desktop)).digest('hex') !== manifest.desktop.sha256.toLowerCase())) throw new Error('desktop integrity mismatch');
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifest, apk, web, desktop] = process.argv.slice(2);
  validateStableManifest(JSON.parse(readFileSync(manifest, 'utf8')), { apk, web, desktop });
  console.log('Verified stable APK/web manifest and artifact integrity');
}
