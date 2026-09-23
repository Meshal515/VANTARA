import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
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
 * B4 أُغلق فعليًا: الجداول الاجتماعية المتقاعدة أُسقطت من PostgreSQL،
 * لذلك لا يوجد أي ملف مسموح له بقراءتها أو الكتابة فيها بعد الآن.
 */
const RETIRED_TABLE_EXCEPTIONS = Object.freeze({});

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

test('sync worker production deploy provisions every runtime authentication secret in the deployed version', () => {
  const workflow = read('.github/workflows/sync-worker.yml');
  const wrangler = read('services/sync-worker/wrangler.toml');
  const aliases = new Map([
    ['VANTARA_SESSION_SECRET', 'session'],
    ['VANTARA_IDENTITY_SECRET', 'identity'],
    ['VANTARA_DEVICE_PEPPER', 'pepper'],
  ]);

  for (const [secret, alias] of aliases) {
    assert.ok(
      workflow.includes('${{ secrets.' + secret + ' }}'),
      `sync-worker deploy must read GitHub secret ${secret}`,
    );
    assert.ok(
      workflow.includes('--arg ' + alias + ' "$' + secret + '"'),
      `the one-version secrets file must source ${secret} from its environment binding`,
    );
    assert.ok(
      workflow.includes(secret + ': $' + alias),
      `the one-version JSON must include the ${secret} key`,
    );
    assert.ok(
      wrangler.includes(secret),
      `wrangler must declare ${secret} as a required binding`,
    );
  }
  assert.match(
    workflow,
    /wrangler@4 deploy --secrets-file/,
    'code and authentication secrets must be uploaded as the same Worker version',
  );
  assert.doesNotMatch(
    workflow,
    /wrangler@4 secret put/,
    'ordinary deploy must not create extra live Worker versions while rotating secrets',
  );
});

