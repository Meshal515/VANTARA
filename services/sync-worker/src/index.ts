/**
 * VANTARA sync worker.
 *
 * نطاقه: الطبقة الاجتماعية والتقدم والإحصائيات لثلاثة مستخدمين. لا ترجمة ولا
 * OCR ولا صور فصول — الفصول المنزّلة وكاش الصور وكوكيز المصادر تبقى على
 * الهاتف ولا تمرّ من هنا.
 *
 * القواعد الحاكمة مُختبرة في `@vantara/domain/sync`، وهذا الملف يطبّقها على
 * D1 ولا يعيد كتابتها. حيث يفرض SQL القاعدة بنفسه (MAX للتقدم، جمع للوقت)
 * تُستدعى دالة المجال للتحقق من المدخل، وتعليق يربط الاثنين.
 */

import {
  SYNC_PROTOCOL,
  clampUsageCredit,
  dedupeOps,
  isCompletedRead,
  mergeFields,
  mergeProgress,
  needsFullResync,
  notificationId,
  notificationTargets,
  ownerOf,
  readStats,
  redactForViewers,
  statusFor,
  stripImmutable,
} from '@vantara/domain';

import type { D1PreparedStatement, Env, ExecutionContext } from './types.ts';
import { bearerFrom, mintToken, verifyToken } from './session.ts';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/**
 * أصول العميل.
 *
 * Capacitor يقدّم الواجهة من `https://localhost` على أندرويد، وPages من نطاقه.
 * بلا هذه القائمة يفشل كل طلب من الـAPK بخطأ CORS يبدو كانقطاع شبكة.
 */
const DEFAULT_ORIGINS = [
  'https://localhost',
  'capacitor://localhost',
  'http://localhost:4173',
  'http://localhost:5173',
];

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowed = [
    ...DEFAULT_ORIGINS,
    ...(env.ALLOWED_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean) ?? []),
  ];
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function json(body: unknown, init: ResponseInit = {}, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...extra, ...(init.headers ?? {}) },
  });
}

// ───────────────────────────── العدّاد ─────────────────────────────

/**
 * يحجز رقم مراجعة واحدًا للطلب كله.
 *
 * كل عمليات الطلب تتشارك الرقم: الـrev رقم معاملة منطقية لا طابع لكل صف.
 * والفراغات فيه مقصودة ومقبولة — العميل يقارن بـ`>` فقط، فرقم محجوز لطلب فشل
 * لا يضرّ. وهذا أرخص من حجز رقم لكل عملية برحلة كتابة لكل واحدة.
 */
async function allocateRev(env: Env): Promise<number> {
  const row = await env.DB.prepare('UPDATE sync_state SET rev = rev + 1 WHERE id = 1 RETURNING rev')
    .first<{ rev: number }>();
  if (!row) throw new Error('sync_state missing');
  return row.rev;
}

async function currentRev(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT rev FROM sync_state WHERE id = 1').first<{ rev: number }>();
  return row?.rev ?? 0;
}

/** `incognitoUntil` من إعدادات المالك نفسه. قيمة فاسدة تعني «ليس مخفيًا». */
function incognitoUntilFrom(raw: unknown): number {
  if (typeof raw !== 'string' || raw === '') return 0;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const until = parsed['incognitoUntil'];
    return typeof until === 'number' && Number.isFinite(until) ? until : 0;
  } catch {
    return 0;
  }
}

// ───────────────────────────── الحسابات ─────────────────────────────

interface AccountRow {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_key: string | null;
  banner_key: string | null;
  accent: string | null;
  status: string;
  beat_at: number;
  settings_data: string | null;
}

/**
 * ما تحتاجه شاشة اختيار الحساب، قبل أي جلسة.
 *
 * تُرجع الحالة الحيّة أيضًا: الشاشة تعرض قفلًا و«متصل الآن» على حساب يجلس فيه
 * أحد. القفل إعلام لا حاجز — لا كلمة مرور تُفحص، والدخول يبقى لمسة واحدة.
 */
