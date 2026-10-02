import { createHmac, randomBytes } from 'node:crypto';

/**
 * تحقّق ما بعد النشر، على D1 الحقيقية.
 *
 * الاختبارات الوحدوية في `@vantara/domain` تثبت القواعد. هذا يثبت أن الـWorker
 * يطبّقها فعلًا عبر SQL وشبكة وعميل — وهو المكان الذي تظهر فيه أخطاء الترتيب
 * والذرّية، لا في الدوال النقية.
 *
 *   node verify.mjs <worker-url>
 *
 * يكتب بمعرّفات موسومة `__verify__` ثم يحذفها عبر واجهة D1 عندما تتوفّر
 * CLOUDFLARE_API_TOKEN وD1_DATABASE_ID. بلا حذف لا يبقى أثر مؤذٍ: صفٌّ واحد
 * بمفتاح فصل لا يوجد في أي مصدر.
 */

const CLEANUP_ONLY = process.argv[2] === '--cleanup-only';
const BASE = CLEANUP_ONLY ? '' : (process.argv[2] ?? '').replace(/\/+$/, '');
if (!CLEANUP_ONLY && !BASE) {
  console.error('usage: node verify.mjs <worker-url> | --cleanup-only');
  process.exit(2);
}

// حساب مؤقت مخصّص للتحقق. لا نلمس حسابات المستخدمين الثلاثة.
const USER_ID = '00000000-0000-4000-8000-00000000b011';
const USERNAME = '__verify__';
const DEVICE_ONE = '__verify__-device-one';
const DEVICE_TWO = '__verify__-device-two';
const CHAPTER = '__verify__/ch-1';
const SERIES = '__verify__/series';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