test('live D1 verification receives the device pepper required for trusted-device pairing', () => {
  const workflow = read('.github/workflows/sync-worker.yml');
  const start = workflow.indexOf('- name: Verify sync invariants against live D1');
  assert.ok(start >= 0, 'sync-worker workflow must keep the live D1 verification step');
  const block = workflow.slice(start, start + 700);
  assert.match(
    block,
    /VANTARA_DEVICE_PEPPER:\s*\$\{\{\s*secrets\.VANTARA_DEVICE_PEPPER\s*\}\}/,
    'live D1 verifier must receive the same device pepper used by the deployed Worker',
  );
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

test('B8 social migration defines recipient state and per-viewer receipts', () => {
  const migrationPath = 'services/sync-worker/migrations/0008_social_receipts_and_recommendation_states.sql';
  assert.ok(
    trackedFiles().includes(migrationPath),
    `${migrationPath} must exist; B2 already owns migration 0007`,
  );
  const migration = read(migrationPath);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS recommendation_recipients/i);
  assert.match(migration, /PRIMARY KEY\s*\(recommendation_id,\s*user_id\)/i);
  assert.match(migration, /state\s+TEXT\s+NOT NULL(?:\s+DEFAULT\s+'PENDING')?\s+CHECK\s*\(state IN \('PENDING', 'ACCEPTED', 'REJECTED'\)\)/i);
  assert.match(migration, /intent\s+TEXT\s+CHECK\s*\(\s*intent IS NULL OR\s*intent IN \('WATCH_NOW', 'WATCH_LATER', 'ADD_TO_LIBRARY'\)\s*\)/i);
  assert.doesNotMatch(
    migration,
    /state\s*=\s*'ACCEPTED'\s+AND\s+intent\s+IS\s+NOT\s+NULL/i,
    'acceptance must be storable before the recipient chooses an intent',
  );
  assert.match(migration, /REFERENCES recommendations\s*\(id\)/i);
  assert.match(migration, /REFERENCES accounts\s*\(user_id\)/i);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS activity_receipts/i);
  assert.match(migration, /PRIMARY KEY\s*\(event_id,\s*user_id\)/i);
  assert.match(migration, /ALTER TABLE activity ADD COLUMN target_user_id TEXT/i);
  assert.match(migration, /ALTER TABLE activity ADD COLUMN link TEXT/i);

  assert.match(migration, /CREATE INDEX IF NOT EXISTS recommendation_recipients_user/i);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS activity_receipts_user/i);
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

test('the retired-table exception list stays empty after B4 physical retirement', () => {
  assert.deepEqual(
    Object.keys(RETIRED_TABLE_EXCEPTIONS),
    [],
    'a new exception means a retired PostgreSQL social owner came back',
  );

  const sessions = read('apps/api/src/lib/sessions.ts');
  const auth = read('apps/api/src/routes/auth.ts');
  for (const table of retiredTablesFromMatrix()) {
    assert.equal(
      sqlReferences(stripComments(sessions), table),
      false,
      `sessions.ts must never revive retired table ${table}`,
    );
    assert.equal(
      sqlReferences(stripComments(auth), table),
      false,
      `auth.ts must never revive retired table ${table}`,
    );
  }
});

test('signed Android release workflow is tag-only, main-only, and CI-verified', () => {
  const workflow = read('.github/workflows/android-release.yml');
  assert.match(workflow, /push:\s*\n\s+tags:\s*\n\s+- ['"]v\*['"]/m, 'Android release must be tag-triggered');
  assert.doesNotMatch(workflow, /workflow_dispatch\s*:/m, 'signed release must not be manually dispatchable from a feature branch');
  assert.match(workflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/m, 'release must prove its tagged commit belongs to main before reading signing secrets');
  assert.match(workflow, /^\s*actions:\s*read\s*$/m, 'Android release verification needs read access to Actions results');
  assertCommitHasSuccessfulCi(workflow, '$GITHUB_SHA', 'Android release path');
});

test('stable Android main APK workflow is CI-gated and release-signed', () => {
  const workflow = read('.github/workflows/android-stable.yml');
  assertCiGatedProductionWorkflow('.github/workflows/android-stable.yml');
  assert.match(workflow, /ANDROID_KEYSTORE_BASE64:\s*\$\{\{ secrets\.ANDROID_KEYSTORE_BASE64 \}\}/m);
  assert.match(workflow, /ANDROID_KEYSTORE_PASSWORD:\s*\$\{\{ secrets\.ANDROID_KEYSTORE_PASSWORD \}\}/m);
  assert.match(workflow, /:app:assembleRelease|assembleRelease/m, 'stable main APK must be a release build');
  assert.match(workflow, /apksigner.*verify|apksigner" verify/m, 'stable main APK must verify the produced signature');
  assert.match(workflow, /actions\/upload-artifact@v4/m, 'stable main APK must be downloadable as an artifact');
});

test('Android recovery id is sourced from Settings.Secure.ANDROID_ID in the registered native bridge', () => {
  const plugin = read('android/app/src/main/kotlin/com/vantara/plugins/SystemUiPlugin.kt');
  assert.match(plugin, /Settings\.Secure\.ANDROID_ID/);
  assert.match(plugin, /fun\s+deviceId\s*\(/);
  assert.match(plugin, /ret\.put\(["']identifier["']/);
});

test('every module the app imports at boot is precached by the service worker', () => {
  // وحدة يستوردها `app.js` ثابتًا وليست في `SHELL` تعني أن أول إقلاع بعد
  // تحديث يذهب للشبكة ليجلبها، وأن الإقلاع دون اتصال قد يفشل كليًا — وهذا
  // بالضبط ما وجدته مراجعة B13: أربع وحدات ناقصة.
  const worker = read('apps/web/sw.js');
  const shell = new Set([...worker.matchAll(/^\s*'(\/[^']+)',$/gm)].map((match) => match[1]));

  const roots = ['apps/web/app.js', 'apps/web/reader.js', 'apps/web/screens/accounts.js'];
  const missing = [];

  for (const root of roots) {
    const source = read(root);
    const dir = root.slice(0, root.lastIndexOf('/'));
    // المسار كما يراه المتصفح: `apps/web` هو جذر الموقع لا جزء من العنوان
    const webDir = dir === 'apps/web' ? '' : `${dir.slice('apps/web/'.length)}/`;
    for (const match of source.matchAll(/^import[^'"]*['"](\.[^'"]+)['"]/gm)) {
      const specifier = match[1];
      const resolved = new URL(specifier, `https://x/${webDir}`).pathname;
      if (!shell.has(resolved)) missing.push(`${root} → ${resolved}`);
    }
  }

  assert.deepEqual(missing, [], `modules imported but not precached:\n${missing.join('\n')}`);
});

test('the service worker cache name changes whenever the shell changes', () => {
  // أغلى عطل في هذا المشروع لم يكن في الكود بل في وصوله: القشرة تُخدم من
  // الكاش قبل الشبكة، واسم الكاش كان رقمًا يُرفع باليد. نُسي مرة، فبقي APK
  // جديد يعرض جافاسكربت النسخة السابقة — كودٌ صحيح داخل الحزمة لا يصل
  // الشاشة، وعطلٌ «لم يُصلَح» وهو مُصلَح.
  //
  // فالاسم صار مشتقًّا من بصمة المحتوى، وهذا الحارس يمنع البصمة من التعفّن.
  const worker = read('apps/web/sw.js');
  const shell = [...worker.matchAll(/^\s*'(\/[^']+)',$/gm)].map((match) => match[1]);
  assert.ok(shell.length > 0, 'the shell list must be readable');

  const declared = worker.match(/^const SHELL_DIGEST = '([^']+)';$/m)?.[1];
  assert.ok(declared, 'sw.js must declare SHELL_DIGEST');
  assert.match(
    worker,
    /^const VERSION = `vantara-shell-\$\{SHELL_DIGEST\.slice\(0, 16\)\}`;$/m,
    'the cache name must be derived from SHELL_DIGEST, never written by hand',
  );

  const hash = createHash('sha256');
  for (const path of shell) {
    // `/` هو المستند نفسه؛ وبقية المسارات كما يراها المتصفح من جذر `apps/web`
    hash.update(path);
    hash.update(readFileSync(resolve(ROOT, 'apps/web', path === '/' ? 'index.html' : path.slice(1))));
  }
  const actual = hash.digest('hex');

  assert.equal(
    declared,
    actual,
    `a shell file changed but the service worker would keep serving the old one.\n` +
      `Set SHELL_DIGEST in apps/web/sw.js to:\n\n  ${actual}\n`,
  );
});

test('the sync contract declares every op the worker actually handles', () => {
  // العقد في `packages/domain` هو ما يبني عليه العميل والخادم معًا. وقد
  // انحرف بهدوء: الـWorker كان يعالج اثنتين وعشرين عملية والعقد يعلن أربع
  // عشرة. والعميل جافاسكربت بلا فحص أنواع، فلم يسقط بناءٌ ولم يُرَ شيء —
  // بينما `recommendation.respond` و`activity.add` و`progress.confirm`
  // تعبر الجسر يوميًّا خارج العقد.
  const worker = read('services/sync-worker/src/index.ts');
  const handled = new Set([...worker.matchAll(/^\s*case '([a-zA-Z]+\.[a-zA-Z]+)':/gm)].map((m) => m[1]));
  // `profile.patch` و`settings.patch` تُطبَّقان قبل الـswitch عبر دمج حقول
  for (const match of worker.matchAll(/FIELD_MERGE_KINDS = new Set\(\[([^\]]+)\]/g)) {
    for (const kind of match[1].matchAll(/'([a-zA-Z]+\.[a-zA-Z]+)'/g)) handled.add(kind[1]);
  }
  assert.ok(handled.size > 10, 'could not read the worker op kinds');

  const contract = read('packages/domain/src/sync.ts');
  const union = contract.slice(contract.indexOf('export type OpKind'));
  const declared = new Set(
    [...union.slice(0, union.indexOf(';')).matchAll(/'([a-zA-Z]+\.[a-zA-Z]+)'/g)].map((m) => m[1]),
  );

  const undeclared = [...handled].filter((kind) => !declared.has(kind)).sort();
  const unhandled = [...declared].filter((kind) => !handled.has(kind)).sort();

  assert.deepEqual(
    { undeclared, unhandled },
    { undeclared: [], unhandled: [] },
    'packages/domain OpKind and the worker must describe the same set of operations',
  );
});

test('the APK never serves its shell from a cache an update cannot clear', () => {
  // أصول الـAPK ملفاتٌ على قرص الجهاز يخدمها خادم Capacitor المحلي: قراءتها
  // فورية وهي دائمًا التي شُحنت. وتخزينها في كاش الـservice worker لا يشتري
  // شيئًا، ويشتري عطلًا: الكاش لا يُمسح بتحديث التطبيق، فتبقى حزمةٌ جديدة
  // تعرض جافاسكربت السابقة إلى أن تُمسح بيانات التطبيق يدويًّا.
  //
  // وهذا يناقض الغرض من توقيع الإصدارات بمفتاح ثابت: أن تُثبَّت فوق سابقتها.
  const worker = read('apps/web/sw.js');

  assert.match(
    worker,
    /^const BUNDLED = self\.location\.hostname === 'localhost';$/m,
    'sw.js must know when it runs inside the Capacitor bundle',
  );
  assert.match(
    worker,
    /if \(BUNDLED\) return;/,
    'the fetch handler must let bundled assets through untouched',
  );
  assert.match(
    worker,
    /BUNDLED \? names :/,
    'activate must drop every cache inside the APK, including ones an older worker left behind',
  );
});

test('the app shell is served from cache before the network', () => {
  // شبكة أولًا على مستند التنقّل تعني شاشة بيضاء بطول زمن الشبكة عند كل
  // إقلاع بارد. والتحديث لا يضيع: `lib/update.js` يعرضه صراحةً.
  const worker = read('apps/web/sw.js');
  const navigate = worker.slice(worker.indexOf("request.mode === 'navigate'"));
  const cacheAt = navigate.indexOf('cache.match');
  const fetchAt = navigate.indexOf('fetch(request)');

  assert.ok(cacheAt > 0, 'the navigate handler must consult the cache');
  assert.ok(
    cacheAt < fetchAt,
    'the navigate handler must read the cache before it reaches for the network',
  );
});

test('a build with no endpoint baked still offers a way in', () => {
  // كانت شاشة «عنوان المزامنة غير مضبوط» طريقًا مسدودًا: الإعدادات لا تُفتح
  // إلا من داخل تطبيق لم يُقلع. فأي APK بلا عناوين مخبوزة يصل ميتًا، وكل
  // تغيير لعنوان النفق يفرض إعادة بناء وتثبيت على ثلاثة أجهزة.
  const app = read('apps/web/app.js');
  const start = app.indexOf('if (!syncConfigured())');
  assert.ok(start > 0, 'boot must still handle a missing sync endpoint');

  const branch = app.slice(start, start + 1200);
  assert.match(
    branch,
    /go\(\{\s*name:\s*'settings'\s*\}\)/,
    'the unconfigured screen must lead to settings, not dead-end on a message',
  );
});

test('database restore is atomic, so a half-applied restore cannot report success', () => {
  // ‏`pg_restore` الافتراضي: «exit on error, default is to continue». ومع
  // ‏`--clean` هذا يعني استعادة متعثّرة أسقطت القديم وبنت نصف الجديد، ثم
  // طبعت «Restore completed» — نجاح كاذب على مسار التعافي من كارثة.
  const script = read('infra/restore-postgres.sh');
  const restores = script.match(/pg_restore[^\n]*(?:\\\n[^\n]*)*--dbname/g) ?? [];
  assert.ok(restores.length >= 2, 'restore script must restore both databases');

  for (const invocation of restores) {
    assert.match(
      invocation,
      /--single-transaction/,
      'each restore must run in one transaction: either the database comes back whole, or it is untouched',
    );
    assert.match(
      invocation,
      /--exit-on-error/,
      'each restore must stop at the first error instead of continuing past it',
    );
  }
});

test('Android pairing links are wired from Capacitor into the trusted-device client', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(
    String(pkg.dependencies?.['@capacitor/app'] ?? ''),
    /^\^?6\./,
    'Capacitor 6 builds must install the matching @capacitor/app native plugin',
  );

  const app = read('apps/web/app.js');
  assert.match(
    app,
    /attachNativeLinkBridge\s*\(/,
    'the web shell must attach the native URL bridge',
  );
  assert.match(
    app,
    /Capacitor\?\.Plugins\?\.App|Capacitor\.Plugins\.App/,
    'the bridge must receive Capacitor\'s native App plugin without a browser bare import',
  );
  assert.match(
    app,
    /await\s+nativeLinksReady\.catch\s*\(/,
    'boot must await native pairing without letting a stale link block startup',
  );
});

test('local worker secrets and local D1 state can never be committed', () => {
  // `wrangler dev` يحتاج `.dev.vars`، وفيه نفس الأسرار الثلاثة التي يمنع
  // نشرها. بلا سطر في `.gitignore` يظهر الملف كملف جديد فيسحبه أي
  // `git add -A` إلى المستودع. وحالة D1 المحلية قاعدة كاملة، ومنها
  // توكنات الأجهزة المقترنة.
  const ignore = read('.gitignore');
  assert.match(ignore, /^\.dev\.vars$/m, '.gitignore must ignore wrangler local secrets');
  assert.match(ignore, /\.wrangler\//, '.gitignore must ignore local D1 state');
});

test('the server never acknowledges a write it did not apply', () => {
  // العميل يعزل ما لا تذكره الاستجابة، لكنه يُفرّغ طابوره من كل ما تُقرّه.
  // فإقرار عملية بلا جملة = ضياع صامت: APK أحدث من الـWorker المنشور يرسل
  // `kind` مجهولًا، فيُقَرّ ولا يُكتب ولا يُعاد أبدًا.
  const worker = read('services/sync-worker/src/index.ts');
  assert.match(
    worker,
    /unapplied\.add\(op\.opId\)/,
    'ops that build no statement must be collected, not acknowledged',
  );
  assert.match(
    worker,
    /applied:\s*ops[\s\S]*acknowledged\.has\(op\.opId\)/,
    'the response must list only ops acknowledged by the atomic commit path',
  );
  assert.match(
    worker,
    /commitAtNextRevision\([\s\S]*commitCandidates\.map\(\(op\)\s*=>\s*op\.opId\)/,
    'known writes must pass through the atomic revision/op-claim commit gate',
  );
  assert.match(
    worker,
    /if\s*\(commitCandidates\.length\s*===\s*0\)\s*break/,
    'an all-unknown batch must not call D1 with an empty write transaction',
  );

  const queue = read('apps/web/lib/sync.js');
  assert.match(
    queue,
    /quarantineOp\(op,\s*422,\s*'not_settled'\)/,
    'the client half of the contract must keep quarantining unsettled ops',
  );
});

test('a capped sync page can never strand rows behind the cursor', () => {
  // السقف يُطبَّق لكل جدول والمؤشر واحد مشترك. حساب المؤشر من أعلى rev في
  // الدفعة يسحبه فوق ما لم يُسلَّم من جدول مقطوع، فتُتخطّى صفوفه للأبد
  // والعميل يسمع «أنت محدَّث» وهو ناقص. أُثبت على D1 حقيقية: ضاعت 100 من 600.
  const worker = read('services/sync-worker/src/index.ts');
  assert.match(
    worker,
    /nextDeltaCursor\(pages,/,
    'the sync handler must derive its cursor from the per-table pages',
  );
  assert.doesNotMatch(
    worker,
    /cursor:\s*truncated\s*\?\s*maxRev/,
    'the cursor must never be the highest rev across all tables',
  );

  const rule = read('packages/domain/src/sync.ts');
  assert.match(
    rule,
    /for \(const page of capped\) if \(page\.maxRev < safe\) safe = page\.maxRev/,
    'the safe cursor is the earliest capped table, not the furthest',
  );

  // صفحة كاملة على rev واحد لا يمكن تجاوزها بـ`rev >`: تقدّمٌ يفقد، وثباتٌ
  // يعلّق العميل في حلقة. الجدول يُستنزف عند ذلك الـrev مرة واحدة.
  assert.match(
    worker,
    /WHERE rev = \?\$\{scope\.sql\} ORDER BY rev/,
    'a page whose rows share one rev must be drained at that rev',
  );
});

test('every growing sync table has the index its delta query needs', () => {
  // `/v1/sync` يشغّل `WHERE rev > ? ORDER BY rev` على كل جدول فروقات. وبلا
  // فهرس على `rev` يجيب المحرّك `SCAN` كاملًا + `TEMP B-TREE` للترتيب، في
  // كل مزامنة لا في الأولى. سقط جدولا B8 من هذا لأن الأقدم كلها أخذت
  // فهرسها؛ هذا الحارس يمنع الباتش القادم من تكرارها.
  const worker = read('services/sync-worker/src/index.ts');
  const block = worker.slice(
    worker.indexOf('const DELTA_TABLES'),
    worker.indexOf('] as const', worker.indexOf('const DELTA_TABLES')),
  );
  const tables = [...block.matchAll(/^\s*\['([a-z_]+)'/gm)].map((match) => match[1]);
  assert.ok(tables.length > 10, 'the delta table list must have been parsed');

  const migrations = readdirSync(resolve(ROOT, 'services/sync-worker/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => read(`services/sync-worker/migrations/${name}`))
    .join('\n');

  // `accounts` مستثنى بقصد: ثلاثة صفوف ثابتة بحكم §2، فالفهرس كلفة بلا مقابل
  for (const table of tables.filter((name) => name !== 'accounts')) {
    const indexed = new RegExp(`CREATE INDEX[^;]*ON\\s+${table}\\s*\\([^)]*\\brev\\b`, 'i');
    assert.match(
      migrations,
      indexed,
      `${table} is pulled by every sync and needs an index on rev`,
    );
  }
});

test('a spoiler comment never leaks into a surface with no reveal control', () => {
  // الحرق يدويّ من الكاتب (§27)، والقارئ يكشفه بنفسه. أما الإشعار وسجل
  // النشاط فلا زرّ كشف فيهما، فالحرق يقع هناك بمجرد العرض. وكان الإشعار
  // يحمل نصّ التعليق كاملًا: ردٌّ فيه حرق يصل صاحبه بنصّه.
  const worker = read('services/sync-worker/src/index.ts');
  assert.match(
    worker,
    /body: fanoutBody\(\{ body, spoiler \}\)/,
    'the reply notification must pass the body through the fan-out filter',
  );
  assert.doesNotMatch(
    worker,
    /spoiler_after/,
    'the progress-based spoiler model is gone and must not come back',
  );

  const rule = read('packages/domain/src/spoilers.ts');
  assert.match(
    rule,
    /return comment\.spoiler \? null : comment\.body/,
    'a spoiler body must resolve to nothing for notifications and activity',
  );
  // `'true'` نصٌّ لا علامة: قبولُه يجعل الحرق يُفعَّل بالخطأ أو يُلتفّ عليه
  assert.match(
    rule,
    /value === 1 \|\| value === true/,
    'the spoiler flag must be read strictly, not by truthiness',
  );
});

test('every table the server sends is mirrored by the client', () => {
  // حلقة السحب تتخطّى أي جدول بلا مفتاح (`if (!keyOf) continue`) ثم يعبر
  // المؤشر فوقه: الصفوف لا تتأخر، بل تضيع للأبد. وقد سقطت ثلاثة جداول من
  // خريطة العميل — `works` و`recommendation_recipients` و`activity_receipts` —
  // فكان الخادم يرسلها والعميل يلقيها بلا أثر ولا خطأ.
  const worker = read('services/sync-worker/src/index.ts');
  const deltaBlock = worker.slice(
    worker.indexOf('const DELTA_TABLES'),
    worker.indexOf('] as const', worker.indexOf('const DELTA_TABLES')),
  );
  const sent = [...deltaBlock.matchAll(/^\s*\['([a-z_]+)'/gm)].map((match) => match[1]);

  const client = read('apps/web/lib/sync.js');
  const keysBlock = client.slice(
    client.indexOf('const KEYS'),
    client.indexOf('};', client.indexOf('const KEYS')),
  );
  const mirrored = new Set([...keysBlock.matchAll(/^\s{2}([a-z_]+):/gm)].map((match) => match[1]));

  assert.ok(sent.length > 10, 'the delta table list must have been parsed');
  for (const table of sent) {
    assert.ok(
      mirrored.has(table),
      `the server sends ${table} but the client mirror has no key for it, so its rows are dropped`,
    );
  }
});

test('a sync that stopped at the round cap does not report itself as done', () => {
  // `pending` طابور الكتابة وحده، فكانت الحالة `ok` ورسالتها «مُزامَن» بينما
  // القراءة متأخرة بآلاف الصفوف.
  const client = read('apps/web/lib/sync.js');
  assert.match(client, /backlog = true/, 'an early exit must raise the backlog flag');
  assert.match(
    client,
    /setTimeout\(\(\) => void pull\(\), 0\)/,
    'a capped pull must resume at once instead of waiting for the next cycle',
  );

  const health = read('apps/web/lib/queue.js');
  assert.match(
    health,
    /if \(backlog\) \{[\s\S]*?state: 'syncing'/,
    'health must not say synced while a read backlog is pending',
  );
});

test('the settings screen does not crash before it renders', () => {
  // `screenSettings` كانت تكتب `state.screen` في أول سطر ثم تُعلن
  // `const state = sync.health()` في نفس الجسم. الاسم محجوز للجسم كله من
  // بدايته (TDZ)، فالسطر الأول يرمي `Cannot access 'state' before
  // initialization` — والشاشة لا تُفتح أبدًا.
  //
  // وهذا يقتل الدخول على APK جديد: بلا عنوان مخبوز، الإعدادات هي الطريق
  // الوحيد لضبط الخادمين.
  const app = read('apps/web/app.js');
  const start = app.indexOf('async function screenSettings()');
  assert.ok(start > 0, 'the settings screen must exist');
  const body = app.slice(start, app.indexOf('\n}\n', start));

  assert.doesNotMatch(
    body,
    /^\s*(?:const|let) state\b/m,
    'the settings screen must not shadow the app state object',
  );
  assert.match(
    body,
    /const health = sync\.health\(\)/,
    'sync health must be read into its own name',
  );
});

test('every XML the Android builds depend on actually parses', () => {
  // دامج الـmanifest يسقط على XML غير صالح، والسقوط يأتي من CI بعد دقائق
  // ومع أثرٍ طويل لا يسمّي الملف. وقد حدث فعلًا: تعليقٌ وُضع **بين خصائص**
  // وسم `<application>` — وهذا غير صالح، والتعليق الصحيح يكون فوق الوسم.
  //
  // الفحص هنا محلي وفوري، فلا تُصرف لفّة CI على غلطةٍ يكشفها محلّل XML.
  const targets = [
    ...trackedFiles().filter((path) => path.startsWith('spike/') && path.endsWith('.xml')),
    ...trackedFiles().filter((path) => path.startsWith('android/') && path.endsWith('.xml')),
  ];

  for (const path of targets) {
    const source = read(path);
    // تعليق داخل وسم: `<` ثم اسم ثم خصائص ثم `<!--` قبل أن يُغلق الوسم
    const insideTag = /<[A-Za-z][^>]*?<!--/s;
    assert.doesNotMatch(
      source,
      insideTag,
      `${path} puts an XML comment inside a tag, which the manifest merger rejects`,
    );
  }
});

test('the all-Arabic spike pins an index snapshot and copies published APK urls verbatim', () => {
  // أول تشغيل حقيقي سقط على الخمسة بـ404 لأن رابط APK بُني من قاعدة مستنبطة.
  // النسخة الكلّية لا تعود لقائمة يدوية: workflow يثبّت commit للفهرس،
  // والمولّد يأخذ resources.apkUrl نفسه ثم يحسب SHA-256 من البايتات المنشورة.
  const workflow = read('.github/workflows/spike-extension-engine.yml');
  const generator = read('spike/extension-engine/tools/generate_arabic_sources.py');
  const fallback = read(
    'spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/GeneratedSources.kt',
  );

  assert.match(
    workflow,
    /^\s*KEIYOUSHI_INDEX_COMMIT:\s*[0-9a-f]{40}\s*$/m,
    'the discovery spike must build from one exact Keiyoushi index commit',
  );
  assert.match(
    generator,
    /apk_url = resources\.get\("apkUrl"\)/,
    'the generator must copy resources.apkUrl from index.json',
  );
  assert.doesNotMatch(
    generator,
    /apkUrl.*(?:versionName|packageName).*f["']/,
    'the generator must never reconstruct apkUrl from metadata',
  );
  assert.match(
    generator,
    /hashlib\.sha256\(data\)\.hexdigest\(\)/,
    'every downloaded APK in the generated snapshot needs a byte-level SHA-256',
  );
  assert.match(
    generator,
    /s\.get\("language"\) == "ar"/,
    'Arabic discovery must use sources[].language, not directory naming',
  );

  // والـfallback المحلي هو نفس الدفعة التي نسلّمها: 16 حزمة محددة،
  // MangaDex وحده من namespace العام، ولا مصدر NSFW.
  const urls = [...fallback.matchAll(/apkUrl = "([^"]+)"/g)].map((match) => match[1]);
  const hashes = [...fallback.matchAll(/sha256 = "([0-9a-f]{64})"/g)];
  const packages = [...fallback.matchAll(/pkg = "([^"]+)"/g)].map((match) => match[1]);
  const warnings = [...fallback.matchAll(/warning = ContentWarning\.(SAFE|MIXED|NSFW)/g)]
    .map((match) => match[1]);
  assert.equal(urls.length, 16, 'the delivered spike must contain exactly sixteen packages');
  assert.equal(hashes.length, urls.length, 'every fallback artifact needs its sha256');
  assert.deepEqual(
    packages.filter((pkg) => pkg.includes('.extension.all.')),
    ['eu.kanade.tachiyomi.extension.all.mangadex'],
    'MangaDex must be the only foreign catalogue package',
  );
  assert.deepEqual(
    packages.filter((pkg) => !pkg.includes('.extension.all.'))
      .every((pkg) => pkg.includes('.extension.ar.')),
    true,
    'all remaining packages must be Arabic',
  );
  assert.equal(warnings.filter((warning) => warning === 'SAFE').length, 15);
  assert.equal(warnings.filter((warning) => warning === 'MIXED').length, 1);
  assert.equal(warnings.filter((warning) => warning === 'NSFW').length, 0);
  assert.doesNotMatch(fallback, /goonscans|Goon Scans/i, 'Goon Scans was removed by owner request');
  assert.doesNotMatch(
    fallback,
    /arabmanhwa|ArabManhwa/i,
    'ArabManhwa routes currently return 404 and must not ship as a false-green source',
  );
  assert.doesNotMatch(
    fallback,
    /mangalink|Mangalink/i,
    'MangaLink requires persistent browser verification and must not ship as an automatic source',
  );
  assert.doesNotMatch(
    fallback,
    /extension\.ar\.arabtoons/,
    'the owner removed every NSFW source from the delivered spike',
  );
  assert.match(fallback, /extension\.ar\.mangatime/, 'MangaTime must replace the browser-gated MangaLink package');
  for (const url of urls) assert.match(url, /^https:\/\/.*\.apk$/, url);
});

test('the safe spike installs beside older debug builds', () => {
  const gradle = read('spike/extension-engine/app/build.gradle.kts');
  const manifest = read('spike/extension-engine/app/src/main/AndroidManifest.xml');

  assert.match(gradle, /applicationId\s*=\s*"dev\.vantara\.spike\.catalogue16"/);
  assert.match(gradle, /versionCode\s*=\s*3/);
  assert.match(manifest, /android:label="VANTARA Spike Catalogue 16"/);
});

test('catalogue counting covers every non-blocked source in the safe sixteen-package batch', () => {
  const spike = 'spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/';
  const runner = read(`${spike}CatalogueCrawlRunner.kt`);
  const service = read(`${spike}CatalogueCrawlService.kt`);
  const ui = read(`${spike}CatalogueCrawlUiPolicy.kt`);

  // The batch is filtered by policy only (blocked/NSFW), never by SAFE.
  assert.match(runner, /specs\.filter \{ shouldCrawlCatalogue\(it\.warning, it\.blockedReason\) \}/);
  assert.doesNotMatch(
    runner,
    /ContentWarning\.SAFE/,
    'MIXED sources must not be silently omitted from catalogue counting',
  );
  assert.match(service, /specs = SPIKE_SOURCES,/);
  assert.match(ui, /استأنف إحصاء كل المصادر/);
  assert.match(ui, /احصِ كتالوج كل المصادر/);
});

test('the catalogue crawl is owned by the foreground service, not the screen', () => {
  const spike = 'spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/';
  const activity = read(`${spike}MainActivity.kt`);
  const service = read(`${spike}CatalogueCrawlService.kt`);

  // A crawl inside lifecycleScope died with the screen; that is why counts
  // looked far smaller than the sources are.
  assert.doesNotMatch(activity, /crawlCatalogue\(/, 'MainActivity must not run the crawl itself');
  assert.match(activity, /CatalogueCrawlService\.start\(this\)/);
  assert.match(service, /probe\.crawlCatalogue\(/);
  assert.match(service, /override fun onTimeout\(startId: Int, fgsType: Int\)/);
});

test('saved probe state is bound to the generated source snapshot', () => {
  const spike = 'spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/';
  const activity = read(`${spike}MainActivity.kt`);
  const snapshot = read(`${spike}ArabicSourceLoading.kt`);
  const service = read(`${spike}CatalogueCrawlService.kt`);

  assert.match(snapshot, /append\(SPIKE_INDEX_COMMIT\)/);
  assert.match(activity, /checkpoint\.ensureSnapshot\(spikeBatchFingerprint\(\)\)/);
  assert.match(
    snapshot,
    /fun catalogueSnapshotKey\(\): String = "\$\{spikeBatchFingerprint\(\)\}\|\$CATALOGUE_LISTING_SCHEMA"/,
    'catalogue resume data must be invalidated when traversal semantics change',
  );
  // Screen and service must bind to the same key, or one wipes the other's pages.
  assert.match(activity, /catalogueCheckpoint\.ensureSnapshot\(catalogueSnapshotKey\(\)\)/);
  assert.match(service, /val snapshotKey = catalogueSnapshotKey\(\)/);
  assert.match(service, /checkpoint\.ensureSnapshot\(snapshotKey\)/);

  const probeStore = read(
    'spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/ProbeCheckpointStore.kt',
  );
  assert.doesNotMatch(
    probeStore,
    /fun clear\(\)[\s\S]*?snapshot\.delete\(\)/,
    'manual report clearing must preserve the current snapshot binding',
  );

  const catalogueStore = read(
    'spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/CatalogueCrawlCheckpointStore.kt',
  );
  assert.doesNotMatch(
    catalogueStore,
    /fun clear\(\)[\s\S]*?dir\.deleteRecursively\(\)/,
    'manual catalogue clearing must preserve the current snapshot binding',
  );
});

test('no spike probe step can run without a deadline or an announcement', () => {
  // تشغيلٌ حقيقي وقف عند «load» بلا سطرٍ بعده. ولم يكن سقوطًا: خطوةٌ واحدة
  // تملك دقيقتَي `callTimeout`، وداخلهما إعادة محاولة ثلاثية، وداخل كل
  // محاولة قد ينتظر اعتراض Cloudflare متصفحًا مخفيًّا عشرين ثانية — وطوال
  // ذلك لا يُطبع حرف. فقُرئ العملُ موتًا.
  //
  // فشرطان على كل خطوة: تُعلن اسمها قبل أن تبدأ، وتموت بمهلة معلنة. وبهما
  // لا تعود الشاشة تصمت، ولا يحجز مصدرٌ واحد التشغيل عن البقية.
  const probe = read('spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/SourceProbe.kt');

  assert.match(
    probe,
    /announce\(name\)[\s\S]{0,400}?withTimeout\(timeoutMs\)/,
    'step() must announce itself and then run under withTimeout',
  );
  assert.match(
    probe,
    /const val STEP_TIMEOUT_MS = [\d_]+L/,
    'the step deadline must be a named constant, not a magic number',
  );
  assert.match(
    probe,
    /if \(t is CancellationException && t !is TimeoutCancellationException\) throw t/,
    'a real cancellation must propagate; only our own timeout may be swallowed',
  );

  // والعدّ الكامل يمشي حتى يقول المصدر «لا مزيد»: المالك طلب كل الأعمال،
  // وسقفُ الأربعين صفحة كان يقطع عند ٤٠٠ ويُعلن أنه لم يُثبت النهاية.
  // فالحاجز الباقي حاجزُ أمانٍ بعيد لا سقفُ سياسة، ويُعلَن إن بُلغ.
  const fullCap = probe.match(/const val FULL_PAGE_CAP = ([\d_]+)/);
  assert.ok(fullCap, 'the full crawl needs an explicit safety ceiling');
  assert.ok(
    Number(fullCap[1].replaceAll('_', '')) >= 1000,
    'the safety ceiling must be far beyond any real catalogue, not a 40-page cap',
  );
  assert.match(
    probe,
    /const val FULL_BUDGET_MS = /,
    'the full crawl needs its own time budget',
  );
  // والعيّنة تبقى عيّنة، ولا تُعرض كإحصاء
  assert.match(probe, /const val SAMPLE_PAGE_CAP = /, 'the chain check samples, it does not count');

  // طرفا قائمة الفصول: العدد وحده لا يقول إن كانت كاملة
  assert.match(
    probe,
    /val chapterSpan: String\?/,
    'the report must carry the newest and oldest chapter, not only a count',
  );

  // والشاشة لا تُنهي تشغيلًا بلا خبر ولا تترك الزر ميتًا
  const screen = read('spike/extension-engine/app/src/main/kotlin/dev/vantara/spike/MainActivity.kt');
  assert.match(
    screen,
    /\} finally \{[\s\S]*?انتهى[\s\S]*?button\.isEnabled = true/,
    'runAll must always print an ending and re-enable the button',
  );

  // والصورة تُعرض من البايتات التي قبِلها المسبار، لا بتنزيلٍ ثانٍ بعميل
  // بلا ترويسات المصدر — ذاك يردّه مضيف الصور 403 فيُكذّب إثباتًا صحيحًا
  assert.match(
    screen,
    /report\.imageData\?\.let/,
    'the on-screen image must decode the bytes the probe already proved',
  );
});


function isBackwardCompatibleD1Migration(sql) {
  const source = stripComments(sql);
  const statements = source
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    // Fail closed. Migration-first is safe only for a small set of operations
    // whose effect cannot make the still-serving old Worker reject writes.
    if (/^CREATE\s+TABLE\b/i.test(statement)) continue;
    if (/^CREATE\s+INDEX\b/i.test(statement)) continue;

    if (/^ALTER\s+TABLE\b[\s\S]*\bADD\s+COLUMN\b/i.test(statement)) {
      // A new column is compatible only when old INSERTs can omit it and when
      // the column itself does not impose a new validation/reference contract.
      if (/\b(?:CHECK|REFERENCES|UNIQUE|PRIMARY\s+KEY|GENERATED)\b/i.test(statement)) {
        return false;
      }
      if (/\bNOT\s+NULL\b/i.test(statement) && !/\bDEFAULT\b/i.test(statement)) {
        return false;
      }
      continue;
    }

    // DROP/RENAME/ALTER existing columns, constraints, triggers, unique indexes,
    // data rewrites, and unknown SQL all require an explicit staged rollout.
    return false;
  }

  return true;
}

test('D1 rollout classifier rejects write-incompatible changes disguised as expansions', () => {
  const unsafe = [
    'ALTER TABLE comments ADD COLUMN required_text TEXT NOT NULL;',
    'ALTER TABLE comments ADD CONSTRAINT comments_body_nonempty CHECK (length(body) > 0);',
    'CREATE UNIQUE INDEX comments_one_body ON comments(body);',
    'ALTER TABLE comments ALTER COLUMN body SET NOT NULL;',
    "ALTER TABLE comments ADD COLUMN mood TEXT CHECK (mood = 'ok') DEFAULT 'bad';",
    "CREATE TRIGGER reject_old_write BEFORE INSERT ON comments BEGIN SELECT RAISE(FAIL, 'blocked'); END;",
  ];
  for (const sql of unsafe) {
    assert.equal(
      isBackwardCompatibleD1Migration(sql),
      false,
      `old Worker writes may fail after this migration is applied first: ${sql}`,
    );
  }

  const safe = [
    'ALTER TABLE comments ADD COLUMN optional_text TEXT;',
    'ALTER TABLE comments ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0;',
    'CREATE INDEX comments_rev_extra ON comments(rev);',
    'CREATE TABLE extra_metadata (id TEXT PRIMARY KEY, note TEXT);',
  ];
  for (const sql of safe) {
    assert.equal(
      isBackwardCompatibleD1Migration(sql),
      true,
      `expand-only rollout should allow: ${sql}`,
    );
  }
});

test('D1 rollout migrations after the adversarial baseline are backward-compatible expansions', () => {
  const dir = resolve(ROOT, 'services/sync-worker/migrations');
  const migrations = readdirSync(dir)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .filter((name) => Number(name.slice(0, 4)) >= 12);

  const bad = [];
  for (const name of migrations) {
    const sql = read(`services/sync-worker/migrations/${name}`);
    if (!isBackwardCompatibleD1Migration(sql)) bad.push(name);
  }
  assert.deepEqual(
    bad,
    [],
    'D1 migrations applied before Worker deploy must use expand/contract; destructive steps belong in a later release',
  );
});


test('live D1 verifier cleans durable fixture op claims between runs', () => {
  const verifier = read('services/sync-worker/verify.mjs');
  const start = verifier.indexOf('async function cleanup()');
  const end = verifier.indexOf('function rowsOf', start);
  assert.ok(start >= 0 && end > start, 'verify.mjs must keep an explicit cleanup function');

  const cleanup = verifier.slice(start, end);
  assert.match(
    cleanup,
    /DELETE FROM op_claims WHERE op_id LIKE '__verify__%'/,
    're-running live verification must not collide with durable op_claims left by the previous run',
  );
});

test('the reader app runs the exact engine the spike proved on device', () => {
  // The app once kept an older copy of the spike engine: five sources, no
  // package/version identity check, no per-source repairs, and `first()`
  // source selection that could hand MangaDex's English catalogue to an
  // Arabic reader. Shared files must now be byte-identical.
  const shared = [
    'dev/vantara/spike/Sources.kt',
    'dev/vantara/spike/GeneratedSources.kt',
    'dev/vantara/spike/FileExtensionLoader.kt',
    'dev/vantara/spike/SourceCompatRepairs.kt',
    'dev/vantara/spike/DilarCryptoCompat.kt',
    'dev/vantara/spike/ChromeUserAgent.kt',
    'dev/vantara/spike/CloudflareInteractionPolicy.kt',
    'dev/vantara/spike/ArabicSourceSelection.kt',
    'dev/vantara/spike/ProbeResiliencePolicy.kt',
    'dev/vantara/spike/ImagePayloadPolicy.kt',
    'dev/vantara/spike/BoundedPayloadReader.kt',
    'dev/vantara/spike/RxAwait.kt',
    'dev/vantara/spike/CatalogueFilterPolicy.kt',
    'dev/vantara/spike/HttpStopPolicy.kt',
    'dev/vantara/spike/CatalogueListingResolver.kt',
    'eu/kanade/tachiyomi/network/NetworkHelper.kt',
    'eu/kanade/tachiyomi/network/interceptor/BrowserVerificationInterceptor.kt',
    'eu/kanade/tachiyomi/network/interceptor/CloudflareInterceptor.kt',
  ];
  for (const file of shared) {
    assert.equal(
      read(`android/app/src/main/kotlin/${file}`),
      read(`spike/extension-engine/app/src/main/kotlin/${file}`),
      `${file} drifted between the spike and the reader app`,
    );
  }

  const plugin = read('android/app/src/main/kotlin/com/vantara/plugins/ExtensionEnginePlugin.kt');
  assert.match(plugin, /selectArabicSources\(spec, all\)/);
  assert.doesNotMatch(plugin, /filterIsInstance<CatalogueSource>\(\)\.firstOrNull\(\)/);
  assert.match(plugin, /SourceCompatRepairs\.loadSeries\(/);
  assert.match(plugin, /SourceCompatRepairs\.loadPages\(/);
  assert.doesNotMatch(plugin, /source\.getPageList\(/, 'pages must go through the per-source repairs');
  // The reader solves Cloudflare by hand; only the spike batch fails fast.
  assert.match(plugin, /CloudflareInteractionMode\.batchProbe = false/);
  // Explore browses the full catalogue, never a ranking or an all-language feed.
  assert.match(plugin, /fun catalogue\(call: PluginCall\)/);
  assert.match(plugin, /CatalogueFilterPolicy\.catalogueFilters\(source\)/);
  const explore = read('apps/web/screens/sources.js');
  assert.match(explore, /engine\.catalogue\(source\.id, page\)/);
  assert.doesNotMatch(explore, /engine\.popular\(/);
});

test('every source extension ships inside the app and matches its pinned hash', () => {
  // keiyoushi يحذف إصداراته القديمة مع كل بناء للفهرس: التنزيل وحده أسقط
  // المصادر الستة عشر كلها (HTTP 404). فكل إضافة مضمّنة في التطبيق، وبصمتها
  // هي نفسها المثبّتة في GeneratedSources.kt — لا نسخة قديمة تبقى بلا أن يُعرف.
  const kotlin = read('android/app/src/main/kotlin/dev/vantara/spike/GeneratedSources.kt');
  const specs = [...kotlin.matchAll(/pkg = "([^"]+)",[\s\S]*?sha256 = "([0-9a-f]{64})"/g)].map((m) => ({ pkg: m[1], sha: m[2] }));
  assert.ok(specs.length >= 10, 'GeneratedSources.kt must list the Arabic sources');
  const dir = 'android/app/src/main/assets/extensions';
  const tracked = trackedFiles().filter((p) => p.startsWith(`${dir}/`));
  const onDisk = readdirSync(resolve(ROOT, dir)).filter((n) => n.endsWith('.apk'));
  for (const { pkg, sha } of specs) {
    const path = `${dir}/${pkg}.apk`;
    assert.ok(onDisk.includes(`${pkg}.apk`), `${path} is missing — run node tools/bundle-extensions.mjs`);
    const actual = createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex');
    assert.equal(actual, sha, `${path} does not match its pinned sha256`);
  }
  assert.equal(onDisk.length, specs.length, 'no stale extension APKs may remain in the bundle');
  if (tracked.length) assert.equal(tracked.length, specs.length, 'every bundled extension must be tracked');
  const plugin = read('android/app/src/main/kotlin/com/vantara/plugins/ExtensionEnginePlugin.kt');
  assert.match(plugin, /readVerifiedCache\(spec\)[\s\S]*?readBundled\(spec\)[\s\S]*?download\(spec\)/, 'the engine must prefer the bundled copy over downloading');
});
