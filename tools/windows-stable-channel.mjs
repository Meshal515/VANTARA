/** Promote only a completed, validated unified Windows release. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStableManifest } from './release-manifest-validation.mjs';
import { newerVersion } from '../apps/web/desktop/update-check.js';

export function windowsStableChannel(next, previous = null) {
  validateStableManifest(next);
  if (!next.desktop) throw new Error('Windows installer is not published');
  if (previous?.format === 2) {
    validateStableManifest(previous);
    if (previous.versionCode > next.versionCode) throw new Error('Refusing channel rollback');
    if (previous.versionCode === next.versionCode && (previous.desktop?.sha256 !== next.desktop.sha256 || previous.desktop?.url !== next.desktop.url)) throw new Error('Published Windows release is immutable');
  } else if (previous) {
    if (previous.format !== 1 || previous.product !== 'VANTARA' || !previous.version) throw new Error('Unknown previous Windows channel');
    if (!newerVersion(next.versionName, previous.version)) throw new Error('Migration must also advance legacy semantic versions');
  }
  return next;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, prior, output] = process.argv.slice(2);
  writeFileSync(output, JSON.stringify(windowsStableChannel(JSON.parse(readFileSync(input,'utf8')), prior === '-' ? null : JSON.parse(readFileSync(prior,'utf8'))), null, 2)+'\n');
}
