/**
 * يعتمد جهازًا طلب الدخول، برمزه الظاهر على شاشته.
 *
 *   VANTARA_DEVICE_PEPPER=… node tools/approve-device.mjs --code K7Q4-M2XD
 *
 * يعمل من سير العمل «اعتماد جوال» في GitHub (يملك الأسرار) أو من جهاز المالك.
 * لا يطبع أي سر: الرمز نفسه مربوط بالجهاز الذي طلبه ويُستهلك مرة، فظهوره في
 * سجلٍّ عام لا يفتح شيئًا لأحد.
 */

import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';

export function normalizeCode(value) {
  const code = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 8 || [...code].some((c) => !ALPHABET.includes(c))) throw new Error('code_invalid');
  return code;
}

export function codeHash(code, pepper) {
  if (typeof pepper !== 'string' || pepper.length < 16) throw new Error('device_pepper_invalid');
  return createHmac('sha256', pepper).update(`device-code:${normalizeCode(code)}`).digest('hex');
}

export function buildApproveSql(hash, now = Date.now()) {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('hash_invalid');
  return (
    `UPDATE device_requests SET approved_at = ${Number(now)} ` +
    `WHERE code_hash = '${hash}' AND approved_at IS NULL AND consumed_at IS NULL AND expires_at > ${Number(now)};`
  );
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag}_requires_value`);
  return value;
}

export function approveDevice({ args = process.argv.slice(2), env = process.env, now = Date.now(), run = spawnSync } = {}) {
  const code = valueAfter(args, '--code');
  const database = valueAfter(args, '--database') ?? env.D1_NAME ?? 'vantara';
  const sql = buildApproveSql(codeHash(code, env.VANTARA_DEVICE_PEPPER), now);
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = run('npx', ['--yes', 'wrangler@4', 'd1', 'execute', database, '--remote', '--json', '--command', sql], {
    cwd: packageDir,
    env,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`wrangler_failed_${String(result.status)}: ${result.stderr ?? ''}`);
  const out = JSON.parse(result.stdout);
  const changes = Number(out?.[0]?.meta?.changes ?? 0);
  return changes;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const changes = approveDevice();
    if (changes === 1) {
      console.log('✓ اعتُمد الجهاز. التطبيق يدخل وحده خلال ثوانٍ.');
    } else {
      console.log('✗ ما لقينا طلبًا مفتوحًا بهذا الرمز: غلط في الكتابة، أو انتهت مدته (30 دقيقة)، أو اعتُمد قبل.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