async function call(path, options = {}, token = null) {
  const headers = { ...(options.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}


function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name} for live D1 verification`);
  return value;
}

async function d1Query(sql, params = []) {
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const account = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const database = requiredEnv('D1_DATABASE_ID');
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    throw new Error(`D1 verify query failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

function randomSecret(label) {
  return `__verify__-${label}-${randomBytes(24).toString('hex')}`;
}

function pairingHash(token) {
  return createHmac('sha256', requiredEnv('VANTARA_DEVICE_PEPPER')).update(token).digest('hex');
}

async function seedVerifierAccount() {
  const now = Date.now();
  await d1Query(
    'INSERT INTO accounts (user_id, username, created_at, rev) VALUES (?, ?, ?, 0)',
    [USER_ID, USERNAME, now],
  );
  await d1Query(
    'INSERT INTO profiles (user_id, display_name, field_revs, rev) VALUES (?, ?, ?, 0)',
    [USER_ID, 'VANTARA Verify', '{}'],
  );
  await d1Query(
    "INSERT INTO presence (user_id, status, beat_at) VALUES (?, 'OFFLINE', 0)",
    [USER_ID],
  );
  await d1Query(
    'INSERT INTO settings (user_id, data, field_revs, rev) VALUES (?, ?, ?, 0)',
    [USER_ID, '{}', '{}'],
  );
}

async function pairVerifierDevice(deviceId, deviceCredential) {
  const token = randomSecret('pair');
  const now = Date.now();
  await d1Query(
    `INSERT INTO pairing_tokens
       (token_hash, user_id, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, NULL, ?)`,
    [pairingHash(token), USER_ID, now + 5 * 60_000, now],
  );
  return call('/v1/device/pair', {
    method: 'POST',
    body: { deviceId, deviceCredential, pairingToken: token },
  });
}

async function cleanup() {
  // idempotent: يُستدعى قبل الفحص وبعده، ويزيل بقايا Run انقطع سابقًا.
  //
  // 0012 أضاف op_claims كدفتر حجز دائم قبل applied_ops. verifier يستخدم
  // op_id ثابتة عمدًا لاختبار replay، لذلك إبقاء claim من Run سابق يجعل
  // أول كتابة في الـRun التالي تصطدم بالمفتاح الفريد وتظهر كـ500 زائف.
  // نحذف claims الخاصة بالـfixtures فقط؛ claims المستخدمين الحقيقيين لا تُمس.
  // A LIKE prefix does not use the default case-insensitive SQLite index.
  // The verifier owns this exact ASCII prefix; a key range uses the PK index.
  await d1Query("DELETE FROM op_claims WHERE op_id >= '__verify__' AND op_id < '__verify_`'");
  await d1Query("DELETE FROM notifications WHERE id >= '__verify__' AND id < '__verify_`'");
  await d1Query('DELETE FROM applied_ops WHERE user_id = ?', [USER_ID]);
  await d1Query("DELETE FROM applied_ops WHERE op_id >= '__verify__' AND op_id < '__verify_`'");
  await d1Query("DELETE FROM works WHERE series_ref >= '__verify__' AND series_ref < '__verify_`'");
  await d1Query('DELETE FROM pairing_tokens WHERE user_id = ?', [USER_ID]);
  // حسابات التحقق المؤقتة (إضافة/حذف): ما بقي من Run انقطع قبل المسح النهائي،
  // ثم شواهد قبور هذا الـRun نفسه. لا شيء منها يبقى على شاشة «من يتابع؟».
  const temp = "SELECT user_id FROM accounts WHERE (username >= '__verify__' AND username < '__verify_`' AND user_id != ?)";
  for (const table of ['trusted_devices', 'account_pins', 'profiles', 'presence', 'settings', 'applied_ops']) {
    await d1Query(`DELETE FROM ${table} WHERE user_id IN (${temp})`, [USER_ID]);
    if (tempAccounts.length) await d1Query(`DELETE FROM ${table} WHERE user_id IN (${tempAccounts.map(() => '?').join(', ')})`, tempAccounts);
  }
  await d1Query(`DELETE FROM accounts WHERE user_id IN (${temp})`, [USER_ID]);
  if (tempAccounts.length) await d1Query(`DELETE FROM accounts WHERE user_id IN (${tempAccounts.map(() => '?').join(', ')})`, tempAccounts);
  await d1Query('DELETE FROM account_pins WHERE user_id = ?', [USER_ID]);
  await d1Query('DELETE FROM accounts WHERE user_id = ? OR username = ?', [USER_ID, USERNAME]);
}

/** معرّفات حسابات أنشأها هذا الـRun: تُكنس شواهد قبورها في التنظيف. */
const tempAccounts = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * الحسابات على D1 الحقيقية: السقف، PIN (مجزّأ، مطلوب، خطأ، تغيير، إزالة)،
 * إضافة حساب، ثم الحذف: PENDING_DELETE لا يمسح شيئًا ولا يحرر الاسم، التراجع
 * يعيده ACTIVE، الإتمام قبل المهلة لا يمسح، وبعدها مسح نهائي وشاهد قبر
 * بنفس الـUUID، والتوكن القديم لا يكتب.
 */
async function verifyAccounts(token, credentialOne) {
  const sessionWith = (userId, extra = {}) =>
    call('/v1/session', { method: 'POST', body: { userId, deviceId: DEVICE_ONE, deviceCredential: credentialOne, ...extra } });

  const listed = await call('/v1/accounts');
  check('سقف الحسابات عشرة يصل الواجهة', listed.json?.limit === 10, `limit=${listed.json?.limit}`);

  // ─── PIN ───
  const set = await call('/v1/pin', { method: 'POST', body: { action: 'set', pin: '4826' } }, token);
  check('PIN من 4 أرقام يُضبط', set.status === 200 && set.json?.digits === 4);
  const stored = (await d1Query('SELECT pin_hash, digits FROM account_pins WHERE user_id = ?', [USER_ID])).result?.[0]?.results?.[0];
  check('PIN مجزّأ لا نص صريح', /^[0-9a-f]{64}$/.test(stored?.pin_hash ?? '') && !String(stored?.pin_hash).includes('4826'));
  const required = await sessionWith(USER_ID);
  check('الجلسة تطلب PIN', required.status === 401 && required.json?.error === 'pin_required' && required.json?.digits === 4);
  const wrong = await sessionWith(USER_ID, { pin: '0000' });
  check('PIN خاطئ يُرفض', wrong.status === 401 && wrong.json?.error === 'pin_wrong');
  const right = await sessionWith(USER_ID, { pin: '4826' });
  check('PIN صحيح يفتح ويعطي إذنًا', right.status === 200 && typeof right.json?.pinGrant === 'string' && right.json?.user?.pinDigits === 4);
  const granted = await sessionWith(USER_ID, { pinGrant: right.json?.pinGrant });
  check('الإذن يجدد الجلسة بلا سؤال', granted.status === 200);
  const noCurrent = await call('/v1/pin', { method: 'POST', body: { action: 'set', pin: '135790' } }, token);
  check('تغيير PIN بلا الحالي مرفوض', noCurrent.status === 401);
  const changed = await call('/v1/pin', { method: 'POST', body: { action: 'set', pin: '135790', currentPin: '4826' } }, token);
  check('تغيير PIN إلى 6 أرقام بالحالي', changed.status === 200 && changed.json?.digits === 6);
  const removed = await call('/v1/pin', { method: 'POST', body: { action: 'remove', currentPin: '135790' } }, token);
  check('إزالة PIN بالحالي', removed.status === 200);
  check('بلا PIN تعود الجلسة بلا سؤال', (await sessionWith(USER_ID)).status === 200);

  // ─── إضافة حساب ───
  const username = `__verify__${randomBytes(3).toString('hex')}`;
  const created = await call('/v1/accounts/create', { method: 'POST', body: { username, displayName: 'Verify Temp' } }, token);
  const tempId = created.json?.account?.userId;
  if (tempId) tempAccounts.push(tempId);
  check('إضافة حساب بمعرّف ثابت جديد', created.status === 200 && /^[0-9a-f-]{36}$/.test(tempId ?? ''));
  const taken = await call('/v1/accounts/create', { method: 'POST', body: { username, displayName: 'x' } }, token);
  check('اسم المستخدم فريد', taken.status === 409 && taken.json?.error === 'username_taken');
  const tempSession = await sessionWith(tempId);
  const tempToken = tempSession.json?.token;
  check('الحساب الجديد يُفتح من جهاز معتمد', tempSession.status === 200 && Boolean(tempToken));
  if (!tempToken) return;
  await call('/v1/pin', { method: 'POST', body: { action: 'set', pin: '2468' } }, tempToken);
  await call('/v1/ops', { method: 'POST', body: { ops: [{ opId: `__verify__-temp-lib-${Date.now()}`, kind: 'library.add', payload: { seriesRef: '__verify__/temp', seriesTitle: 'Verify' } }] } }, tempToken);
  const countRows = async () => {
    const tables = ['profiles', 'presence', 'settings', 'library', 'account_pins', 'trusted_devices'];
    let n = 0;
    for (const table of tables) {
      n += Number((await d1Query(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [tempId])).result?.[0]?.results?.[0]?.n ?? 0);
    }
    return n;
  };
  const before = await countRows();
  const accountRow = async () => (await d1Query('SELECT username, lifecycle FROM accounts WHERE user_id = ?', [tempId])).result?.[0]?.results?.[0];

  // ─── الحذف والتراجع ───
  const badDelete = await call('/v1/accounts/delete', { method: 'POST', body: { pin: '0000' } }, tempToken);
  check('الحذف يطلب PIN الحساب', badDelete.status === 401);
  const pending = await call('/v1/accounts/delete', { method: 'POST', body: { pin: '2468' } }, tempToken);
  check('PIN صحيح ⇒ PENDING_DELETE بمهلة عشر ثوانٍ', pending.status === 200 && pending.json?.state === 'PENDING_DELETE' && pending.json?.graceMs === 10_000);
  const pendingRow = await accountRow();
  check('في المهلة: الاسم محجوز ولا شيء مُسح', pendingRow?.lifecycle === 'PENDING_DELETE' && pendingRow?.username === username && (await countRows()) === before, `rows=${before}`);
  check('في المهلة: مخفي من «من يتابع؟»', !((await call('/v1/accounts')).json?.content ?? []).some((a) => a.userId === tempId));
  const undo = await call('/v1/accounts/restore', { method: 'POST', body: {} }, tempToken);
  check('التراجع يعيده ACTIVE فورًا', undo.status === 200 && undo.json?.state === 'ACTIVE' && (await accountRow())?.lifecycle === 'ACTIVE' && (await countRows()) === before);

  await call('/v1/accounts/delete', { method: 'POST', body: { pin: '2468' } }, tempToken);
  const early = await call('/v1/accounts/delete/commit', { method: 'POST', body: {} }, tempToken);
  check('الإتمام قبل المهلة لا يمسح', early.json?.state === 'PENDING_DELETE' && Number(early.json?.retryInMs) > 0 && (await countRows()) === before);
  await wait(Number(early.json?.retryInMs ?? 12_000) + 500);
  const done = await call('/v1/accounts/delete/commit', { method: 'POST', body: {} }, tempToken);
  const tomb = await accountRow();
  check('بعد المهلة: مسح نهائي', done.json?.state === 'DELETED' && (await countRows()) === 0);
  check('شاهد قبر بنفس الـUUID والاسم تحرر', tomb?.lifecycle === 'DELETED' && tomb?.username === `~${tempId}`);
  const freed = Number((await d1Query('SELECT COUNT(*) AS n FROM accounts WHERE username = ?', [username])).result?.[0]?.results?.[0]?.n ?? 1);
  check('اسم المستخدم متاح بعد المسح فقط', freed === 0);
  const stale = await call('/v1/ops', { method: 'POST', body: { ops: [{ opId: `__verify__-stale-${Date.now()}`, kind: 'library.add', payload: { seriesRef: '__verify__/stale', seriesTitle: 'x' } }] } }, tempToken);
  check('توكن الحساب المحذوف لا يكتب', stale.status === 410 && (await countRows()) === 0);
}

function rowsOf(payload, table) {
  return payload?.changes?.[table] ?? [];
}

function noInternalRows(payload) {
  return Object.keys(payload?.changes ?? {}).flatMap((table) => rowsOf(payload, table)).every((row) =>
    !String(row.series_ref ?? '').startsWith('__') && !String(row.chapter_key ?? '').startsWith('__'),
  );
}

async function main() {
  // ─── B2: جهاز موثوق حقيقي على D1 ───
  await seedVerifierAccount();

  const legacy = await call('/v1/session', { method: 'POST', body: { userId: USER_ID } });
  check(
    'userId وحده لم يعد إثبات هوية',
    legacy.status === 401 && legacy.json?.error === 'device_proof_required',
  );

  const credentialOne = randomSecret('device-one');
  const credentialTwo = randomSecret('device-two');

  const pairedOne = await pairVerifierDevice(DEVICE_ONE, credentialOne);
  const pairedTwo = await pairVerifierDevice(DEVICE_TWO, credentialTwo);
  check('الجهاز الأول اقترن', pairedOne.status === 200 && pairedOne.json?.paired === true);
  check('الجهاز الثاني اقترن', pairedTwo.status === 200 && pairedTwo.json?.paired === true);

  const session = await call('/v1/session', {
    method: 'POST',
    body: { userId: USER_ID, deviceId: DEVICE_ONE, deviceCredential: credentialOne },
  });
  const secondSession = await call('/v1/session', {
    method: 'POST',
    body: { userId: USER_ID, deviceId: DEVICE_TWO, deviceCredential: credentialTwo },
  });
  check('الجهاز الأول يصدر access token v2', session.status === 200 && Boolean(session.json?.token));
  check('الجهاز الثاني يصدر access token v2', secondSession.status === 200 && Boolean(secondSession.json?.token));
  const token = session.json?.token;
  if (!token) throw new Error(`trusted-device session failed: ${session.text}`);

  const noToken = await call('/v1/sync');
  check('السحب بلا توكن يُرفض', noToken.status === 401);

  // ─── خط الأساس ───
  const baseline = await call('/v1/sync?since=0', {}, token);
  check('سحب كامل يعمل', baseline.status === 200 && baseline.json?.reset === false);
  const startCursor = Number(baseline.json?.cursor ?? 0);

  // ─── قراءة فصل، ثم إعادة تسليم نفس العملية ───
  const completeOp = {
    opId: '__verify__-complete-1',
    kind: 'chapter.complete',
    payload: { chapterKey: CHAPTER, seriesRef: SERIES, chapterNumber: 1, ratio: 1, activeMs: 9000 },
  };

  const first = await call('/v1/ops', { method: 'POST', body: { ops: [completeOp] } }, token);
  check('تُقبل العملية الأولى', first.status === 200);

  // نفس op_id مرتين: هذا ما يحدث فعلًا عند سقوط الشبكة بعد التطبيق وقبل الإجابة
  const replay = await call('/v1/ops', { method: 'POST', body: { ops: [completeOp] } }, token);
  check('إعادة التسليم تُقبل بلا خطأ', replay.status === 200);

  // ومرة ثالثة في نفس الدفعة، مكرّرة داخليًا
  const doubled = await call(
    '/v1/ops',
    { method: 'POST', body: { ops: [completeOp, completeOp] } },
    token,
  );
  check('التكرار داخل الدفعة يُقبل', doubled.status === 200);

  const afterReads = await call(`/v1/sync?since=${startCursor}`, {}, token);
  check('كيانات التحقق الداخلية لا تصل في الفروقات', afterReads.status === 200 && noInternalRows(afterReads.json));
  // المراجع الداخلية محجوبة عن المزامنة عمدًا؛ نفحص الكتابة في D1 نفسها.
  const readRow = (await d1Query(
    'SELECT read_count FROM chapter_reads WHERE user_id = ? AND chapter_key = ?',
    [USER_ID, CHAPTER],
  )).result?.[0]?.results?.[0];
  check('الفصل الداخلي كُتب في D1', Boolean(readRow));
  // القلب: أربع تسليمات لنفس العملية ⇒ قراءة واحدة
  check(
    'الفصل لم يُحتسب مرتين بعد إعادة التسليم',
    readRow?.read_count === 1,
    `read_count=${readRow?.read_count}`,
  );

  const stats = await call(`/v1/stats/${USER_ID}`, {}, token);
  check('الإحصائيات تُحتسب', stats.status === 200);
  check(
    'الفريد والإعادات متسقان',
    (stats.json?.uniqueChapters ?? 0) >= 1 && (stats.json?.rereads ?? -1) >= 0,
    `unique=${stats.json?.uniqueChapters} total=${stats.json?.totalReads} rereads=${stats.json?.rereads}`,
  );

  // ─── التقدم لا يرجع ───
  await call(
    '/v1/ops',
    {
      method: 'POST',
      body: {
        ops: [
          {
            opId: '__verify__-progress-high',
            kind: 'progress.set',
            payload: { chapterKey: CHAPTER, seriesRef: SERIES, page: 30, ratio: 0.95 },
          },
        ],
      },
    },
    token,
  );
  // جهاز قديم يزامن بعده حالة أقدم
  await call(
    '/v1/ops',
    {
      method: 'POST',
      body: {
        ops: [
          {
            opId: '__verify__-progress-stale',
            kind: 'progress.set',
            payload: { chapterKey: CHAPTER, seriesRef: SERIES, page: 12, ratio: 0.4 },
          },
        ],
      },
    },
    token,
  );

  const afterProgress = await call(`/v1/sync?since=${startCursor}`, {}, token);
  check('التقدم الداخلي لا يصل في الفروقات', afterProgress.status === 200 && noInternalRows(afterProgress.json));
  const progressRow = (await d1Query(
    'SELECT page, owner_synced FROM progress WHERE user_id = ? AND chapter_key = ?',
    [USER_ID, CHAPTER],
  )).result?.[0]?.results?.[0];
  check(
    'التقدم لم يرجع للخلف بعد مزامنة جهاز قديم',
    progressRow?.page === 30,
    `page=${progressRow?.page}`,
  );

  // ─── ملكية التقدم: المرآة صندوق صادر يُقرّ، لا حقيقة ثانية ───
  check(
    'صف المرآة في D1 معلَّم بأن المالك لم يستلمه',
    progressRow?.owner_synced === 0,
    `owner_synced=${progressRow?.owner_synced}`,
  );

  const pendingBefore = await call('/v1/progress/pending', {}, token);
  const pendingRow = (pendingBefore.json?.content ?? []).find((row) => row.chapterKey === CHAPTER);
  check(
    'الصندوق الصادر يسمّي مالك التقدم',
    pendingBefore.json?.owner === 'UCHIYOMI',
    `owner=${pendingBefore.json?.owner}`,
  );
  check('الصف المعلّق يظهر في الصندوق', pendingRow?.page === 30, `page=${pendingRow?.page}`);

  // إقرار متأخر بصفحة أقل: لا يجوز أن يُسكت صفًّا تجاوزها
  await call(
    '/v1/ops',
    {
      method: 'POST',
      body: {
        ops: [
          {
            opId: '__verify__-confirm-stale',
            kind: 'progress.confirm',
            payload: { chapterKey: CHAPTER, page: 12 },
          },
        ],
      },
    },
    token,
  );
  const afterStaleConfirm = await call('/v1/progress/pending', {}, token);
  check(
    'إقرار بصفحة أقل لا يُخرج الصف من الصندوق',
    (afterStaleConfirm.json?.content ?? []).some((row) => row.chapterKey === CHAPTER),
  );

  await call(
    '/v1/ops',
    {
      method: 'POST',
      body: {
        ops: [
          {
            opId: '__verify__-confirm-30',
            kind: 'progress.confirm',
            payload: { chapterKey: CHAPTER, page: 30 },
          },
        ],
      },
    },
    token,
  );
  const afterConfirm = await call('/v1/progress/pending', {}, token);
  check(
    'إقرار المالك يُخرج الصف من الصندوق',
    !(afterConfirm.json?.content ?? []).some((row) => row.chapterKey === CHAPTER),
  );

  // تقدم جديد أعلى يعيد الصف معلّقًا: المالك لم يرَ القيمة الجديدة
  await call(
    '/v1/ops',
    {
      method: 'POST',
      body: {
        ops: [
          {
            opId: '__verify__-progress-41',
            kind: 'progress.set',
            payload: { chapterKey: CHAPTER, seriesRef: SERIES, page: 41, ratio: 0.95 },
          },
        ],
      },
    },
    token,
  );
  const afterAdvance = await call('/v1/progress/pending', {}, token);
  check(
    'تقدم أعلى بعد الإقرار يعود للصندوق',
    (afterAdvance.json?.content ?? []).some(
      (row) => row.chapterKey === CHAPTER && row.page === 41,
    ),
  );

  // ─── فتح لثانية ليس قراءة ───
  const tooShort = await call(
    '/v1/ops',
    {
      method: 'POST',
      body: {
        ops: [
          {
            opId: '__verify__-too-short',
            kind: 'chapter.complete',
            payload: {
              chapterKey: '__verify__/ch-2',
              seriesRef: SERIES,
              ratio: 1,
              activeMs: 400,
            },
          },
        ],
      },
    },
    token,
  );
  check('تُقبل بلا خطأ فلا يتوقف الطابور', tooShort.status === 200);
  const afterShort = await call(`/v1/sync?since=${startCursor}`, {}, token);
  const shortReads = (await d1Query(
    'SELECT read_count FROM chapter_reads WHERE user_id = ? AND chapter_key = ?',
    [USER_ID, '__verify__/ch-2'],
  )).result?.[0]?.results ?? [];
  check(
    'فتح الفصل لثانية لم يُحتسب قراءة',
    shortReads.length === 0,
  );

  // ─── الـcursor يتقدّم ولا يرجع ───
  const cursorNow = Number(afterShort.json?.cursor ?? 0);
  check('الـcursor تقدّم بعد الكتابة', cursorNow > startCursor, `${startCursor} → ${cursorNow}`);
  const empty = await call(`/v1/sync?since=${cursorNow}`, {}, token);
  check(
    'سحب بلا جديد لا يُرجع الـcursor',
    Number(empty.json?.cursor ?? 0) >= cursorNow,
    `cursor=${empty.json?.cursor}`,
  );

  // ─── cursor من المستقبل يطلب سحبًا كاملًا ───
  const future = await call(`/v1/sync?since=${cursorNow + 100_000}`, {}, token);
  check('cursor أعلى من الخادم يطلب سحبًا كاملًا', future.json?.reset === true);

  // ─── الحضور خارج سجل الفروقات ───
  const beat = await call(
    '/v1/presence',
    { method: 'POST', body: { status: 'READING', screen: 'READER', seriesTitle: 'verify' } },
    token,
  );
  check('النبضة تُقبل', beat.status === 200);
  const afterBeat = await call(`/v1/sync?since=${cursorNow}`, {}, token);
  // لو رفعت النبضة العدّاد لبقي كل عميل يسحب فروقات إلى الأبد
  check(
    'النبضة لم ترفع عدّاد المراجعات',
    Number(afterBeat.json?.serverRev ?? 0) === Number(empty.json?.serverRev ?? -1),
    `serverRev=${afterBeat.json?.serverRev}`,
  );
  const presence = await call('/v1/presence', {}, token);
  check('قائمة الحضور تُقرأ', presence.status === 200 && Array.isArray(presence.json?.content));
  const reading = (presence.json?.content ?? []).find((row) => row.userId === USER_ID);
  check('ما يُقرأ يُبثّ وهو ظاهر', reading?.seriesTitle === 'verify', `series=${reading?.seriesTitle}`);

  // ─── الإخفاء يُقرأ من مالك الحضور نفسه ───
  //
  // كان يعيش في مخزن آخر (`vantara_user_gates`) على مسار لا يستهلكه التطبيق،
  // فإخفاء مُفعَّل لم يكن يُطبَّق على المسار الذي يقرأه الأصدقاء فعلًا.
  await call(
    '/v1/ops',
    {
      method: 'POST',
      body: {
        ops: [
          {
            opId: `__verify__-incognito-on-${Date.now()}`,
            kind: 'settings.patch',
            payload: { fields: { incognitoUntil: Date.now() + 60_000 } },
          },
        ],
      },
    },
    token,
  );
  const hidden = await call('/v1/presence', {}, token);
  const redacted = (hidden.json?.content ?? []).find((row) => row.userId === USER_ID);
  check('الإخفاء يحجب العمل ويُبقي الوجود', redacted?.seriesTitle === null && redacted?.incognito === true);
  check('الإخفاء يمنع حالة «يقرأ»', redacted?.status !== 'READING', `status=${redacted?.status}`);
  const hiddenAccounts = await call('/v1/accounts');
  check(
    'شاشة اختيار الحساب تحترم نفس الإخفاء',
    (hiddenAccounts.json?.content ?? []).find((row) => row.userId === USER_ID)?.status !== 'READING',
  );

  await call(
    '/v1/ops',
    {
      method: 'POST',
      body: {
        ops: [
          {
            opId: `__verify__-incognito-off-${Date.now()}`,
            kind: 'settings.patch',
            payload: { fields: { incognitoUntil: 0 } },
          },
        ],
      },
    },
    token,
  );
  const restored = await call('/v1/presence', {}, token);
  check(
    'إلغاء الإخفاء يعيد البثّ',
    (restored.json?.content ?? []).find((row) => row.userId === USER_ID)?.incognito === false,
  );

  // ─── الهوية الداخلية لا تتغير ───
  await call(
    '/v1/ops',
    {
      method: 'POST',
      body: {
        ops: [
          {
            opId: `__verify__-identity-${Date.now()}`,
            kind: 'profile.patch',
            payload: { fields: { user_id: 'مُلفَّق', userId: 'مُلفَّق', displayName: 'دحمي' } },
          },
        ],
      },
    },
    token,
  );
  const accounts = await call('/v1/accounts');
  const dahmi = (accounts.json?.content ?? []).find((row) => row.userId === USER_ID);
  check('user_id لم يتغير بتعديل وارد', Boolean(dahmi), `userId=${dahmi?.userId}`);
  check('الاسم بقي قابلًا للتعديل', dahmi?.displayName === 'دحمي', `name=${dahmi?.displayName}`);

  await verifyAccounts(token, credentialOne);

  // ─── logout-all يقتل كل الأجهزة الموثوقة للحساب ───
  const logoutAll = await call('/v1/device/logout-all', { method: 'POST' }, token);
  check('logout-all ألغى الجهازين', logoutAll.status === 200 && Number(logoutAll.json?.revoked ?? 0) >= 2);

  const firstRetry = await call('/v1/session', {
    method: 'POST',
    body: { userId: USER_ID, deviceId: DEVICE_ONE, deviceCredential: credentialOne },
  });
  const secondRetry = await call('/v1/session', {
    method: 'POST',
    body: { userId: USER_ID, deviceId: DEVICE_TWO, deviceCredential: credentialTwo },
  });
  check('الجهاز الأول لا يستطيع تجديد الجلسة بعد logout-all', firstRetry.status === 401);
  check('الجهاز الثاني لا يستطيع تجديد الجلسة بعد logout-all', secondRetry.status === 401);

  console.log(`\n${failures.length === 0 ? 'كل الفحوص نجحت' : `فشل ${failures.length}`}`);
  if (failures.length > 0) process.exitCode = 1;
}

if (CLEANUP_ONLY) {
  await cleanup();
  console.log('— fixtures التحقق القديمة حُذفت');
} else {
  await cleanup();
  try {
    await main();
  } finally {
    await cleanup();
  }
}
