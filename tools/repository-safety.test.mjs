import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

/**
 * B4 — تجميد ملكية البيانات.
 *
 * الجدول المتقاعد موجود فيزيائيًا حتى يُسقطه باتش الـmigrations، فلا شيء يمنع
 * كودًا جديدًا من الكتابة فيه وإعادة خلق مالك ثانٍ بهدوء. هذا الحرس يقرأ قائمة
 * المتقاعد من `packages/domain/src/ownership.ts` نفسها — لا نسخة ثانية منها —
 * ويفشل عند أول إشارة SQL إليها.
 */

/**
 * الاستثناءات المعلنة — ملفّا طبقة الهوية وحدهما.
 *
 * تهيئة الجلسة تُدرج صفّ بروفايل وبوابة فارغين، و`/v1/auth/accounts` يقرأ
 * البروفايل لقائمة حسابات لا يستهلكها العميل (المستهلك الحقيقي هو `/v1/accounts`
 * عند الـWorker). الملفان قيد إعادة بناء في باتش الهوية الموحدة، فتعديلهما من
 * هنا تعارض مقصود ممنوع. مسجّل كـhandoff، ولا يجوز أن تطول هذه القائمة.
 */
const RETIRED_TABLE_EXCEPTIONS = Object.freeze({
  'apps/api/src/lib/sessions.ts': ['vantara_profiles', 'vantara_user_gates'],
  'apps/api/src/routes/auth.ts': ['vantara_profiles'],
});

function retiredTablesFromMatrix() {
  const source = read('packages/domain/src/ownership.ts');
  const tables = new Set();
  // retired: { POSTGRES: ['a', 'b'] }
  for (const block of source.matchAll(/retired:\s*\{([^}]*)\}/g)) {
    for (const name of block[1].matchAll(/'([a-z0-9_]+)'/g)) tables.add(name[1]);
  }
  return [...tables];
}

/**
 * يسقط التعليقات قبل الفحص.
 *
 * الحرس يفحص الكود لا النثر: تعليق يقول «لا FCM ولا Firebase» هو تمامًا ما
 * نريده مكتوبًا، وكان يُسقط الفحص على نفسه.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/^\s*--[^\n]*/gm, ' ')
    .replace(/^\s*<!--[\s\S]*?-->/gm, ' ');
}

function sqlReferences(source, table) {
  // الكتابة والقراءة معًا: قراءة جدول متقاعد مسار حقيقة ثانية أيضًا
  const pattern = new RegExp(
    String.raw`(INSERT\s+INTO|UPDATE|DELETE\s+FROM|FROM|JOIN)\s+${table}\b`,
    'i',
  );
  return pattern.test(source);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function trackedFiles() {
  const output = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).trim();
  return output ? output.split('\n') : [];
}

function isForbiddenEnv(path) {
  const base = path.split('/').at(-1) ?? '';
  return base.startsWith('.env') && !base.endsWith('.example');
}

