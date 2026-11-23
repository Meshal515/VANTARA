#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ANDROID_KEYSTORE_PATH:?Use the persistent key dedicated to VANTARA Local}"
: "${ANDROID_KEYSTORE_PASSWORD:?Missing Local signing password}"
: "${VANTARA_VERSION_CODE:?Use a build code greater than the installed Local version}"
export ANDROID_KEY_ALIAS="${ANDROID_KEY_ALIAS:-vantara-local}"
export VANTARA_VERSION_NAME="${VANTARA_VERSION_NAME:-0.1.$VANTARA_VERSION_CODE}"
export VANTARA_NATIVE="$(node tools/native-fingerprint.mjs)"
export ORG_GRADLE_PROJECT_vantaraRuntimeDebug=true
corepack pnpm exec cap sync android
node --input-type=module <<'JS'
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const root = 'android/app/src/main/assets/public';
const file = `${root}/lib/config.js`;
const config = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file, config
  .replaceAll('__VANTARA_EDITION__', 'local')
  .replaceAll('__VANTARA_CHANNEL__', 'debug')
  .replaceAll('__VANTARA_VERSION__', process.env.VANTARA_VERSION_NAME));
const worker = `${root}/sw.js`;
const content = fs.readFileSync(worker, 'utf8');
const hash = createHash('sha256');
for (const [, path] of content.matchAll(/^\s*'(\/[^']+)',$/gm)) {
  hash.update(path);
  hash.update(fs.readFileSync(`${root}${path === '/' ? '/index.html' : path}`));
}
fs.writeFileSync(worker, content.replace(/^const SHELL_DIGEST = '[^']+';$/m, `const SHELL_DIGEST = '${hash.digest('hex')}';`));
JS
cd android
./gradlew --no-daemon -PvantaraLocal=true :app:assembleDebug