async function handleAccounts(env: Env, now: number): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT a.user_id, a.username,
            p.display_name, p.avatar_key, p.banner_key, p.accent,
            pr.status, pr.beat_at, s.data AS settings_data
       FROM accounts a
       LEFT JOIN profiles p USING (user_id)
       LEFT JOIN presence pr USING (user_id)
       LEFT JOIN settings s USING (user_id)
      ORDER BY a.created_at, a.username`,
  ).all<AccountRow>();

  return json({
    protocol: SYNC_PROTOCOL,
    content: results.map((row) => {
      const ago = now - (row.beat_at ?? 0);
      // نفس قاعدة الحجب المستخدمة في مسار الحضور: حالتان مختلفتان لنفس
      // المستخدم على شاشتين تعني أن الإخفاء يعمل في مكان ولا يعمل في آخر
      const { status } = redactForViewers(
        {
          userId: row.user_id,
          username: row.username,
          status: statusFor(ago, { reading: row.status === 'READING' }),
        },
        { incognito: incognitoUntilFrom(row.settings_data) > now },
      );
      return {
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name ?? row.username,
        avatarKey: row.avatar_key,
        bannerKey: row.banner_key,
        accent: row.accent,
        status,
        // القفل: أحد جالس في هذا الحساب الآن
        active: status !== 'OFFLINE',
        lastSeenAt: row.beat_at || null,
      };
    }),
  });
}

/** اختيار الحساب هو الدخول: لا كلمة مرور، ولا خطوة تحقق. */
async function handleSession(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { userId?: unknown } | null;
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return json({ error: 'bad_request' }, { status: 400 });

  // الحسابات الثلاثة فقط. لا إنشاء حساب من الشبكة.
  const account = await env.DB.prepare(
    'SELECT a.user_id, a.username, p.display_name FROM accounts a LEFT JOIN profiles p USING (user_id) WHERE a.user_id = ?',
  )
    .bind(userId)
    .first<{ user_id: string; username: string; display_name: string | null }>();
  if (!account) return json({ error: 'unknown_account' }, { status: 404 });

  const token = await mintToken(account.user_id, env.VANTARA_SESSION_SECRET);
  return json({
    token,
    user: {
      userId: account.user_id,
      username: account.username,
      displayName: account.display_name ?? account.username,
    },
  });
}

// ───────────────────────────── السحب ─────────────────────────────

/** جداول سجل الفروقات وأعمدتها. الحضور غائب بقصد: لا يلمس rev. */
const DELTA_TABLES = [
  ['accounts', 'user_id, username, created_at, rev'],
  ['profiles', 'user_id, display_name, avatar_key, banner_key, bio, accent, rev'],
  ['library', 'user_id, series_ref, series_title, cover_url, source_id, added_at, removed, rev'],
  // `owner_synced` يسافر مع الصف: العميل يجب أن يعرف أن هذه القيمة لم يرها
  // مالك التقدم بعد، فيصالحها بدل أن يعرضها كحقيقة نهائية
  ['progress', 'user_id, chapter_key, series_ref, page, ratio, updated_at, rev, owner_synced'],
  ['chapter_reads', 'user_id, chapter_key, series_ref, chapter_number, read_count, first_read_at, last_read_at, rev'],
  ['usage_daily', 'user_id, day, active_ms, rev'],
  ['collections', 'user_id, kind, series_ref, member, position, updated_at, rev'],
  ['ratings', 'user_id, series_ref, score, updated_at, rev'],
  ['comments', 'id, author_id, series_ref, chapter_ref, parent_id, body, spoiler_after, created_at, deleted, rev'],
  ['reactions', 'comment_id, user_id, emoji, active, rev'],
  ['recommendations', 'id, from_id, to_id, series_ref, series_title, cover_url, message, state, created_at, rev'],
  // `seen` يسافر مع الصف: بلا «عُرض» يتكرر التنبيه الجانبي عند كل مزامنة،
  // أو يُعتبر العرضُ قراءةً فيختفي غير المقروء بلا أن يفتحه أحد
  ['notifications', 'id, user_id, kind, actor_id, series_ref, body, link, read, seen, created_at, rev'],
  ['activity', 'id, actor_id, verb, series_ref, payload, created_at, rev'],
  ['settings', 'user_id, data, rev'],
] as const;

/** سقف الدفعة لكل جدول. دفعة ضخمة تتجاوز حد زمن الـWorker وتفشل كلها. */
const PAGE_SIZE = 500;

/**
 * الفروقات منذ cursor.
 *
 * كل الجداول في `batch` واحد: D1 تنفّذه كمعاملة واحدة، فاللقطة متسقة. قراءة
 * كل جدول بطلب منفصل تسمح بكتابة بينها، فيرى العميل تعليقًا بلا صاحبه.
 */
async function handleSync(url: URL, env: Env): Promise<Response> {
  const since = Number(url.searchParams.get('since') ?? '0');
  const cursor = Number.isFinite(since) && since > 0 ? Math.floor(since) : 0;
  const serverRev = await currentRev(env);

  // D1 مُستعادة من نسخة احتياطية: بلا هذا الفحص لا يرى العميل جديدًا أبدًا
  if (needsFullResync(cursor, serverRev)) {
    return json({ protocol: SYNC_PROTOCOL, reset: true, cursor: 0, serverRev, changes: {} });
  }

  const statements = DELTA_TABLES.map(([table, columns]) =>
    env.DB.prepare(
      `SELECT ${columns} FROM ${table} WHERE rev > ? ORDER BY rev LIMIT ${PAGE_SIZE}`,
    ).bind(cursor),
  );
  const results = await env.DB.batch<Record<string, unknown>>(statements);

  const changes: Record<string, unknown[]> = {};
  let maxRev = cursor;
  let truncated = false;
  results.forEach((result, index) => {
    const entry = DELTA_TABLES[index];
    if (!entry) return;
    const rows = result.results ?? [];
    changes[entry[0]] = rows;
    if (rows.length >= PAGE_SIZE) truncated = true;
    for (const row of rows) {
      const rev = Number(row['rev'] ?? 0);
      if (rev > maxRev) maxRev = rev;
    }
  });

  // دفعة مقطوعة: لا نُقدّم الـcursor إلى serverRev، وإلا فُقد ما بعد السقف.
  // العميل يعيد الطلب فورًا بالـcursor الجديد حتى يعود truncated=false.
  return json({
    protocol: SYNC_PROTOCOL,
    reset: false,
    cursor: truncated ? maxRev : Math.max(maxRev, serverRev),
    serverRev,
    more: truncated,
    changes,
  });
}

// ───────────────────────────── الكتابة ─────────────────────────────

interface IncomingOp {
  opId: string;
  kind: string;
  payload: Record<string, unknown>;
}

function asString(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * يترجم عملية واحدة إلى جُمل D1.
 *
 * `null` تعني عملية غير صالحة: تُسجّل كمطبَّقة ولا تُنفّذ. الرفض بخطأ يجعل
 * طابور العميل يتوقف عند عملية فاسدة إلى الأبد، وهذا يجمّد المزامنة كلها.
 */
/**
 * ما يحتاجه تحويل العملية من حالة خارجية.
 *
 * `accounts` يلزم لتوصية «للجميع»: المستلمون ليسوا في الحمولة. يُقرأ مرة واحدة
 * لكل طلب وفقط عند وجود عملية تحتاجه، لا مرة لكل عملية.
 */
export interface OpContext {
  accounts: readonly string[];
}

/**
 * ينتج إشعارًا لكل مستلم.
 *
 * هذا هو المُنتِج العام: أي نظام يريد إشعارًا (توصيات، ردود، تفاعلات) يستدعيه
 * ولا يكتب في جدول الإشعارات بنفسه. مفتاح الصف مشتق من `op_id` والمستلم، فإعادة
 * تسليم العملية لا تُنتج إشعارًا ثانيًا لنفس الحدث.
 */
function notificationStatements(
  db: Env['DB'],
  input: {
    opId: string;
    kind: string;
    recipients: readonly string[];
    actorId: string;
    seriesRef?: string | null;
    body?: string | null;
    link?: string | null;
    now: number;
    rev: number;
  },
): D1PreparedStatement[] {
  return input.recipients.map((recipient) =>
    db
      .prepare(
        `INSERT INTO notifications
           (id, user_id, kind, actor_id, series_ref, body, link, read, seen, created_at, rev)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
      )
      .bind(
        notificationId(input.opId, recipient),
        recipient,
        input.kind,
        input.actorId,
        input.seriesRef ?? null,
        input.body ?? null,
        input.link ?? null,
        input.now,
        input.rev,
      ),
  );
}