function assertCiGatedProductionWorkflow(path) {
  const workflow = read(path);
  assert.match(workflow, /workflow_run\s*:/m, `${path} must be triggered by completed CI, not directly by a branch push`);
  assert.match(workflow, /workflows:\s*\[['"]VANTARA CI['"]\]/m, `${path} must depend on the VANTARA CI workflow`);
  assert.match(workflow, /types:\s*\[completed\]/m, `${path} must wait for CI completion`);
  assert.match(workflow, /workflow_run\.conclusion\s*==\s*['"]success['"]/m, `${path} must require successful CI`);
  assert.match(workflow, /workflow_run\.head_branch\s*==\s*['"]main['"]/m, `${path} must only deploy a main CI run`);
  assert.match(workflow, /workflow_run\.head_sha/m, `${path} must deploy the exact commit that CI tested`);
  assert.doesNotMatch(workflow, /^\s*push\s*:/m, `${path} must not deploy directly on push`);
  assert.doesNotMatch(workflow, /workflow_dispatch\s*:/m, `${path} must not allow a feature-branch copy to be manually dispatched with production secrets`);
}

function assertCommitHasSuccessfulCi(workflow, commitExpression, label) {
  assert.match(workflow, /gh run list --workflow ['"]VANTARA CI['"]/m, `${label} must inspect VANTARA CI runs before privileged release work`);
  assert.match(workflow, new RegExp(`--commit ['"]?${commitExpression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?`), `${label} must verify CI for the exact commit being released`);
  assert.match(workflow, /select\(\.conclusion == ['"]success['"]\)/m, `${label} must require a successful CI conclusion`);
}

test('tracked repository contains no local env files or Python caches', () => {
  const tracked = trackedFiles();
  const forbidden = tracked.filter(
    (path) => isForbiddenEnv(path) || /(^|\/)__pycache__(\/|$)/.test(path) || /\.py[co]$/.test(path),
  );
  assert.deepEqual(forbidden, [], `forbidden tracked files:\n${forbidden.join('\n')}`);
});

test('root ignore rules prevent local env and Python cache files from returning', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /^\.env$/m, 'root .gitignore must ignore .env');
  assert.match(ignore, /^\.env\.\*$/m, 'root .gitignore must ignore .env.* variants');
  assert.match(ignore, /^!\.env\.example$/m, 'root .gitignore must keep .env.example trackable');
  assert.match(ignore, /^\*\.py\[cod\]$/m, 'root .gitignore must ignore compiled Python files');
  assert.match(ignore, /^\*\*\/__pycache__\/$/m, 'root .gitignore must ignore Python cache directories');
});

test('sync worker production deploy is CI-gated and main-only', () => {
  assertCiGatedProductionWorkflow('.github/workflows/sync-worker.yml');
});

test('Cloudflare Pages production deploy is CI-gated and main-only', () => {
  const workflow = read('.github/workflows/cloudflare-pages.yml');
  assertCiGatedProductionWorkflow('.github/workflows/cloudflare-pages.yml');
  assert.match(workflow, /^\s*CF_PRODUCTION_BRANCH:\s*main\s*$/m, 'Pages production branch must be explicit');
  assert.match(workflow, /--branch="\$CF_PRODUCTION_BRANCH"/m, 'Pages deploy must always identify the production branch explicitly');
  assert.doesNotMatch(workflow, /GITHUB_REF_NAME[^\n]*CF_PRODUCTION_BRANCH|branch="\$\{GITHUB_REF_NAME\}"/m, 'Pages deploy must not derive its deployment branch from an arbitrary pushed branch');
  assert.match(workflow, /^\s*actions:\s*read\s*$/m, 'Pages release verification needs read access to Actions results');
  assertCommitHasSuccessfulCi(workflow, '$MAIN_SHA', 'Pages release path');
});

test('no code writes or reads a retired table', () => {
  const retired = retiredTablesFromMatrix();
  assert.ok(
    retired.length >= 8,
    `ownership matrix parse failed — expected the retired Postgres tables, got ${JSON.stringify(retired)}`,
  );

  const sources = trackedFiles().filter(
    (path) =>
      /^(apps|services|packages|tools|infra)\//.test(path) &&
      /\.(ts|mts|mjs|js|sql)$/.test(path) &&
      // مخطط PostgreSQL ينشئ الجداول، والمصفوفة تسمّيها، والحرس نفسه يذكرها
      !path.startsWith('packages/db/migrations/') &&
      path !== 'packages/domain/src/ownership.ts' &&
      path !== 'tools/repository-safety.test.mjs',
  );

  const offenders = [];
  for (const path of sources) {
    const source = read(path);
    for (const table of retired) {
      if (!sqlReferences(source, table)) continue;
      if ((RETIRED_TABLE_EXCEPTIONS[path] ?? []).includes(table)) continue;
      offenders.push(`${path} → ${table}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `retired tables must have no live SQL path:\n${offenders.join('\n')}`,
  );
});

test('the ownership document matches the executable matrix', () => {
  // الوثيقة تتعفّن بهدوء إذا لم يُقارنها شيء بالكود. المصفوفة هي الحقيقة،
  // والوثيقة شرحها — فاختلافهما خطأ، وليس مسألة تحديث لاحق.
  const code = read('packages/domain/src/ownership.ts');
  const inCode = new Map();
  for (const entry of code.matchAll(
    /key:\s*'([a-z0-9_.]+)',\s*\n\s*owner:\s*'([A-Z0-9]+)',\s*\n\s*mirrors:\s*\[([^\]]*)\]/g,
  )) {
    const mirrors = [...entry[3].matchAll(/'([A-Z0-9]+)'/g)].map((m) => m[1]);
    inCode.set(entry[1], { owner: entry[2], mirrors });
  }
  assert.ok(inCode.size >= 15, `matrix parse failed — found ${inCode.size} domains`);

  const doc = read('docs/VANTARA_DATA_OWNERSHIP.md');
  const inDoc = new Map();
  for (const row of doc.matchAll(/^\|\s*`([a-z0-9_.]+)`\s*\|\s*([A-Z0-9]+)\s*\|\s*([^|]*)\|/gm)) {
    const mirrors = row[3].trim() === '—' ? [] : row[3].trim().split(/[,\s]+/).filter(Boolean);
    inDoc.set(row[1], { owner: row[2], mirrors });
  }

  assert.deepEqual(
    [...inDoc.keys()].sort(),
    [...inCode.keys()].sort(),
    'the document and the matrix must list the same data domains',
  );
  for (const [key, spec] of inCode) {
    assert.deepEqual(inDoc.get(key), spec, `ownership of ${key} differs between doc and code`);
  }
});

test('the client and the domain agree on the notification kinds', () => {
  // الواجهة JS خالص بلا bundler فلا تستورد حزمة المجال، فقائمة الأنواع مكرّرة.
  // التكرار مقبول إن كان مكشوفًا: نوع يُضاف في مكان وينسى في الآخر يعني إشعارًا
  // لا يستطيع المستخدم إطفاؤه، أو مفتاحًا لا يتحكم بشيء.
  const domain = read('packages/domain/src/notifications.ts');
  const block = domain.match(/export const NOTIFICATION_KINDS = \[([^\]]*)\]/);
  assert.ok(block, 'could not find NOTIFICATION_KINDS in the domain');
  const inDomain = [...block[1].matchAll(/'([A-Z_]+)'/g)].map((entry) => entry[1]).sort();
  assert.ok(inDomain.length >= 4, `domain kinds parse failed: ${JSON.stringify(inDomain)}`);

  const client = read('apps/web/lib/notifications.js');
  const labels = client.match(/export const NOTIFICATION_LABELS = \{([^}]*)\}/);
  assert.ok(labels, 'could not find NOTIFICATION_LABELS in the client');
  const inClient = [...labels[1].matchAll(/([A-Z_]+):/g)].map((entry) => entry[1]).sort();

  assert.deepEqual(inClient, inDomain, 'notification kinds differ between the client and the domain');
});

test('nothing reaches for an operating-system push channel', () => {
  // B9 صريح: لا Firebase ولا FCM ولا إذن إشعارات ولا تنبيه والتطبيق مغلق.
  // الحرس على المستودع لا على الوثيقة: إضافة SDK لاحقًا تُسقط CI لا تمرّ بهدوء.
  const forbidden = /firebase|firebase-messaging|\bFCM\b|onesignal|Notification\.requestPermission|new Notification\(|showNotification\(|PushManager|pushManager/i;
  const offenders = trackedFiles()
    .filter(
      (path) =>
        /^(apps|services|packages|android|tools)\//.test(path) &&
        /\.(ts|tsx|mts|mjs|js|json|gradle|xml|kt|java)$/.test(path) &&
        path !== 'tools/repository-safety.test.mjs',
    )
    .filter((path) => forbidden.test(stripComments(read(path))));

  assert.deepEqual(offenders, [], `in-app notifications only:\n${offenders.join('\n')}`);
});

test('every failure scenario has a status and deferred ones say what they need', () => {
  // مصفوفة الفشل تفقد قيمتها إذا احتوت صفًّا بلا حالة أو تأجيلًا بلا سبب:
  // «سنغطيه لاحقًا» ليس تغطية ولا تأجيلًا معلنًا.
  const doc = read('docs/VANTARA_FAILURE_MATRIX.md');
  const rows = [...doc.matchAll(/^\|\s*(\d+)\s*\|([^|]+)\|\s*`(COVERED|DEFERRED)`\s*\|([^|]*)\|/gm)];
  assert.ok(rows.length >= 15, `failure matrix parse failed — found ${rows.length} rows`);

  const malformed = [...doc.matchAll(/^\|\s*(\d+)\s*\|([^|]+)\|\s*([^|`]+)\|/gm)].map(
    (row) => row[1],
  );
  assert.deepEqual(malformed, [], `every scenario needs a COVERED/DEFERRED status: ${malformed}`);

  for (const [, number, , status, evidence] of rows) {
    assert.ok(
      evidence.trim().length > 20,
      `scenario ${number} (${status}) needs real evidence, not a placeholder`,
    );
    if (status === 'DEFERRED') {
      assert.match(
        evidence,
        /يحتاج|ملك|مكتوب/,
        `deferred scenario ${number} must say what it needs or who owns it`,
      );
    }
  }
});

test('the retired-table exception list stays at the declared identity handoff', () => {
  assert.deepEqual(
    Object.keys(RETIRED_TABLE_EXCEPTIONS).sort(),
    ['apps/api/src/lib/sessions.ts', 'apps/api/src/routes/auth.ts'],
    'a new exception means a second owner came back — declare it in the office first',
  );

  // التهيئة إدراج فقط: لا منطق يقرأ البوابة من المخزن المتقاعد
  const sessions = read('apps/api/src/lib/sessions.ts');
  assert.match(sessions, /INSERT INTO vantara_user_gates/);
  assert.doesNotMatch(sessions, /(SELECT[^;]*FROM|UPDATE|DELETE\s+FROM)\s+vantara_user_gates/i);

  // ولا يكتب مسار الحسابات في المتقاعد، يقرأ فقط
  const auth = read('apps/api/src/routes/auth.ts');
  assert.doesNotMatch(auth, /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+vantara_profiles/i);
});

test('signed Android release workflow is tag-only, main-only, and CI-verified', () => {
  const workflow = read('.github/workflows/android-release.yml');
  assert.match(workflow, /push:\s*\n\s+tags:\s*\n\s+- ['"]v\*['"]/m, 'Android release must be tag-triggered');
  assert.doesNotMatch(workflow, /workflow_dispatch\s*:/m, 'signed release must not be manually dispatchable from a feature branch');
  assert.match(workflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/m, 'release must prove its tagged commit belongs to main before reading signing secrets');
  assert.match(workflow, /^\s*actions:\s*read\s*$/m, 'Android release verification needs read access to Actions results');
  assertCommitHasSuccessfulCi(workflow, '$GITHUB_SHA', 'Android release path');
});