export function statementsFor(
  op: IncomingOp,
  userId: string,
  rev: number,
  now: number,
  env: Env,
  ctx: OpContext = { accounts: [] },
): D1PreparedStatement[] | null {
  const db = env.DB;
  const p = op.payload;

  switch (op.kind) {
    case 'progress.set': {
      const chapterKey = asString(p['chapterKey'], 200);
      const seriesRef = asString(p['seriesRef'], 200);
      if (!chapterKey || !seriesRef) return null;
      // التحقق والحدّ من دالة المجال؛ الدمج نفسه بـMAX في SQL أدناه.
      // القاعدة واحدة في المكانين: التقدم لا يرجع. أي تعديل هنا يلزمه تعديل
      // `mergeProgress` ومعه اختباره.
      const normalized = mergeProgress(null, {
        page: asNumber(p['page']) ?? 0,
        ratio: asNumber(p['ratio']) ?? 0,
      });
      return [
        db
          .prepare(
            // `owner_synced = 0`: هذه الكتابة صادرة حتى يُقرّها مالك التقدم.
            // القيمة المدموجة قد تتغير بـMAX هنا، فالإقرار القديم لا يصلح لها —
            // وإلا اعتُبر تقدم لم يره المالك مؤكَّدًا فسقط بلا دفع.
            `INSERT INTO progress
               (user_id, chapter_key, series_ref, page, ratio, updated_at, rev, owner_synced)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0)
             ON CONFLICT (user_id, chapter_key) DO UPDATE SET
               page = MAX(progress.page, excluded.page),
               ratio = MAX(progress.ratio, excluded.ratio),
               updated_at = excluded.updated_at,
               rev = excluded.rev,
               owner_synced = CASE
                 WHEN MAX(progress.page, excluded.page) = progress.page
                  AND MAX(progress.ratio, excluded.ratio) = progress.ratio
                 THEN progress.owner_synced ELSE 0 END`,
          )
          .bind(userId, chapterKey, seriesRef, normalized.page, normalized.ratio, now, rev),
      ];
    }

    /**
     * إقرار المالك.
     *
     * يُرسل بعد نجاح الكتابة عند مالك التقدم. الشرط `page <= ?` يمنع إقرارًا
     * متأخرًا من تثبيت قيمة تجاوزها الجهاز بعد إرسال الإقرار: إقرار الصفحة 12
     * لا يجوز أن يُسكت صفًّا صار 30.
     *
     * الصفحة وحدها في الشرط: المالك يحفظ الصفحة و`completed` ولا يعرف نسبة
     * داخل الصفحة، فمطالبته بإقرار نسبة لا يملكها تعني صندوقًا لا يُصرَّف أبدًا.
     */
    case 'progress.confirm': {
      const chapterKey = asString(p['chapterKey'], 200);
      const page = asNumber(p['page']);
      if (!chapterKey || page === null) return null;
      return [
        db
          .prepare(
            `UPDATE progress SET owner_synced = 1, rev = ?
              WHERE user_id = ? AND chapter_key = ? AND page <= ?`,
          )
          .bind(rev, userId, chapterKey, Math.max(0, Math.floor(page))),
      ];
    }

    // العمليتان التاليتان تراكميتان (+1 و+ms)، فهما وحدهما غير معرّفتين
    // بطبيعتهما. الحرس `NOT EXISTS` يجعل إعادة التسليم بلا أثر داخل نفس
    // الدفعة الذرّية التي تحجز op_id — انظر handleOps.
    case 'chapter.complete': {
      const chapterKey = asString(p['chapterKey'], 200);
      const seriesRef = asString(p['seriesRef'], 200);
      if (!chapterKey || !seriesRef) return null;
      // يُفرض على الخادم: عميل قديم أو معطوب يستطيع أن يرسل هذه لكل فتح،
      // والإحصائيات هي ما يراه الأصدقاء.
      if (!isCompletedRead({ ratio: asNumber(p['ratio']) ?? 0, activeMs: asNumber(p['activeMs']) ?? 0 })) {
        return null;
      }
      return [
        db
          .prepare(
            `INSERT INTO chapter_reads
               (user_id, chapter_key, series_ref, chapter_number, read_count, first_read_at, last_read_at, rev)
             SELECT ?, ?, ?, ?, 1, ?, ?, ?
              WHERE NOT EXISTS (SELECT 1 FROM applied_ops WHERE op_id = ?)
             ON CONFLICT (user_id, chapter_key) DO UPDATE SET
               read_count = chapter_reads.read_count + 1,
               last_read_at = excluded.last_read_at,
               rev = excluded.rev`,
          )
          .bind(userId, chapterKey, seriesRef, asNumber(p['chapterNumber']), now, now, rev, op.opId),
      ];
    }

    case 'usage.add': {
      const ms = clampUsageCredit(asNumber(p['activeMs']) ?? 0);
      if (ms <= 0) return null;
      const day = asString(p['day'], 10) ?? new Date(now).toISOString().slice(0, 10);
      return [
        db
          .prepare(
            `INSERT INTO usage_daily (user_id, day, active_ms, rev)
             SELECT ?, ?, ?, ?
              WHERE NOT EXISTS (SELECT 1 FROM applied_ops WHERE op_id = ?)
             ON CONFLICT (user_id, day) DO UPDATE SET
               active_ms = usage_daily.active_ms + excluded.active_ms,
               rev = excluded.rev`,
          )
          .bind(userId, day, ms, rev, op.opId),
      ];
    }

    case 'library.add': {
      const seriesRef = asString(p['seriesRef'], 200);
      if (!seriesRef) return null;
      return [
        db
          .prepare(
            `INSERT INTO library (user_id, series_ref, series_title, cover_url, source_id, added_at, removed, rev)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?)
             ON CONFLICT (user_id, series_ref) DO UPDATE SET
               series_title = COALESCE(excluded.series_title, library.series_title),
               cover_url = COALESCE(excluded.cover_url, library.cover_url),
               removed = 0,
               rev = excluded.rev`,
          )
          .bind(
            userId,
            seriesRef,
            asString(p['seriesTitle'], 300),
            asString(p['coverUrl'], 600),
            asString(p['sourceId'], 120),
            now,
            rev,
          ),
      ];
    }

    case 'library.remove': {
      const seriesRef = asString(p['seriesRef'], 200);
      if (!seriesRef) return null;
      // شاهد قبر: الحذف يجب أن يُزامَن، وإلا عاد العمل عند أول مزامنة
      return [
        db
          .prepare(
            `INSERT INTO library (user_id, series_ref, added_at, removed, rev)
             VALUES (?, ?, ?, 1, ?)
             ON CONFLICT (user_id, series_ref) DO UPDATE SET removed = 1, rev = excluded.rev`,
          )
          .bind(userId, seriesRef, now, rev),
      ];
    }

    case 'favorite.set':
    case 'readLater.set': {
      const seriesRef = asString(p['seriesRef'], 200);
      if (!seriesRef) return null;
      const kind = op.kind === 'favorite.set' ? 'favorite' : 'read_later';
      const member = p['member'] === false ? 0 : 1;
      return [
        db
          .prepare(
            `INSERT INTO collections (user_id, kind, series_ref, member, position, updated_at, rev)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (user_id, kind, series_ref) DO UPDATE SET
               member = excluded.member,
               position = excluded.position,
               updated_at = excluded.updated_at,
               rev = excluded.rev`,
          )
          .bind(userId, kind, seriesRef, member, asNumber(p['position']), now, rev),
      ];
    }

    case 'rating.set': {
      const seriesRef = asString(p['seriesRef'], 200);
      const score = asNumber(p['score']);
      if (!seriesRef || score === null || score < 0 || score > 10) return null;
      return [
        db
          .prepare(
            `INSERT INTO ratings (user_id, series_ref, score, updated_at, rev)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (user_id, series_ref) DO UPDATE SET
               score = excluded.score, updated_at = excluded.updated_at, rev = excluded.rev`,
          )
          .bind(userId, seriesRef, score, now, rev),
      ];
    }

    case 'comment.add': {
      const seriesRef = asString(p['seriesRef'], 200);
      const body = asString(p['body'], 4000);
      if (!seriesRef || !body) return null;
      // المعرّف هو op_id: الإدراج المكرر يصطدم بالمفتاح فيكون بلا أثر
      return [
        db
          .prepare(
            `INSERT INTO comments
               (id, author_id, series_ref, chapter_ref, parent_id, body, spoiler_after, created_at, deleted, rev)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
             ON CONFLICT (id) DO NOTHING`,
          )
          .bind(
            op.opId,
            userId,
            seriesRef,
            asString(p['chapterRef'], 200),
            asString(p['parentId'], 80),
            body,
            asNumber(p['spoilerAfter']),
            now,
            rev,
          ),
      ];
    }

    case 'reaction.set': {
      const commentId = asString(p['commentId'], 80);
      const emoji = asString(p['emoji'], 16);
      if (!commentId || !emoji) return null;
      return [
        db
          .prepare(
            `INSERT INTO reactions (comment_id, user_id, emoji, active, rev)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (comment_id, user_id, emoji) DO UPDATE SET
               active = excluded.active, rev = excluded.rev`,
          )
          .bind(commentId, userId, emoji, p['active'] === false ? 0 : 1, rev),
      ];
    }

    case 'recommendation.send': {
      const seriesRef = asString(p['seriesRef'], 200);
      const toId = asString(p['toId'], 80);
      if (!seriesRef) return null;
      const statements = [
        db
          .prepare(
            `INSERT INTO recommendations
               (id, from_id, to_id, series_ref, series_title, cover_url, message, state, created_at, rev)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'SENT', ?, ?)
             ON CONFLICT (id) DO NOTHING`,
          )
          .bind(
            op.opId,
            userId,
            toId,
            seriesRef,
            asString(p['seriesTitle'], 300),
            asString(p['coverUrl'], 600),
            asString(p['message'], 500),
            now,
            rev,
          ),
      ];
      // توصية «للجميع» (`toId` فارغ) كانت لا تُنشئ إشعارًا لأحد: تُسجَّل في
      // جدول التوصيات ولا يعرف بها أحد. المستلمون يُحسبون من الحسابات، والفاعل
      // مستثنى، والرابط العميق يفتح العمل نفسه.
      statements.push(
        ...notificationStatements(db, {
          opId: op.opId,
          kind: 'RECOMMENDATION',
          recipients: notificationTargets({
            accounts: ctx.accounts,
            actorId: userId,
            to: toId,
          }),
          actorId: userId,
          seriesRef,
          body: asString(p['message'], 500),
          link: `vantara://series/${encodeURIComponent(seriesRef)}`,
          now,
          rev,
        }),
      );
      return statements;
    }

    /**
     * فتح الإشعار.
     *
     * القراءة تعني العرض ضمنًا، فتُكتب `seen` معها: بلا ذلك يبقى صفٌّ مقروء
     * بلا «عُرض»، ومزامنة جهاز آخر تراه «وصل الآن» فتُظهر تنبيهه من جديد.
     * ولا تُنقص أبدًا: `MAX` يحمي من إقرار متأخر يرجع بالحالة للخلف.
     */
    case 'notification.read': {
      const id = asString(p['id'], 80);
      if (!id) return null;
      return [
        db
          .prepare(
            `UPDATE notifications SET read = 1, seen = 1, rev = ?
              WHERE id = ? AND user_id = ?`,
          )
          .bind(rev, id, userId),
      ];
    }

    /**
     * عُرض التنبيه الجانبي، أو فُتح الصندوق.
     *
     * منفصل عن القراءة بقصد: العرض ليس قراءة. بلا هذه العملية يتكرر التنبيه
     * عند كل مزامنة، أو نضطر لاعتبار العرض قراءةً فيختفي غير المقروء بلا أن
     * يفتحه أحد. `MAX` كي لا يُرجع `seen` متأخرٌ صفًّا صار مقروءًا.
     */
    case 'notification.seen': {
      const id = asString(p['id'], 80);
      if (!id) return null;
      return [
        db
          .prepare(
            `UPDATE notifications SET seen = 1, rev = ?
              WHERE id = ? AND user_id = ? AND seen = 0`,
          )
          .bind(rev, id, userId),
      ];
    }

    case 'activity.add': {
      const verb = asString(p['verb'], 40);
      if (!verb) return null;
      return [
        db
          .prepare(
            `INSERT INTO activity (id, actor_id, verb, series_ref, payload, created_at, rev)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO NOTHING`,
          )
          .bind(
            op.opId,
            userId,
            verb,
            asString(p['seriesRef'], 200),
            JSON.stringify(p['payload'] ?? {}),
            now,
            rev,
          ),
      ];
    }

    default:
      return null;
  }
}

/** التعديلات التي تحتاج قراءة قبل الكتابة: rev لكل حقل مخزّن كـJSON. */
const FIELD_MERGE_KINDS = new Set(['profile.patch', 'settings.patch']);

/** العمليات التي تحتاج قائمة الحسابات (بثّ لكل المستلمين). */
const ACCOUNT_AWARE_KINDS = new Set(['recommendation.send']);

async function allAccountIds(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT user_id FROM accounts').all<{ user_id: string }>();
  return results.map((row) => row.user_id);
}

const PROFILE_COLUMNS: Record<string, string> = {
  displayName: 'display_name',
  avatarKey: 'avatar_key',
  bannerKey: 'banner_key',
  bio: 'bio',
  accent: 'accent',
};

async function applyFieldMerge(
  op: IncomingOp,
  userId: string,
  rev: number,
  env: Env,
): Promise<void> {
  // الهوية الداخلية تُسقط قبل الدمج، ولا يُرفض الطلب: الرفض يجعل تعديل الاسم
  // يفشل بلا سبب ظاهر للمستخدم
  const patch = stripImmutable((op.payload['fields'] ?? {}) as Record<string, unknown>);

  if (op.kind === 'settings.patch') {
    const row = await env.DB.prepare('SELECT data, field_revs FROM settings WHERE user_id = ?')
      .bind(userId)
      .first<{ data: string; field_revs: string }>();
    const existing = JSON.parse(row?.data ?? '{}') as Record<string, unknown>;
    const revs = JSON.parse(row?.field_revs ?? '{}') as Record<string, number>;
    const merged = mergeFields(existing, revs, patch, rev);
    await env.DB.prepare(
      `INSERT INTO settings (user_id, data, field_revs, rev) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, field_revs = excluded.field_revs, rev = excluded.rev`,
    )
      .bind(userId, JSON.stringify(merged.value), JSON.stringify(merged.revs), rev)
      .run();
    return;
  }

  const row = await env.DB.prepare(
    'SELECT display_name, avatar_key, banner_key, bio, accent, field_revs FROM profiles WHERE user_id = ?',
  )
    .bind(userId)
    .first<Record<string, unknown>>();
  const existing: Record<string, unknown> = {
    displayName: row?.['display_name'] ?? null,
    avatarKey: row?.['avatar_key'] ?? null,
    bannerKey: row?.['banner_key'] ?? null,
    bio: row?.['bio'] ?? null,
    accent: row?.['accent'] ?? null,
  };
  const revs = JSON.parse((row?.['field_revs'] as string | undefined) ?? '{}') as Record<string, number>;
  // حقل غير معروف يُسقط: عمود لا وجود له يُفشل الجملة كلها
  const known: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) if (key in PROFILE_COLUMNS) known[key] = patch[key];
  const merged = mergeFields(existing, revs, known, rev);

  await env.DB.prepare(
    `UPDATE profiles SET display_name = ?, avatar_key = ?, banner_key = ?, bio = ?, accent = ?, field_revs = ?, rev = ?
      WHERE user_id = ?`,
  )
    .bind(
      merged.value['displayName'] ?? null,
      merged.value['avatarKey'] ?? null,
      merged.value['bannerKey'] ?? null,
      merged.value['bio'] ?? null,
      merged.value['accent'] ?? null,
      JSON.stringify(merged.revs),
      rev,
      userId,
    )
    .run();
}

const MAX_OPS_PER_REQUEST = 200;

/**
 * تطبيق دفعة كتابة.
 *
 * كل عملية معرّفة بـop_id في applied_ops، فإعادة المحاولة بعد انقطاع الشبكة
 * لا تحتسب فصلًا مرتين ولا ترسل ترشيحًا مرتين.
 *
 * والأهم من الحجز نفسه أنه ذرّي مع الأثر: انظر التعليق قبل الدفعة أدناه.
 */
async function handleOps(request: Request, env: Env, userId: string, now: number): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { ops?: unknown } | null;
  const raw = Array.isArray(body?.ops) ? body.ops : null;
  if (!raw) return json({ error: 'bad_request' }, { status: 400 });
  if (raw.length > MAX_OPS_PER_REQUEST) return json({ error: 'too_many_ops' }, { status: 413 });

  const ops = dedupeOps(
    raw
      .map((entry): IncomingOp | null => {
        const record = entry as Record<string, unknown> | null;
        const opId = asString(record?.['opId'], 80);
        const kind = asString(record?.['kind'], 40);
        if (!opId || !kind) return null;
        const payload = (record?.['payload'] ?? {}) as Record<string, unknown>;
        return { opId, kind, payload };
      })
      .filter((op): op is IncomingOp => op !== null),
  );
  if (ops.length === 0) return json({ applied: [], skipped: [], cursor: await currentRev(env) });

  const rev = await allocateRev(env);

  // دمج الحقول يحتاج قراءة قبل الكتابة فلا يدخل الدفعة الذرّية. يُنفَّذ أولًا،
  // وإعادة تنفيذه بلا ضرر: نفس القيم الواردة تُكتب مرة أخرى فحسب.
  for (const op of ops) {
    if (FIELD_MERGE_KINDS.has(op.kind)) await applyFieldMerge(op, userId, rev, env);
  }

  // الأثر ثم الحجز، في دفعة واحدة.
  //
  // الترتيب هو كل شيء. الحجز في دفعة منفصلة قبل الأثر يعني أن فشل دفعة الأثر
  // يترك op_id محجوزًا بلا كتابة: إعادة محاولة العميل تُتجاهل، والكتابة تُفقد
  // بصمت — وهذا أسوأ عيب ممكن في المزامنة.
  //
  // D1 تنفّذ batch كمعاملة واحدة، فالأثر والحجز يثبتان معًا أو لا شيء منهما.
  // والأثر يسبق الحجز حتى يرى حرس `NOT EXISTS` في العمليات التراكمية حالة
  // ما قبل هذا الطلب: إعادة تسليم تجد op_id موجودًا من طلب سابق فلا تحتسب
  // مرتين. أما بقية العمليات فهي upsert بطبيعتها، وتكرارها بلا أثر.
  // قائمة الحسابات تُقرأ مرة واحدة وفقط إن احتاجتها عملية: توصية «للجميع»
  // مستلموها ليسوا في الحمولة. قراءتها دائمًا رحلة زائدة لكل طلب كتابة.
  const needsAccounts = ops.some((op) => ACCOUNT_AWARE_KINDS.has(op.kind));
  const ctx: OpContext = { accounts: needsAccounts ? await allAccountIds(env) : [] };

  const statements: D1PreparedStatement[] = [];
  for (const op of ops) {
    if (FIELD_MERGE_KINDS.has(op.kind)) continue;
    const built = statementsFor(op, userId, rev, now, env, ctx);
    if (built) statements.push(...built);
  }
  for (const op of ops) {
    statements.push(
      env.DB.prepare(
        'INSERT OR IGNORE INTO applied_ops (op_id, user_id, kind, rev, applied_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(op.opId, userId, op.kind, rev, now),
    );
  }
  await env.DB.batch(statements);

  // كلها مستقرّة الآن: العميل يُفرّغ طابوره. التمييز بين «طُبّقت» و«كانت
  // مطبَّقة» لا يغيّر شيئًا عنده، والحقلان يبقيان للتشخيص.
  return json({
    applied: ops.map((op) => op.opId),
    skipped: [],
    cursor: rev,
    serverRev: await currentRev(env),
  });
}

// ───────────────────────────── الحضور ─────────────────────────────

/**
 * نبضة حضور.
 *
 * لا ترفع rev: نبضة كل 25 ثانية × 3 مستخدمين تُبقي كل عميل يسحب فروقات إلى
 * الأبد. الحضور يُقرأ من مساره وحده، والحالة تُشتق من beat_at عند القراءة.
 */
async function handlePresenceBeat(
  request: Request,
  env: Env,
  userId: string,
  now: number,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const status = asString(body?.['status'], 16) ?? 'ONLINE';
  await env.DB.prepare(
    `INSERT INTO presence
       (user_id, status, screen, series_ref, series_title, chapter_ref, chapter_label, chapter_number, beat_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       status = excluded.status, screen = excluded.screen,
       series_ref = excluded.series_ref, series_title = excluded.series_title,
       chapter_ref = excluded.chapter_ref, chapter_label = excluded.chapter_label,
       chapter_number = excluded.chapter_number, beat_at = excluded.beat_at`,
  )
    .bind(
      userId,
      status === 'READING' ? 'READING' : 'ONLINE',
      asString(body?.['screen'], 24),
      asString(body?.['seriesId'] ?? body?.['seriesRef'], 200),
      asString(body?.['seriesTitle'], 300),
      asString(body?.['chapterId'] ?? body?.['chapterRef'], 200),
      asString(body?.['chapterLabel'], 120),
      asNumber(body?.['chapterNumber']),
      now,
    )
    .run();
  return json({ ok: true });
}

/**
 * الحضور كما يراه الآخرون.
 *
 * الإخفاء يُقرأ من `settings` في نفس المخزن الذي يملك الحضور. كان يعيش في
 * `vantara_user_gates` على مسار آخر: مخزن يملك الحضور ومخزن يملك خصوصيته يعني
 * أن إخفاءً مُفعَّلًا لا يُطبَّق على المسار الذي يستهلكه التطبيق فعلًا.
 */
async function handlePresenceList(env: Env, now: number): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT pr.user_id, a.username, p.display_name, p.avatar_key,
            pr.status, pr.screen, pr.series_ref, pr.series_title,
            pr.chapter_ref, pr.chapter_label, pr.chapter_number, pr.beat_at,
            s.data AS settings_data
       FROM presence pr
       JOIN accounts a USING (user_id)
       LEFT JOIN profiles p USING (user_id)
       LEFT JOIN settings s USING (user_id)`,
  ).all<Record<string, unknown>>();

  return json({
    content: results.map((row) => {
      const beatAt = Number(row['beat_at'] ?? 0);
      const live = statusFor(now - beatAt, { reading: row['status'] === 'READING' });
      const incognito = incognitoUntilFrom(row['settings_data']) > now;
      // قاعدة الحجب من دالة المجال وحدها: الوجود يبقى وما يُقرأ يُحجب
      const visible = redactForViewers(
        {
          userId: String(row['user_id']),
          username: String(row['username']),
          status: live,
          ...(row['series_title'] !== null ? { seriesTitle: String(row['series_title']) } : {}),
          ...(row['chapter_label'] !== null ? { chapterLabel: String(row['chapter_label']) } : {}),
        },
        { incognito },
      );
      // العمل والفصل يُعرضان فقط وهو يقرأ فعلًا: آخر فصل قرأه قبل ساعة ليس
      // «يقرأ الآن»، وعرضه هكذا يكذب على الأصدقاء
      const reading = visible.status === 'READING' && !incognito;
      return {
        userId: visible.userId,
        username: visible.username,
        displayName: row['display_name'] ?? row['username'],
        avatarKey: row['avatar_key'],
        status: visible.status,
        screen: incognito ? null : row['screen'],
        seriesRef: reading ? row['series_ref'] : null,
        seriesTitle: reading ? (visible.seriesTitle ?? null) : null,
        chapterLabel: reading ? (visible.chapterLabel ?? null) : null,
        chapterNumber: reading ? row['chapter_number'] : null,
        incognito,
        lastSeenAt: beatAt || null,
      };
    }),
  });
}

// ───────────────────── صندوق تقدم القراءة الصادر ─────────────────────

/**
 * ما لم يستلمه مالك التقدم بعد.
 *
 * بلا هذا المسار يبقى الصندوق مزخرفًا: صفوف تُكتب هنا ولا تُصرَّف أبدًا، فتقدم
 * كتابته فشلت عند المالك يضيع صامتًا بينما نسخته محفوظة عندنا. العميل يقرأه
 * عند الإقلاع، يدفع كل صف إلى المالك، ثم يرسل `progress.confirm`.
 *
 * السقف مقصود: التصريف عمل خلفية عند الإقلاع، لا مزامنة كاملة.
 */
async function handlePendingProgress(env: Env, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT chapter_key, series_ref, page, ratio, updated_at
       FROM progress
      WHERE user_id = ? AND owner_synced = 0
      ORDER BY updated_at
      LIMIT 200`,
  )
    .bind(userId)
    .all<Record<string, unknown>>();

  return json({
    owner: ownerOf('reading.progress'),
    content: results.map((row) => ({
      chapterKey: row['chapter_key'],
      seriesRef: row['series_ref'],
      page: Number(row['page'] ?? 0),
      ratio: Number(row['ratio'] ?? 0),
      updatedAt: Number(row['updated_at'] ?? 0),
    })),
  });
}

// ───────────────────────────── الإحصائيات ─────────────────────────────

async function handleStats(env: Env, targetId: string, now: number): Promise<Response> {
  const [reads, usage] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      'SELECT chapter_key, read_count FROM chapter_reads WHERE user_id = ? AND read_count > 0',
    ).bind(targetId),
    env.DB.prepare('SELECT day, active_ms FROM usage_daily WHERE user_id = ?').bind(targetId),
  ]);

  const stats = readStats(
    (reads?.results ?? []).map((row) => ({
      chapterKey: String(row['chapter_key']),
      readCount: Number(row['read_count'] ?? 0),
    })),
  );

  const today = new Date(now).toISOString().slice(0, 10);
  const weekStart = new Date(now - 6 * 86_400_000).toISOString().slice(0, 10);
  let todayMs = 0;
  let weekMs = 0;
  let totalMs = 0;
  for (const row of usage?.results ?? []) {
    const day = String(row['day']);
    const ms = Number(row['active_ms'] ?? 0);
    totalMs += ms;
    if (day === today) todayMs += ms;
    if (day >= weekStart) weekMs += ms;
  }

  return json({ userId: targetId, ...stats, usage: { todayMs, weekMs, totalMs } });
}

// ───────────────────────────── التوجيه ─────────────────────────────

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    // ساعة الخادم هي المرجع الوحيد: ساعات الهواتف الثلاثة لا تتفق
    const now = Date.now();

    try {
      if (path === '/health') {
        return json({ ok: true, protocol: SYNC_PROTOCOL, rev: await currentRev(env) }, {}, cors);
      }

      // بلا جلسة: ما تحتاجه شاشة اختيار الحساب فقط
      if (path === '/v1/accounts' && request.method === 'GET') {
        const response = await handleAccounts(env, now);
        return new Response(response.body, { status: response.status, headers: { ...JSON_HEADERS, ...cors } });
      }
      if (path === '/v1/session' && request.method === 'POST') {
        const response = await handleSession(request, env);
        return new Response(response.body, { status: response.status, headers: { ...JSON_HEADERS, ...cors } });
      }

      const token = bearerFrom(request);
      const userId = token ? await verifyToken(token, env.VANTARA_SESSION_SECRET) : null;
      if (!userId) return json({ error: 'unauthorized' }, { status: 401 }, cors);

      let response: Response | null = null;
      if (path === '/v1/sync' && request.method === 'GET') response = await handleSync(url, env);
      else if (path === '/v1/ops' && request.method === 'POST') response = await handleOps(request, env, userId, now);
      else if (path === '/v1/presence' && request.method === 'POST') response = await handlePresenceBeat(request, env, userId, now);
      else if (path === '/v1/presence' && request.method === 'GET') response = await handlePresenceList(env, now);
      else if (path === '/v1/progress/pending' && request.method === 'GET') {
        response = await handlePendingProgress(env, userId);
      }
      else if (path.startsWith('/v1/stats/') && request.method === 'GET') {
        response = await handleStats(env, decodeURIComponent(path.slice('/v1/stats/'.length)), now);
      }

      if (!response) return json({ error: 'not_found' }, { status: 404 }, cors);
      return new Response(response.body, { status: response.status, headers: { ...JSON_HEADERS, ...cors } });
    } catch (error) {
      // الرسالة لا تخرج: قد تحمل بنية الجدول أو جزءًا من قيمة
      console.error('sync-worker', error instanceof Error ? error.message : error);
      return json({ error: 'internal' }, { status: 500 }, cors);
    }
  },
};
