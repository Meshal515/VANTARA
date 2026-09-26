/**
 * VANTARA sync worker.
 *
 * نطاقه: الطبقة الاجتماعية والتقدم والإحصائيات لثلاثة مستخدمين، وذاكرة
 * الترجمة (`translate.ts`: نص ومناطق لا صور). صور الفصول وكاشها وكوكيز
 * المصادر تبقى على الهاتف؛ الصفحة تمرّ من هنا فقط حين تُطلب ترجمتها.
 *
 * القواعد الحاكمة مُختبرة في `@vantara/domain/sync`، وهذا الملف يطبّقها على
 * D1 ولا يعيد كتابتها. حيث يفرض SQL القاعدة بنفسه (MAX للتقدم، جمع للوقت)
 * تُستدعى دالة المجال للتحقق من المدخل، وتعليق يربط الاثنين.
 */

import { handleTranslateCached, handleTranslateGlossary, handleTranslateLearn, handleTranslateUsage, handleTranslatePage, handleTranslateText, translationAllowed, type TranslationEnv } from './translate.ts';
import {
  SYNC_PROTOCOL,
  clampUsageCredit,
  dedupeOps,
  isCompletedRead,
  mergeProgress,
  collectionView,
  isCollectionKind,
  needsFullResync,
  nextDeltaCursor,
  type DeltaPage,
  notificationId,
  notificationTargets,
  majlisAudience,
  hiddenToken,
  isMajlisReaction,
  isMajlisTarget,
  sniffImageType,
  isMediaHash,
  MAX_MEDIA_BYTES,
  MAX_MEDIA_BYTES_PER_USER,
  isRecommendationState,
  isRecommendationIntent,
  socialLinkFor,
  isSpoiler,
  fanoutBody,
  ownerOf,
  readStats,
  redactForViewers,
  statusFor,
  stripImmutable,
  summariseWeek,
  weekEnding,
  CORRELATION_HEADER,
  correlationIdFrom,
  frameLinkFor,
  normalizeFramePages,
} from '@vantara/domain';

import type { CollectionRow, WorkDescriptor } from '@vantara/domain';

import type { D1PreparedStatement, Env, ExecutionContext } from './types.ts';
import { handleRafiqConversations, handleRafiqExternal, handleRafiqFeedback, handleRafiqUsage, handleRafiqMessage, handleRafiqNew, handleRafiqPrefs, handleRafiqState, type RafiqEnv } from './rafiq.ts';
import { bearerFrom, verifyToken } from './session.ts';

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

async function currentRev(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT rev FROM sync_state WHERE id = 1').first<{ rev: number }>();
  return row?.rev ?? 0;
}

class DuplicateOpConflict extends Error {
  constructor() {
    super('duplicate_op_conflict');
    this.name = 'DuplicateOpConflict';
  }
}

/**
 * يثبت revision + حجز op_id + الأثر في معاملة D1 واحدة.
 *
 * نقرأ الرقم المتوقع خارج المعاملة، ثم CAS داخل batch. إن سبقنا كاتب آخر،
 * CHECK مسمّى يفجّر الدفعة كلها ونحاول من جديد. لذلك لا يمكن لـpull أن يرى
 * revision قبل الصفوف التابعة له، ولا يمكن لطلبين متزامنين بنفس op_id أن
 * يطبقا الأثر مرتين.
 */
async function commitAtNextRevision(
  env: Env,
  now: number,
  opIds: readonly string[],
  buildEffects: (rev: number) => D1PreparedStatement[],
): Promise<number> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const expected = await currentRev(env);
    const rev = expected + 1;
    const writer = crypto.randomUUID();
    const effects = buildEffects(rev);

    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        'UPDATE sync_state SET rev = ?, writer_token = ? WHERE id = 1 AND rev = ? AND writer_token IS NULL',
      ).bind(rev, writer, expected),
      env.DB.prepare(
        `INSERT INTO sync_tx_guard (token, ok)
         SELECT ?, CASE WHEN EXISTS (
           SELECT 1 FROM sync_state WHERE id = 1 AND rev = ? AND writer_token = ?
         ) THEN 1 ELSE 0 END`,
      ).bind(writer, rev, writer),
      ...opIds.map((opId) =>
        env.DB.prepare('INSERT INTO op_claims (op_id, claimed_at) VALUES (?, ?)').bind(opId, now),
      ),
      ...effects,
      env.DB.prepare('DELETE FROM sync_tx_guard WHERE token = ?').bind(writer),
      env.DB.prepare(
        'UPDATE sync_state SET writer_token = NULL WHERE id = 1 AND writer_token = ?',
      ).bind(writer),
    ];

    try {
      await env.DB.batch(statements);
      return rev;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('sync_tx_guard_ok')) continue;
      if (message.includes('op_claims.op_id')) throw new DuplicateOpConflict();
      throw error;
    }
  }
  throw new Error('sync_revision_contention');
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

// ───────────────────────────── السحب ─────────────────────────────

/**
 * من يرى هدفًا في المجلس. شرطٌ واحد يُستعمل في مكانين: نطاق السحب (فلا يصل
 * التفاعل لمن لا يرى هدفه) وكتابة التفاعل (فلا يتفاعل أحد مع ما لا يراه).
 * القيم بالترتيب: المشاهد، المشاهد، رمز إخفائه — لكل نوع.
 */
const MAJLIS_VISIBLE_IDS: Record<'frame' | 'rec' | 'activity', string> = {
  frame:
    "SELECT id FROM frames WHERE from_id = ? OR to_id = ? OR (audience = 'MAJLIS' AND instr(hidden_json, ?) = 0)",
  rec:
    "SELECT id FROM recommendations WHERE from_id = ? OR to_id = ? OR ((to_id IS NULL OR audience = 'MAJLIS') AND instr(hidden_json, ?) = 0)",
  activity: 'SELECT id FROM activity WHERE actor_id = ? OR target_user_id IS NULL OR target_user_id = ?',
};
/** أطول معرّف إشعار يُنشأ؛ وكل من يقرأ المعرّف أو يكتبه يلتزم به. */
const NOTIFICATION_ID_MAX = 250;

const MAJLIS_OWNER: Record<'frame' | 'rec' | 'activity', string> = {
  frame: 'SELECT from_id AS owner FROM frames WHERE id = ?',
  rec: 'SELECT from_id AS owner FROM recommendations WHERE id = ?',
  activity: 'SELECT actor_id AS owner FROM activity WHERE id = ?',
};
/** قيم شرط الرؤية بترتيب علامات `?` فيه. */
const majlisViewerValues = (kind: 'frame' | 'rec' | 'activity', userId: string) =>
  kind === 'activity' ? [userId, userId] : [userId, userId, hiddenToken(userId)];

/** جداول سجل الفروقات وأعمدتها. الحضور غائب بقصد: لا يلمس rev. */
const DELTA_TABLES = [
  ['accounts', 'user_id, username, created_at, rev'],
  ['profiles', 'user_id, display_name, avatar_key, banner_key, bio, accent, rev'],
  ['library', 'user_id, series_ref, series_title, cover_url, source_id, added_at, removed, rev'],
  [
    'frames',
    'id, from_id, to_id, source_id, series_title, chapter_label, cover_url, work_json, chapter_json, pages_json, message, created_at, rev, audience, hidden_json, broadcast',
  ],
  // `owner_synced` يسافر مع الصف: العميل يجب أن يعرف أن هذه القيمة لم يرها
  // مالك التقدم بعد، فيصالحها بدل أن يعرضها كحقيقة نهائية
  ['progress', 'user_id, chapter_key, series_ref, page, ratio, updated_at, rev, owner_synced'],
  ['chapter_marks', 'user_id, chapter_key, series_ref, read, updated_at, rev'],
  ['chapter_reads', 'user_id, chapter_key, series_ref, chapter_number, read_count, first_read_at, last_read_at, rev'],
  ['usage_daily', 'user_id, day, active_ms, rev'],
  ['collections', 'user_id, kind, series_ref, member, position, updated_at, rev'],
  ['completions', 'user_id, series_ref, member, updated_at, rev'],
  // وصف العمل مرة واحدة لكل عمل لا لكل مستخدم: الأصدقاء الثلاثة يرون نفس
  // الأعمال، وبلا هذا الجدول تعرض شاشة المفضلة معرّفًا خامًا
  ['works', 'series_ref, title, cover_url, source_id, updated_at, rev, editions_json'],
  ['ratings', 'user_id, series_ref, score, updated_at, rev'],
  ['comments', 'id, author_id, series_ref, chapter_ref, parent_id, body, spoiler, created_at, deleted, rev'],
  ['reactions', 'comment_id, user_id, emoji, active, rev'],
  ['recommendations', 'id, from_id, to_id, series_ref, series_title, cover_url, message, state, created_at, rev, audience, hidden_json, chapter_label, chapter_number'],
  ['majlis_reactions', 'target_kind, target_id, user_id, emoji, updated_at, rev'],
  ['majlis_receipts', 'target_kind, target_id, user_id, delivered_at, seen_at, rev'],
  // السجل يراه أصدقاؤك في ملفك كما تراه أنت: الأصدقاء الثلاثة مجلس واحد
  ['work_views', 'user_id, series_ref, series_title, cover_url, chapter_label, chapter_number, viewed_at, removed, rev'],
  ['recommendation_recipients', 'recommendation_id, user_id, state, intent, responded_at, rev'],
  // `seen` يسافر مع الصف: بلا «عُرض» يتكرر التنبيه الجانبي عند كل مزامنة،
  // أو يُعتبر العرضُ قراءةً فيختفي غير المقروء بلا أن يفتحه أحد
  ['notifications', 'id, user_id, kind, actor_id, series_ref, body, link, read, seen, created_at, rev'],
  ['activity', 'id, actor_id, verb, series_ref, target_user_id, link, payload, created_at, rev'],
  ['activity_receipts', 'event_id, user_id, delivered_at, seen_at, rev'],
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
async function handleSync(url: URL, env: Env, userId: string): Promise<Response> {
  const since = Number(url.searchParams.get('since') ?? '0');
  const cursor = Number.isFinite(since) && since > 0 ? Math.floor(since) : 0;
  const serverRev = await currentRev(env);

  // D1 مُستعادة من نسخة احتياطية: بلا هذا الفحص لا يرى العميل جديدًا أبدًا
  if (needsFullResync(cursor, serverRev)) {
    return json({ protocol: SYNC_PROTOCOL, reset: true, cursor: 0, serverRev, changes: {} });
  }

  // الفروقات نفسها حدّ أمان، لا مجرد transport. الصف الذي لا يحتاجه
  // هذا الحساب لا يصل إلى مرآته المحلية أصلًا؛ إخفاؤه في الواجهة بعد التنزيل
  // يعني أن البيانات كُشفت بالفعل.
  const deltaScope = (table: string): { sql: string; values: string[] } => {
    switch (table) {
      // المكتبة والقوائم ليست هنا بقصد: ملف صديقك يعرض ما يقرؤه ويؤجله وأكمله
      case 'progress':
      case 'chapter_marks':
      case 'settings':
      case 'notifications':
        return { sql: ' AND user_id = ?', values: [userId] };

      // المستلم يرى حالته فقط، والمرسل يحتاج حالات كل من أرسل إليهم.
      case 'recommendation_recipients':
        return {
          sql: ' AND (user_id = ? OR recommendation_id IN (SELECT id FROM recommendations WHERE from_id = ?))',
          values: [userId, userId],
        };

      // المجلس: المرسل والمستلم دائمًا، وبقية الأصدقاء إن كان الإرسال
      // للمجلس ولم يُخفَ عنهم. والفريم القديم (PRIVATE) يبقى بين اثنين.
      case 'frames':
        return {
          sql: " AND (from_id = ? OR to_id = ? OR (audience = 'MAJLIS' AND instr(hidden_json, ?) = 0))",
          values: [userId, userId, hiddenToken(userId)],
        };

      // التوصية: البثّ القديم للجميع كما كان، والموجّهة القديمة خاصة، والجديدة
      // للمجلس إلا من أُخفيت عنه.
      case 'recommendations':
        return {
          sql:
            " AND (from_id = ? OR to_id = ?" +
            " OR ((to_id IS NULL OR audience = 'MAJLIS') AND instr(hidden_json, ?) = 0))",
          values: [userId, userId, hiddenToken(userId)],
        };

      // النشاط الموجّه (رد/تفاعل/توصية لشخص) للفاعل والهدف فقط.
      case 'activity':
        return {
          sql: ' AND (actor_id = ? OR target_user_id IS NULL OR target_user_id = ?)',
          values: [userId, userId],
        };

      // التفاعل يراه من يرى هدفه، لا أكثر
      case 'majlis_reactions':
        return {
          sql:
            ` AND ((target_kind = 'frame' AND target_id IN (${MAJLIS_VISIBLE_IDS.frame}))` +
            ` OR (target_kind = 'rec' AND target_id IN (${MAJLIS_VISIBLE_IDS.rec}))` +
            ` OR (target_kind = 'activity' AND target_id IN (${MAJLIS_VISIBLE_IDS.activity})))`,
          values: [
            ...majlisViewerValues('frame', userId),
            ...majlisViewerValues('rec', userId),
            ...majlisViewerValues('activity', userId),
          ],
        };

      // إيصالات المجلس لصاحبها ولمرسل الرسالة وحده: «من شاف فريمي» سؤال المرسل
      case 'majlis_receipts':
        return {
          sql:
            " AND (user_id = ?" +
            " OR (target_kind = 'frame' AND target_id IN (SELECT id FROM frames WHERE from_id = ?))" +
            " OR (target_kind = 'rec' AND target_id IN (SELECT id FROM recommendations WHERE from_id = ?)))",
          values: [userId, userId, userId],
        };

      // المشاهد يرى إيصالاته، والفاعل يرى إيصالات حدثه لعرض delivered/seen.
      case 'activity_receipts':
        return {
          sql: ' AND (user_id = ? OR event_id IN (SELECT id FROM activity WHERE actor_id = ?))',
          values: [userId, userId],
        };

      default:
        return { sql: '', values: [] };
    }
  };

  const statements = DELTA_TABLES.map(([table, columns]) => {
    const scope = deltaScope(table);
    return env.DB.prepare(
      `SELECT ${columns} FROM ${table} WHERE rev > ?${scope.sql} ORDER BY rev LIMIT ${PAGE_SIZE}`,
    // سحبٌ كامل يبدأ من تحت الصفر: الحسابات الثلاثة وملفاتها زرعتها الهجرة
    // بـrev = 0، و`rev > 0` كان يُسقطها من كل جهاز — فتظهر «صديق» مكان الاسم
    // ويخلو المجلس من الوجوه حتى يعدّل صاحب الحساب ملفه
    ).bind(cursor === 0 ? -1 : cursor, ...scope.values);
  });
  const results = await env.DB.batch<Record<string, unknown>>(statements);

  const changes: Record<string, unknown[]> = {};
  const pages: DeltaPage[] = [];
  for (const [index, result] of results.entries()) {
    const entry = DELTA_TABLES[index];
    if (!entry) continue;
    const [table, columns] = entry;
    let rows = result.results ?? [];
    let truncated = rows.length >= PAGE_SIZE;

    // الـcursor عددي فقط، لذلك لا يجوز أن يقطع صفحة في منتصف مجموعة
    // تشترك في rev واحد. مثال قاتل: 499 صفًا على rev=10 ثم أول صف من مئة
    // على rev=11. لو رفعنا المؤشر إلى 11 تضيع التسعة والتسعون الباقية لأن
    // الجولة التالية تطلب `rev > 11`.
    //
    // عند بلوغ السقف نستنزف **مجموعة الـrev الأخيرة كاملة** ونستبدل بها
    // الجزء الذي وصل منها في الصفحة. هذا يعالج سواء كانت الصفحة كلها على
    // rev واحد أو بدأت بمراجعات أقدم ثم قُطعت داخل المراجعة الأخيرة.
    if (truncated && rows.length > 0) {
      const lastRev = Number(rows[rows.length - 1]?.['rev'] ?? 0);
      let boundaryStart = rows.length - 1;
      while (
        boundaryStart > 0 &&
        Number(rows[boundaryStart - 1]?.['rev'] ?? 0) === lastRev
      ) {
        boundaryStart -= 1;
      }

      const scope = deltaScope(table);
      const boundaryStatement = env.DB.prepare(
        `SELECT ${columns} FROM ${table} WHERE rev = ?${scope.sql} ORDER BY rev`,
      );
      const boundary = await boundaryStatement
        .bind(lastRev, ...scope.values)
        .all<Record<string, unknown>>();
      rows = [...rows.slice(0, boundaryStart), ...(boundary.results ?? rows.slice(boundaryStart))];

      // قد توجد مراجعات أعلى من lastRev؛ نبقي more=true فتُسحب في الجولة
      // التالية. وإن لم توجد، ستكون الجولة التالية فارغة وتلحق serverRev.
      truncated = true;
    }

    changes[table] = rows;
    let maxRev = cursor;
    for (const row of rows) {
      const rev = Number(row['rev'] ?? 0);
      if (rev > maxRev) maxRev = rev;
    }
    pages.push({ truncated, maxRev });
  }

  // المؤشر بعد قطعٍ هو أصغر ما بلغه جدولٌ مقطوع، لا أعلى rev في الدفعة:
  // السقف لكل جدول والمؤشر واحد. `nextDeltaCursor` تحمل القاعدة واختبارها.
  const next = nextDeltaCursor(pages, { cursor, serverRev });

  return json({
    protocol: SYNC_PROTOCOL,
    reset: false,
    cursor: next.cursor,
    serverRev,
    more: next.more,
    changes,
  });
}

// ───────────────────────────── الكتابة ─────────────────────────────

interface IncomingOp {
  opId: string;
  kind: string;
  payload: Record<string, unknown>;
}

async function appliedOpIds(ops: readonly IncomingOp[], env: Env): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(ops.map((op) => op.opId))];
  const CHUNK = 90;
  for (let offset = 0; offset < ids.length; offset += CHUNK) {
    const chunk = ids.slice(offset, offset + CHUNK);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT op_id FROM applied_ops WHERE op_id IN (${placeholders})`,
    )
      .bind(...chunk)
      .all<{ op_id: string }>();
    for (const row of results) out.add(row.op_id);
  }
  return out;
}

function asString(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * العمل كما يحتاجه محرّك المستلم ليطلب الفصل نفسه، لا أكثر.
 *
 * `memo` يعود كما خرج من المصدر (عقد lib 1.6). الوصف والتصنيفات تسقط: لا
 * يحتاجها القارئ الصغير، وتكبّر كل صف بلا فائدة.
 */
function frameWork(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const url = asString(v['url'], 1000);
  if (!url) return null;
  return {
    url,
    title: asString(v['title'], 300) ?? '',
    thumbnailUrl: asString(v['thumbnailUrl'], 600),
    memo: typeof v['memo'] === 'string' ? v['memo'].slice(0, 4000) : '',
  };
}

function frameChapter(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const url = asString(v['url'], 1000);
  if (!url) return null;
  const chapterNumber = typeof v['chapterNumber'] === 'number' && Number.isFinite(v['chapterNumber'])
    ? v['chapterNumber']
    : -1;
  return {
    url,
    name: asString(v['name'], 300) ?? '',
    chapterNumber,
    scanlator: asString(v['scanlator'], 200),
    memo: typeof v['memo'] === 'string' ? v['memo'].slice(0, 4000) : '',
  };
}

/**
 * نسخ العمل كما يرسلها العميل، مقصوصةً إلى ما يلزم لفتحها: المصدر ورابط
 * العمل عنده وعنوانه وغلافه و`memo`. لا فصول ولا نبذة — تلك تُجلب من المصدر.
 */
export const MAX_WORK_EDITIONS = 24;
/** فصول دفعة «قرأته كله» الواحدة. أكبر مانهوا عندنا دون ألفين. */
export const MAX_MARK_KEYS = 5000;
export function workEditions(value: unknown) {
  if (!Array.isArray(value)) return null;
  const out: Array<{ sourceId: string; label: string; manga: ReturnType<typeof frameWork> }> = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, MAX_WORK_EDITIONS)) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    const sourceId = asString(v['sourceId'], 120);
    const manga = frameWork(v['manga']);
    if (!sourceId || !manga || seen.has(sourceId)) continue;
    seen.add(sourceId);
    out.push({ sourceId, label: asString(v['label'], 60) ?? sourceId, manga });
  }
  return out.length ? out : null;
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
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
  /** metadata only for comments referenced by reply/reaction ops in this request */
  comments?: Readonly<Record<string, { authorId: string; seriesRef: string }>>;
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

function socialActivityStatements(
  db: Env['DB'],
  input: {
    opId: string;
    actorId: string;
    verb: string;
    accounts: readonly string[];
    seriesRef?: string | null;
    targetUserId?: string | null;
    link?: string | null;
    payload?: Record<string, unknown>;
    now: number;
    rev: number;
  },
): D1PreparedStatement[] {
  const eventId = `${input.opId}:activity`;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO activity
           (id, actor_id, verb, series_ref, target_user_id, link, payload, created_at, rev)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
      )
      .bind(
        eventId,
        input.actorId,
        input.verb,
        input.seriesRef ?? null,
        input.targetUserId ?? null,
        input.link ?? null,
        JSON.stringify(input.payload ?? {}),
        input.now,
        input.rev,
      ),
  ];

  const viewers = notificationTargets({
    accounts: input.accounts,
    actorId: input.actorId,
    // نشاط موجّه لشخص واحد لا يُنشئ receipts للصديق الثالث.
    to: input.targetUserId ?? null,
  });
  for (const viewer of viewers) {
    statements.push(
      db
        .prepare(
          `INSERT INTO activity_receipts
             (event_id, user_id, delivered_at, seen_at, rev)
           VALUES (?, ?, NULL, NULL, ?)
           ON CONFLICT (event_id, user_id) DO NOTHING`,
        )
        .bind(eventId, viewer, input.rev),
    );
  }

  return statements;
}

/**
 * يسجّل وصف العمل إن حملته العملية.
 *
 * كل عملية تشير إلى عمل تمرّ من هنا: العضوية والتوصية والإضافة للمكتبة. الوصف
 * الفارغ لا يكتب شيئًا، والقيمة الفارغة لا تمحو قيمة قائمة — `COALESCE` يمنع
 * مصدرًا يرجع بلا غلاف من محو غلاف وصلنا من مصدر آخر (نفس قاعدة `mergeWork`).
 */
function workStatements(
  db: Env['DB'],
  input: {
    seriesRef: string;
    title?: string | null;
    coverUrl?: string | null;
    sourceId?: string | null;
    now: number;
    rev: number;
  },
): D1PreparedStatement[] {
  // مرجعٌ داخلي ليس عنوانًا: جهازٌ لم يعرف اسم العمل لا يكتبه على الجميع
  const title = input.title && !/^ext:/i.test(input.title) ? input.title : null;
  input = { ...input, title };
  if (!input.title && !input.coverUrl && !input.sourceId) return [];
  return [
    db
      .prepare(
        `INSERT INTO works (series_ref, title, cover_url, source_id, updated_at, rev)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (series_ref) DO UPDATE SET
           title = COALESCE(excluded.title, works.title),
           cover_url = COALESCE(excluded.cover_url, works.cover_url),
           source_id = COALESCE(excluded.source_id, works.source_id),
           updated_at = MAX(works.updated_at, excluded.updated_at),
           rev = excluded.rev`,
      )
      .bind(
        input.seriesRef,
        input.title ?? null,
        input.coverUrl ?? null,
        input.sourceId ?? null,
        input.now,
        input.rev,
      ),
  ];
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
        // القراءة وحدها تكفي ليعرف الأصدقاء العمل باسمه وغلافه: عملٌ لم يُضف
        // للمكتبة كان يظهر في سجلّك عندهم بمرجعه الخام
        ...workStatements(db, {
          seriesRef,
          title: asString(p['seriesTitle'], 300),
          coverUrl: asString(p['coverUrl'], 600),
          now,
          rev,
        }),
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
        ...socialActivityStatements(db, {
          opId: op.opId,
          actorId: userId,
          verb: 'CHAPTER_DONE',
          accounts: ctx.accounts,
          seriesRef,
          link: socialLinkFor({ kind: 'work', seriesRef }),
          payload: { chapter: asNumber(p['chapterNumber']) },
          now,
          rev,
        }),
      ];
    }

    // عين الفصل: علامة شخصية تُلغى بلمسة. لا تمسّ chapter_reads (إحصاء
    // القراءة الكاملة) ولا تُعلن شيئًا للأصدقاء.
    case 'chapter.mark': {
      const chapterKey = asString(p['chapterKey'], 200);
      const seriesRef = asString(p['seriesRef'], 200);
      const read = p['read'];
      if (!chapterKey || !seriesRef || typeof read !== 'boolean') return null;
      return [
        db
          .prepare(
            `INSERT INTO chapter_marks (user_id, chapter_key, series_ref, read, updated_at, rev)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (user_id, chapter_key) DO UPDATE SET
               read = excluded.read,
               updated_at = excluded.updated_at,
               rev = excluded.rev`,
          )
          .bind(userId, chapterKey, seriesRef, read ? 1 : 0, now, rev),
      ];
    }

    /**
     * عين الفصل لكثير من الفصول دفعة واحدة: «قرأته كله»، «من ← إلى»، أو
     * «ألغِ التعليم». عبارة SQL واحدة مهما كثرت الفصول (`json_each`) — ألف
     * فصل ليست ألف عملية في الطابور ولا ألف عبارة عند الخادم. و`all` مع
     * `read: false` يمسح تعليم العمل كله بلا قائمة.
     */
    case 'chapter.markMany': {
      const seriesRef = asString(p['seriesRef'], 200);
      const read = p['read'];
      if (!seriesRef || typeof read !== 'boolean') return null;
      if (p['all'] === true && read === false) {
        return [
          db
            .prepare(
              `UPDATE chapter_marks SET read = 0, updated_at = ?, rev = ?
                WHERE user_id = ? AND series_ref = ? AND read = 1`,
            )
            .bind(now, rev, userId, seriesRef),
        ];
      }
      const keys = Array.isArray(p['keys'])
        ? [...new Set(p['keys'].map((k) => asString(k, 200)).filter((k): k is string => Boolean(k)))].slice(0, MAX_MARK_KEYS)
        : [];
      if (!keys.length) return null;
      return [
        db
          .prepare(
            `INSERT INTO chapter_marks (user_id, chapter_key, series_ref, read, updated_at, rev)
             SELECT ?, value, ?, ?, ?, ? FROM json_each(?) WHERE true
             ON CONFLICT (user_id, chapter_key) DO UPDATE SET
               read = excluded.read, updated_at = excluded.updated_at, rev = excluded.rev
             WHERE chapter_marks.read != excluded.read`,
          )
          .bind(userId, seriesRef, read ? 1 : 0, now, rev, JSON.stringify(keys)),
      ];
    }

    case 'usage.add': {
      const ms = clampUsageCredit(asNumber(p['activeMs']) ?? 0);
      if (ms <= 0) return null;
      const suppliedDay = p['day'];
      const day = suppliedDay == null
        ? new Date(now).toISOString().slice(0, 10)
        : asString(suppliedDay, 10);
      const today = new Date(now).toISOString().slice(0, 10);
      if (!day || !isIsoDay(day) || day > today) return null;
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
        ...workStatements(db, {
          seriesRef,
          title: asString(p['seriesTitle'], 300),
          coverUrl: asString(p['coverUrl'], 600),
          sourceId: asString(p['sourceId'], 120),
          now,
          rev,
        }),
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
        ...socialActivityStatements(db, {
          opId: op.opId,
          actorId: userId,
          verb: 'LIBRARY_ADD',
          accounts: ctx.accounts,
          seriesRef,
          link: socialLinkFor({ kind: 'work', seriesRef }),
          payload: { title: asString(p['seriesTitle'], 300) },
          now,
          rev,
        }),
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

    // «أكملته»: جدول مستقل، والوصف يرافقه كما يرافق القوائم
    case 'completed.set': {
      const seriesRef = asString(p['seriesRef'], 200);
      if (!seriesRef) return null;
      return [
        ...workStatements(db, {
          seriesRef,
          title: asString(p['seriesTitle'], 300),
          coverUrl: asString(p['coverUrl'], 600),
          sourceId: asString(p['sourceId'], 120),
          now,
          rev,
        }),
        db
          .prepare(
            `INSERT INTO completions (user_id, series_ref, member, updated_at, rev)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (user_id, series_ref) DO UPDATE SET
               member = excluded.member, updated_at = excluded.updated_at, rev = excluded.rev`,
          )
          .bind(userId, seriesRef, p['member'] === false ? 0 : 1, now, rev),
      ];
    }

    case 'favorite.set':
    case 'readLater.set':
    case 'top.set': {
      const seriesRef = asString(p['seriesRef'], 200);
      if (!seriesRef) return null;
      // `top.set` هي «أفضل 5» (§9). تمرّ بنفس مسار المجموعات بقصد: نفس
      // الموضع ونفس `collection.reorder` ونفس وصف العمل — لا نظام موازٍ.
      const kind =
        op.kind === 'favorite.set' ? 'favorite' : op.kind === 'top.set' ? 'top' : 'read_later';
      // نوع المجموعة من طبقة المجال: قائمة مغلقة، فلا يخلق عميل قديم نوعًا
      // ثالثًا لا تعرفه أي شاشة
      if (!isCollectionKind(kind)) return null;
      const member = p['member'] === false ? 0 : 1;
      return [
        // الوصف يرافق العضوية: بلا هذا لا يوجد عنوان ولا غلاف لعمل أُضيف
        // للمفضلة من صفحته، فتعرض الشاشة معرّفًا خامًا
        ...workStatements(db, {
          seriesRef,
          title: asString(p['seriesTitle'], 300),
          coverUrl: asString(p['coverUrl'], 600),
          sourceId: asString(p['sourceId'], 120),
          now,
          rev,
        }),
        db
          .prepare(
            `INSERT INTO collections (user_id, kind, series_ref, member, position, updated_at, rev)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (user_id, kind, series_ref) DO UPDATE SET
               member = excluded.member,
               -- الموضع لا يُمحى بعملية لا تحمله: إعادة الإضافة لا تفقد الترتيب
               position = COALESCE(excluded.position, collections.position),
               updated_at = excluded.updated_at,
               rev = excluded.rev`,
          )
          .bind(userId, kind, seriesRef, member, asNumber(p['position']), now, rev),
        ...(op.kind === 'favorite.set' && member === 1
          ? socialActivityStatements(db, {
              opId: op.opId,
              actorId: userId,
              verb: 'FAVORITED',
              accounts: ctx.accounts,
              seriesRef,
              link: socialLinkFor({ kind: 'work', seriesRef }),
              now,
              rev,
            })
          : []),
      ];
    }

    /**
     * ترتيب المجموعة.
     *
     * الترتيب الكامل يصل مرة واحدة (`order: [seriesRef, ...]`) لا حركة عنصر:
     * حركتان من جهازين تتشابكان، أما ترتيب كامل فآخر واحد يفوز ويبقى مفهومًا.
     */
    case 'collection.reorder': {
      const kind = asString(p['kind'], 20);
      const order = Array.isArray(p['order']) ? p['order'] : null;
      if (!kind || !isCollectionKind(kind) || !order || order.length > 100) return null;
      // السقف 100 لا 500: كل مرجع جملة `UPDATE` في نفس الدفعة الذرّية. لا
      // نقتطع الطلب بصمت: تطبيق أول 100 ثم إقرار العملية يفقد بقية الترتيب.
      const refs = order
        .map((value) => asString(value, 200))
        .filter((value): value is string => value !== null);
      if (refs.length === 0) return null;
      return refs.map((seriesRef, position) =>
        db
          .prepare(
            `UPDATE collections SET position = ?, updated_at = ?, rev = ?
              WHERE user_id = ? AND kind = ? AND series_ref = ?`,
          )
          .bind(position, now, rev, userId, kind, seriesRef),
      );
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
        ...socialActivityStatements(db, {
          opId: op.opId,
          actorId: userId,
          verb: 'RATED_WORK',
          accounts: ctx.accounts,
          seriesRef,
          link: socialLinkFor({ kind: 'work', seriesRef }),
          payload: { score },
          now,
          rev,
        }),
      ];
    }

    case 'comment.add': {
      const seriesRef = asString(p['seriesRef'], 200);
      const body = asString(p['body'], 4000);
      if (!seriesRef || !body) return null;
      const parentId = asString(p['parentId'], 80);
      const parent = parentId ? ctx.comments?.[parentId] : undefined;
      // بعد restore قد يشير الطابور إلى أب لم يعد موجودًا؛ أو قد يرسل عميل
      // معطوب parent من عمل آخر. في الحالتين نعزل هذه العملية وحدها.
      if (parentId && (!parent || parent.seriesRef !== seriesRef)) return null;
      const link = socialLinkFor({ kind: 'comment', seriesRef, commentId: op.opId });
      // الحرق قرار الكاتب وحده، ويُقرأ صريحًا: أي شيء غير `true` ليس حرقًا
      const spoiler = isSpoiler(p['spoiler']);
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO comments
               (id, author_id, series_ref, chapter_ref, parent_id, body, spoiler, created_at, deleted, rev)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
             ON CONFLICT (id) DO NOTHING`,
          )
          .bind(
            op.opId,
            userId,
            seriesRef,
            asString(p['chapterRef'], 200),
            parentId,
            body,
            spoiler ? 1 : 0,
            now,
            rev,
          ),
        ...socialActivityStatements(db, {
          opId: op.opId,
          actorId: userId,
          verb: 'COMMENTED',
          accounts: ctx.accounts,
          seriesRef,
          targetUserId: parent && parent.authorId !== userId ? parent.authorId : null,
          link,
          payload: {
            commentId: op.opId,
            chapterRef: asString(p['chapterRef'], 200),
            parentId,
          },
          now,
          rev,
        }),
      ];

      if (parent && parent.authorId !== userId) {
        statements.push(
          ...notificationStatements(db, {
            opId: op.opId,
            kind: 'COMMENT_REPLY',
            recipients: [parent.authorId],
            actorId: userId,
            seriesRef,
            // الإشعار لا زرّ كشف فيه، فلا يحمل نصّ تعليق محروق أبدًا: صفّ
            // الإشعار يُكتب بلا نصٍّ من أصله، لا يُخفى في الواجهة
            body: fanoutBody({ body, spoiler }),
            link,
            now,
            rev,
          }),
        );
      }

      return statements;
    }

    case 'reaction.set': {
      const commentId = asString(p['commentId'], 80);
      const emoji = asString(p['emoji'], 16);
      if (!commentId || !emoji) return null;
      const comment = ctx.comments?.[commentId];
      // FK قديم بعد restore لا يجوز أن يسقط batch كاملة.
      if (!comment) return null;
      const active = p['active'] === false ? 0 : 1;
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO reactions (comment_id, user_id, emoji, active, rev)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (comment_id, user_id, emoji) DO UPDATE SET
               active = excluded.active, rev = excluded.rev`,
          )
          .bind(commentId, userId, emoji, active, rev),
      ];

      if (comment) {
        const link = socialLinkFor({
          kind: 'reaction',
          seriesRef: comment.seriesRef,
          commentId,
        });
        statements.push(
          ...socialActivityStatements(db, {
            opId: op.opId,
            actorId: userId,
            verb: 'REACTED',
            accounts: ctx.accounts,
            seriesRef: comment.seriesRef,
            targetUserId: comment.authorId !== userId ? comment.authorId : null,
            link,
            payload: { commentId, emoji, active: active === 1 },
            now,
            rev,
          }),
        );
        if (comment.authorId !== userId && active === 1) {
          statements.push(
            ...notificationStatements(db, {
              opId: op.opId,
              kind: 'REACTION',
              recipients: [comment.authorId],
              actorId: userId,
              seriesRef: comment.seriesRef,
              body: emoji,
              link,
              now,
              rev,
            }),
          );
        }
      }

      return statements;
    }

    case 'recommendation.send': {
      const seriesRef = asString(p['seriesRef'], 200);
      const toId = asString(p['toId'], 80);
      if (!seriesRef) return null;
      const audience = majlisAudience({ accounts: ctx.accounts, actorId: userId, toId, hiddenFrom: p['hiddenFrom'] });
      if (!audience) return null;
      const { recipients, hidden } = audience;
      const link = socialLinkFor({ kind: 'recommendation', seriesRef });
      const statements: D1PreparedStatement[] = [
        ...workStatements(db, {
          seriesRef,
          title: asString(p['seriesTitle'], 300),
          coverUrl: asString(p['coverUrl'], 600),
          now,
          rev,
        }),
        db
          .prepare(
            `INSERT INTO recommendations
               (id, from_id, to_id, series_ref, series_title, cover_url, message, state, created_at, rev,
                audience, hidden_json, chapter_label, chapter_number)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'SENT', ?, ?, 'MAJLIS', ?, ?, ?)
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
            JSON.stringify(hidden),
            // ترشيح فصلٍ بعينه («اقرأ الفصل 110»)، أو العمل كله إن غابا
            asString(p['chapterLabel'], 120),
            asNumber(p['chapterNumber']),
          ),
      ];

      for (const recipient of recipients) {
        statements.push(
          db
            .prepare(
              `INSERT INTO recommendation_recipients
                 (recommendation_id, user_id, state, intent, responded_at, rev)
               VALUES (?, ?, ?, NULL, NULL, ?)
               ON CONFLICT (recommendation_id, user_id) DO NOTHING`,
            )
            .bind(op.opId, recipient, 'PENDING', rev),
        );
      }

      // سجل النشاط لا يعرف الإخفاء: بثٌّ أُخفي عن أحد لا يُعلَن فيه، والمجلس
      // يقرأ التوصية نفسها بإخفائها
      statements.push(
        ...(hidden.length && !toId ? [] : socialActivityStatements(db, {
          opId: op.opId,
          actorId: userId,
          verb: 'RECOMMENDATION',
          accounts: ctx.accounts,
          seriesRef,
          targetUserId: toId,
          link,
          payload: { message: asString(p['message'], 500) },
          now,
          rev,
        })),
        ...notificationStatements(db, {
          opId: op.opId,
          kind: 'RECOMMENDATION',
          recipients,
          actorId: userId,
          seriesRef,
          body: asString(p['message'], 500),
          link,
          now,
          rev,
        }),
      );
      return statements;
    }

    // «فريم»: صفحات من فصل لصديق واحد. مراجع لا صور — المستلم يجلبها من
    // المصدر بمحرّكه. لا «للجميع» هنا بخلاف التوصية: الفريم لقطةٌ لشخص.
    // تفاعل في المجلس. يُكتب فقط إن كان الهدف مرئيًّا لصاحب التفاعل (شرط
    // النطاق نفسه في SQL)، وصاحب الهدف يُبلَّغ — إلا أن يتفاعل مع نفسه.
    case 'majlis.react': {
      const targetKind = p['targetKind'];
      const targetId = asString(p['targetId'], 200);
      const emoji = p['emoji'] ?? null;
      if (!isMajlisTarget(targetKind) || !targetId) return null;
      if (emoji !== null && !isMajlisReaction(emoji)) return null;
      const visible = MAJLIS_VISIBLE_IDS[targetKind];
      const values = majlisViewerValues(targetKind, userId);
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO majlis_reactions (target_kind, target_id, user_id, emoji, updated_at, rev)
             SELECT ?, ?, ?, ?, ?, ?
              WHERE ? IN (${visible})
             ON CONFLICT (target_kind, target_id, user_id) DO UPDATE SET
               emoji = excluded.emoji, updated_at = excluded.updated_at, rev = excluded.rev`,
          )
          .bind(targetKind, targetId, userId, emoji, now, rev, targetId, ...values),
      ];
      if (emoji !== null) {
        statements.push(
          db
            .prepare(
              `INSERT INTO notifications
                 (id, user_id, kind, actor_id, series_ref, body, link, read, seen, created_at, rev)
               SELECT ?, owner, 'REACTION', ?, NULL, ?, ?, 0, 0, ?, ?
                 FROM (${MAJLIS_OWNER[targetKind]})
                WHERE owner != ? AND ? IN (${visible})
               ON CONFLICT (id) DO UPDATE SET
                 body = excluded.body, created_at = excluded.created_at, rev = excluded.rev,
                 -- نفس الرمز مرة ثانية ليس إشعارًا جديدًا: ما قرأته يبقى مقروءًا
                 read = CASE WHEN notifications.body IS excluded.body THEN notifications.read ELSE 0 END,
                 seen = CASE WHEN notifications.body IS excluded.body THEN notifications.seen ELSE 0 END
               WHERE notifications.body IS NOT excluded.body OR notifications.read = 0`,
            )
            // إشعار واحد لكل شخص على كل هدف: تغيير التفاعل يحدّثه ولا يكرّره
            .bind(
              `react:${targetKind}:${targetId}:${userId}`.slice(0, NOTIFICATION_ID_MAX),
              userId,
              emoji,
              `vantara://majlis/${targetKind}/${targetId}`,
              now,
              rev,
              targetId,
              userId,
              targetId,
              ...values,
            ),
        );
      }
      return statements;
    }

    /**
     * وصلت الرسالة جهازي (`seen: false`)، أو ظهرت أمامي (`seen: true`).
     *
     * لا يرجع للخلف ولا يلمس `rev` حين لا جديد: جهازٌ يعيد الإيصال عند كل
     * رسم لا يولّد فروقات لأحد. والمرسل لا يكتب إيصالًا على رسالته، ومن
     * أُخفيت عنه لا يكتب شيئًا (نفس شرط الرؤية في SQL).
     */
    case 'majlis.receipt': {
      const targetKind = p['targetKind'];
      const targetId = asString(p['targetId'], 200);
      if ((targetKind !== 'frame' && targetKind !== 'rec') || !targetId) return null;
      const seenAt = p['seen'] === true ? now : null;
      const visible = MAJLIS_VISIBLE_IDS[targetKind];
      return [
        db
          .prepare(
            `INSERT INTO majlis_receipts (target_kind, target_id, user_id, delivered_at, seen_at, rev)
             SELECT ?, ?, ?, ?, ?, ?
              WHERE ? IN (${visible})
                AND NOT EXISTS (SELECT 1 FROM (${MAJLIS_OWNER[targetKind]}) WHERE owner = ?)
             ON CONFLICT (target_kind, target_id, user_id) DO UPDATE SET
               delivered_at = COALESCE(majlis_receipts.delivered_at, excluded.delivered_at),
               seen_at = COALESCE(majlis_receipts.seen_at, excluded.seen_at),
               rev = excluded.rev
             WHERE majlis_receipts.seen_at IS NULL AND excluded.seen_at IS NOT NULL`,
          )
          .bind(targetKind, targetId, userId, now, seenAt, rev, targetId, ...majlisViewerValues(targetKind, userId), targetId, userId),
      ];
    }

    case 'frame.send': {
      // `toId` غائب = الجميع. والفريم يظهر في المجلس إلا لمن أُخفي عنه
      const toId = asString(p['toId'], 80);
      const sourceId = asString(p['sourceId'], 200);
      const work = frameWork(p['work']);
      const chapter = frameChapter(p['chapter']);
      const pages = normalizeFramePages(p['pages']);
      if (!sourceId || !work || !chapter || !pages) return null;
      const audience = majlisAudience({ accounts: ctx.accounts, actorId: userId, toId, hiddenFrom: p['hiddenFrom'] });
      if (!audience) return null;
      const { recipients, hidden } = audience;
      const link = frameLinkFor(op.opId);
      const message = asString(p['message'], 500);
      return [
        db
          .prepare(
            `INSERT INTO frames
               (id, from_id, to_id, source_id, series_title, chapter_label, cover_url,
                work_json, chapter_json, pages_json, message, created_at, rev, audience, hidden_json, broadcast)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MAJLIS', ?, ?)
             ON CONFLICT (id) DO NOTHING`,
          )
          .bind(
            op.opId,
            userId,
            // البثّ: `to_id` هو المرسل (القيد NOT NULL باقٍ)، و`broadcast` يقول «للجميع»
            toId ?? userId,
            sourceId,
            work.title,
            chapter.name,
            work.thumbnailUrl,
            JSON.stringify(work),
            JSON.stringify(chapter),
            JSON.stringify(pages),
            message,
            now,
            rev,
            JSON.stringify(hidden),
            toId ? 0 : 1,
          ),
        ...notificationStatements(db, {
          opId: op.opId,
          kind: 'FRAME',
          recipients,
          actorId: userId,
          body: message ?? work.title,
          link,
          now,
          rev,
        }),
      ];
    }

    case 'recommendation.respond': {
      const recommendationId = asString(p['recommendationId'], 80);
      const state = asString(p['state'], 20);
      const intent = asString(p['intent'], 32);
      if (!recommendationId || !state || !isRecommendationState(state) || state === 'PENDING') {
        return null;
      }
      if (intent && !isRecommendationIntent(intent)) return null;
      if (state === 'REJECTED' && intent) return null;

      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `UPDATE recommendation_recipients
                SET state = ?,
                    intent = CASE WHEN ? IS NULL THEN intent ELSE ? END,
                    responded_at = COALESCE(responded_at, ?),
                    rev = ?
              WHERE recommendation_id = ? AND user_id = ?
                AND (state = 'PENDING' OR (state = 'ACCEPTED' AND ? = 'ACCEPTED'))
                AND NOT EXISTS (SELECT 1 FROM applied_ops WHERE op_id = ?)`,
          )
          .bind(
            state,
            intent,
            intent,
            now,
            rev,
            recommendationId,
            userId,
            state,
            op.opId,
          ),
      ];

      if (state === 'ACCEPTED' && intent === 'WATCH_LATER') {
        statements.push(
          db
            .prepare(
              `INSERT INTO collections (user_id, kind, series_ref, member, position, updated_at, rev)
               SELECT ?, ?, r.series_ref, 1, NULL, ?, ?
                 FROM recommendation_recipients rr
                 JOIN recommendations r ON r.id = rr.recommendation_id
                WHERE rr.recommendation_id = ?
                  AND rr.user_id = ?
                  AND rr.state = 'ACCEPTED'
                  AND rr.intent = 'WATCH_LATER'
                  AND NOT EXISTS (SELECT 1 FROM applied_ops WHERE op_id = ?)
               ON CONFLICT (user_id, kind, series_ref) DO UPDATE SET
                 member = 1,
                 updated_at = excluded.updated_at,
                 rev = excluded.rev`,
            )
            .bind(
              userId,
              'read_later',
              now,
              rev,
              recommendationId,
              userId,
              op.opId,
            ),
        );
      }

      return statements;
    }

    case 'activity.delivered': {
      const eventId = asString(p['eventId'], 100);
      if (!eventId) return null;
      return [
        db
          .prepare(
            `UPDATE activity_receipts
                SET delivered_at = COALESCE(delivered_at, ?), rev = ?
              WHERE event_id = ? AND user_id = ?
                AND NOT EXISTS (SELECT 1 FROM applied_ops WHERE op_id = ?)`,
          )
          .bind(now, rev, eventId, userId, op.opId),
      ];
    }

    case 'activity.seen': {
      const eventId = asString(p['eventId'], 100);
      if (!eventId) return null;
      return [
        db
          .prepare(
            `UPDATE activity_receipts
                SET delivered_at = COALESCE(delivered_at, ?),
                    seen_at = COALESCE(seen_at, ?),
                    rev = ?
              WHERE event_id = ? AND user_id = ?
                AND NOT EXISTS (SELECT 1 FROM applied_ops WHERE op_id = ?)`,
          )
          .bind(now, now, rev, eventId, userId, op.opId),
      ];
    }

    /**
     * فتح الإشعار.
     *
     * القراءة تعني العرض ضمنًا، فتُكتب `seen` معها: بلا ذلك يبقى صفٌّ مقروء
     * بلا «عُرض»، ومزامنة جهاز آخر تراه «وصل الآن» فتُظهر تنبيهه من جديد.
     * ولا تُنقص أبدًا: `MAX` يحمي من إقرار متأخر يرجع بالحالة للخلف.
     */
    case 'notification.read': {
      // بطول ما يُنشأ به (حتى 250): معرّف تفاعلٍ على نشاط ≈ 97 حرفًا، وقصّه
      // يجعل التحديث لا يطابق شيئًا فيرجع الإشعار غير مقروء بصمت
      const id = asString(p['id'], NOTIFICATION_ID_MAX);
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
      const id = asString(p['id'], NOTIFICATION_ID_MAX);
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

    /**
     * فتحتُ عملًا أو قرأت فيه. العنوان والفصل آخر ما وصل، والوقت لا يرجع:
     * جهازٌ متأخر يرسل فتحة أقدم لا يُنزل العمل في السجل. وفتحةٌ بعد الحذف
     * تعيده، كأي فتحة جديدة.
     */
    case 'view.add': {
      const seriesRef = asString(p['seriesRef'], 200);
      if (!seriesRef) return null;
      const title = asString(p['seriesTitle'], 300);
      const coverUrl = asString(p['coverUrl'], 600);
      const at = Math.min(asNumber(p['at']) ?? now, now);
      return [
        ...workStatements(db, { seriesRef, title, coverUrl, now, rev }),
        db
          .prepare(
            `INSERT INTO work_views
               (user_id, series_ref, series_title, cover_url, chapter_label, chapter_number, viewed_at, removed, rev)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
             ON CONFLICT (user_id, series_ref) DO UPDATE SET
               series_title = COALESCE(excluded.series_title, work_views.series_title),
               cover_url = COALESCE(excluded.cover_url, work_views.cover_url),
               chapter_label = COALESCE(excluded.chapter_label, work_views.chapter_label),
               chapter_number = COALESCE(excluded.chapter_number, work_views.chapter_number),
               viewed_at = MAX(work_views.viewed_at, excluded.viewed_at),
               removed = CASE WHEN excluded.viewed_at > work_views.viewed_at THEN 0 ELSE work_views.removed END,
               rev = excluded.rev`,
          )
          .bind(
            userId,
            seriesRef,
            title && !/^ext:/i.test(title) ? title : null,
            coverUrl,
            asString(p['chapterLabel'], 120),
            asNumber(p['chapterNumber']),
            at,
            rev,
          ),
      ];
    }

    case 'view.remove': {
      const seriesRef = asString(p['seriesRef'], 200);
      if (!seriesRef) return null;
      return [
        db
          .prepare(
            `INSERT INTO work_views (user_id, series_ref, viewed_at, removed, rev)
             VALUES (?, ?, ?, 1, ?)
             ON CONFLICT (user_id, series_ref) DO UPDATE SET removed = 1, viewed_at = MAX(work_views.viewed_at, excluded.viewed_at), rev = excluded.rev`,
          )
          .bind(userId, seriesRef, now, rev),
      ];
    }

    /**
     * وصف العمل ونسخه في المصادر، من جهاز فتحه.
     *
     * النسخ تُدمج لا تُستبدل: جهازٌ عرف ثلاث نسخ وآخر عرف خمسًا غيرها يبنيان
     * معًا قائمة واحدة، والمصدر نفسه يأخذ آخر ما وصل عنه. `json_each` يفكّ
     * القائمتين في SQL نفسه، فلا قراءة قبل الكتابة ولا سباق بين جهازين.
     */
    case 'work.describe': {
      const seriesRef = asString(p['seriesRef'], 200);
      if (!seriesRef) return null;
      const title = asString(p['title'], 300);
      const coverUrl = asString(p['coverUrl'], 600);
      const editions = workEditions(p['editions']);
      if (!title && !coverUrl && !editions) return null;
      const statements = [
        ...workStatements(db, { seriesRef, title, coverUrl, sourceId: editions?.[0]?.sourceId ?? null, now, rev }),
      ];
      if (editions) {
        const incoming = JSON.stringify(editions);
        statements.push(
          db
            .prepare(
              `UPDATE works SET
                 editions_json = (
                   SELECT json_group_array(json(value)) FROM (
                     SELECT value FROM json_each(?)
                     UNION ALL
                     SELECT old.value FROM json_each(COALESCE(works.editions_json, '[]')) AS old
                      WHERE json_extract(old.value, '$.sourceId') NOT IN (
                        SELECT json_extract(value, '$.sourceId') FROM json_each(?)
                      )
                     LIMIT ${MAX_WORK_EDITIONS}
                   )
                 ),
                 updated_at = MAX(updated_at, ?),
                 rev = ?
               WHERE series_ref = ?`,
            )
            .bind(incoming, incoming, now, rev, seriesRef),
        );
      }
      return statements;
    }

    case 'activity.add': {
      // Deprecated compatibility op. handleOps settles it as skipped so an old
      // APK drains its queue, but client-authored activity is never published.
      return null;
    }

    default:
      return null;
  }
}

/** التعديلات التي تحتاج قراءة قبل الكتابة: rev لكل حقل مخزّن كـJSON. */
const FIELD_MERGE_KINDS = new Set(['profile.patch', 'settings.patch']);
/** عميل قديم قد يرسلها؛ تُصرَّف بلا نشر لأن النشاط يولّده الخادم فقط. */
const DEPRECATED_NOOP_KINDS = new Set(['activity.add']);

/** العمليات التي تحتاج قائمة الحسابات (بثّ لكل المستلمين). */
const ACCOUNT_AWARE_KINDS = new Set([
  'recommendation.send',
  'frame.send',
  'rating.set',
  'comment.add',
  'reaction.set',
  'chapter.complete',
  'library.add',
  'favorite.set',
]);

async function allAccountIds(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT user_id FROM accounts').all<{ user_id: string }>();
  return results.map((row) => row.user_id);
}

/**
 * يجمع metadata خارجية تحتاجها ترجمة العمليات قبل بناء الدفعة الذرّية.
 *
 * لا query لكل عملية: مراجع التعليقات تُنزع تكراراتها وتُقرأ على دفعات صغيرة
 * حتى لا نصنع IN clause ضخمة. العمليات التي لا تشير إلى تعليق لا تلمس الجدول.
 */
export async function invalidRecommendationResponses(
  ops: readonly IncomingOp[],
  userId: string,
  env: Env,
): Promise<Set<string>> {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const op of ops) {
    if (op.kind !== 'recommendation.respond') continue;
    const id = asString(op.payload['recommendationId'], 80);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  if (ids.length === 0) return new Set();

  const rows = new Map<string, string | null>();
  const CHUNK = 90;
  for (let offset = 0; offset < ids.length; offset += CHUNK) {
    const chunk = ids.slice(offset, offset + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT r.id, rr.user_id AS recipient_user_id
         FROM recommendations r
         LEFT JOIN recommendation_recipients rr
           ON rr.recommendation_id = r.id
          AND rr.user_id = ?
        WHERE r.id IN (${placeholders})`,
    )
      .bind(userId, ...chunk)
      .all<{ id: string; recipient_user_id: string | null }>();

    for (const row of results) rows.set(row.id, row.recipient_user_id);
  }

  const invalid = new Set<string>();
  for (const op of ops) {
    if (op.kind !== 'recommendation.respond') continue;
    const id = asString(op.payload['recommendationId'], 80);
    if (!id || !rows.has(id) || rows.get(id) !== userId) invalid.add(op.opId);
  }
  return invalid;
}

export async function loadOpContext(
  ops: readonly IncomingOp[],
  env: Env,
): Promise<OpContext> {
  const needsAccounts = ops.some((op) => ACCOUNT_AWARE_KINDS.has(op.kind));
  const accounts = needsAccounts ? await allAccountIds(env) : [];

  const commentIds = new Set<string>();
  for (const op of ops) {
    if (op.kind === 'reaction.set') {
      const id = asString(op.payload['commentId'], 80);
      if (id) commentIds.add(id);
    } else if (op.kind === 'comment.add') {
      const id = asString(op.payload['parentId'], 80);
      if (id) commentIds.add(id);
    }
  }

  if (commentIds.size === 0) return { accounts };

  const comments: Record<string, { authorId: string; seriesRef: string }> = {};
  const ids = [...commentIds];
  const CHUNK = 90;

  for (let offset = 0; offset < ids.length; offset += CHUNK) {
    const chunk = ids.slice(offset, offset + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT id, author_id, series_ref FROM comments WHERE id IN (${placeholders})`,
    )
      .bind(...chunk)
      .all<{ id: string; author_id: string; series_ref: string }>();

    for (const row of results) {
      comments[row.id] = { authorId: row.author_id, seriesRef: row.series_ref };
    }
  }

  return { accounts, comments };
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
  now: number,
  env: Env,
): Promise<number> {
  const previous = await env.DB.prepare('SELECT rev FROM applied_ops WHERE op_id = ?')
    .bind(op.opId)
    .first<{ rev: number }>();
  if (previous) return Number(previous.rev);

  const patch = stripImmutable((op.payload['fields'] ?? {}) as Record<string, unknown>);
  const safeFields = Object.entries(patch).filter(([key]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key));

  try {
    return await commitAtNextRevision(env, now, [op.opId], (rev) => {
      const statements: D1PreparedStatement[] = [];

      if (op.kind === 'settings.patch') {
        statements.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO settings (user_id, data, field_revs, rev)
             VALUES (?, '{}', '{}', 0)`,
          ).bind(userId),
        );
        for (const [key, value] of safeFields) {
          const path = `$.${key}`;
          statements.push(
            env.DB.prepare(
              `UPDATE settings
                  SET data = json_set(data, ?, json(?)),
                      field_revs = json_set(field_revs, ?, ?),
                      rev = ?
                WHERE user_id = ?
                  AND ? > COALESCE(json_extract(field_revs, ?), 0)
                  AND NOT EXISTS (SELECT 1 FROM applied_ops WHERE op_id = ?)`,
            ).bind(path, JSON.stringify(value), path, rev, rev, userId, rev, path, op.opId),
          );
        }
      } else {
        statements.push(
          env.DB.prepare(
            'INSERT OR IGNORE INTO profiles (user_id, field_revs, rev) VALUES (?, ?, 0)',
          ).bind(userId, '{}'),
        );
        for (const [key, value] of safeFields) {
          const column = PROFILE_COLUMNS[key];
          if (!column) continue;
          const path = `$.${key}`;
          statements.push(
            env.DB.prepare(
              `UPDATE profiles
                  SET ${column} = ?, field_revs = json_set(field_revs, ?, ?), rev = ?
                WHERE user_id = ?
                  AND ? > COALESCE(json_extract(field_revs, ?), 0)
                  AND NOT EXISTS (SELECT 1 FROM applied_ops WHERE op_id = ?)`,
            ).bind(value, path, rev, rev, userId, rev, path, op.opId),
          );
        }
      }

      statements.push(
        env.DB.prepare(
          'INSERT INTO applied_ops (op_id, user_id, kind, rev, applied_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(op.opId, userId, op.kind, rev, now),
      );
      return statements;
    });
  } catch (error) {
    if (error instanceof DuplicateOpConflict) {
      const after = await env.DB.prepare('SELECT rev FROM applied_ops WHERE op_id = ?')
        .bind(op.opId)
        .first<{ rev: number }>();
      if (after) return Number(after.rev);
    }
    throw error;
  }
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

  const invalidRecommendations = await invalidRecommendationResponses(ops, userId, env);
  const acknowledged = await appliedOpIds(ops, env);
  const skipped = new Set<string>();
  const unapplied = new Set<string>(invalidRecommendations);

  // field merges تحتاج revision مستقلًا لأن field_revs نفسها تستخدمه للمقارنة.
  for (const op of ops) {
    if (!FIELD_MERGE_KINDS.has(op.kind) || unapplied.has(op.opId)) continue;
    if (acknowledged.has(op.opId)) continue;
    await applyFieldMerge(op, userId, now, env);
    acknowledged.add(op.opId);
  }

  let pending = ops.filter(
    (op) =>
      !FIELD_MERGE_KINDS.has(op.kind) &&
      !acknowledged.has(op.opId) &&
      !unapplied.has(op.opId),
  );

  while (pending.length > 0) {
    const ctx = await loadOpContext(pending, env);
    let builtForRevision: Array<{ op: IncomingOp; statements: D1PreparedStatement[] }> = [];

    // نبني أولًا على rev افتراضي داخل callback لاحقًا، لذلك نعيد البناء عند
    // كل محاولة commit. هذه الدالة فقط تحدد ما هو صالح وما هو noop قديم.
    const classify = (rev: number) => {
      builtForRevision = [];
      const effects: D1PreparedStatement[] = [];
      for (const op of pending) {
        if (DEPRECATED_NOOP_KINDS.has(op.kind)) {
          skipped.add(op.opId);
          continue;
        }
        const statements = statementsFor(op, userId, rev, now, env, ctx);
        if (!statements || statements.length === 0) {
          unapplied.add(op.opId);
          continue;
        }
        builtForRevision.push({ op, statements });
      }

      for (const item of builtForRevision) effects.push(...item.statements);
      for (const item of builtForRevision) {
        effects.push(
          env.DB.prepare(
            'INSERT INTO applied_ops (op_id, user_id, kind, rev, applied_at) VALUES (?, ?, ?, ?, ?)',
          ).bind(item.op.opId, userId, item.op.kind, rev, now),
        );
      }
      return effects;
    };

    // deprecated/invalid-only tail: no revision required.
    classify((await currentRev(env)) + 1);
    const commitCandidates = builtForRevision.map((item) => item.op);
    if (commitCandidates.length === 0) break;

    try {
      await commitAtNextRevision(
        env,
        now,
        commitCandidates.map((op) => op.opId),
        classify,
      );
      for (const op of commitCandidates) acknowledged.add(op.opId);
      break;
    } catch (error) {
      if (!(error instanceof DuplicateOpConflict)) throw error;

      // طلب موازٍ سبقنا بنفس op_id. نعترف بما ثبّته ونكمل بالبقية؛ لا نعيد
      // تنفيذ setter قديم فوق حالة أحدث.
      const raced = await appliedOpIds(commitCandidates, env);
      if (raced.size === 0) throw error;
      for (const opId of raced) acknowledged.add(opId);
      pending = pending.filter((op) => !raced.has(op.opId));
    }
  }

  const cursor = await currentRev(env);
  return json({
    applied: ops
      .filter((op) => acknowledged.has(op.opId) && !skipped.has(op.opId))
      .map((op) => op.opId),
    skipped: [...skipped],
    cursor,
    serverRev: cursor,
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

// ───────────────────────── ملخص الأسبوع ─────────────────────────

/**
 * §32 — يُحسب عند الطلب لا بمهمة مجدولة.
 *
 * `wrangler.toml` بلا cron بقرار معلن، ومهمةٌ مجدولة تفشل بصمت أسوأ من
 * حسابٍ يُعاد. والمدى أسبوع لثلاثة حسابات، فالاستعلامات الأربعة أرخص من
 * جدول يُصان.
 *
 * والقواعد كلها في `summariseWeek` بالمجال: هنا قراءة صفوف وتمرير لا منطق.
 *
 * **والإخفاء يُحترم كما في الحضور:** من كان مخفيًّا الآن يُعرض عدد فصوله
 * ويُحجب اسم عمله. قاعدة `redactForViewers` تقول إن الوجود يبقى وما يُقرأ
 * يُحجب، وملخصٌ يسمّي عملًا أخفاه صاحبه يكسرها من باب آخر.
 */
async function handleWeek(env: Env, now: number): Promise<Response> {
  const window = weekEnding(now);

  const [accounts, days, reads, ratings, settings] = await Promise.all([
    env.DB.prepare(
      `SELECT a.user_id, a.username, p.display_name
         FROM accounts a LEFT JOIN profiles p USING (user_id)`,
    ).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT user_id, day, active_ms FROM usage_daily`).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT user_id, series_ref, chapter_key, read_count, last_read_at
         FROM chapter_reads WHERE last_read_at >= ? AND last_read_at < ?`,
    )
      .bind(window.from, window.to)
      .all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT user_id, series_ref, score, updated_at
         FROM ratings WHERE updated_at >= ? AND updated_at < ?`,
    )
      .bind(window.from, window.to)
      .all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT user_id, data FROM settings`).all<Record<string, unknown>>(),
  ]);

  const summary = summariseWeek(
    {
      accounts: accounts.results.map((row) => ({
        userId: String(row['user_id']),
        displayName: String(row['display_name'] ?? row['username'] ?? ''),
      })),
      days: days.results.map((row) => ({
        userId: String(row['user_id']),
        day: String(row['day'] ?? ''),
        activeMs: Number(row['active_ms'] ?? 0),
      })),
      reads: reads.results.map((row) => ({
        userId: String(row['user_id']),
        seriesRef: String(row['series_ref'] ?? ''),
        chapterKey: String(row['chapter_key'] ?? ''),
        readCount: Number(row['read_count'] ?? 1),
        lastReadAt: Number(row['last_read_at'] ?? 0),
      })),
      ratings: ratings.results.map((row) => ({
        userId: String(row['user_id']),
        seriesRef: String(row['series_ref'] ?? ''),
        score: Number(row['score'] ?? 0),
        updatedAt: Number(row['updated_at'] ?? 0),
      })),
    },
    window,
  );

  const hidden = new Set(
    settings.results
      .filter((row) => incognitoUntilFrom(row['data']) > now)
      .map((row) => String(row['user_id'])),
  );

  return json({
    content: {
      ...summary,
      people: summary.people.map((person) =>
        hidden.has(person.userId) ? { ...person, topSeries: null, incognito: true } : person,
      ),
    },
  });
}

// ───────────────────────── المجموعات ─────────────────────────

/**
 * المفضلة أو أقرأ لاحقًا، مُثرية وجاهزة للعرض.
 *
 * سجل الفروقات يوصل الصفوف للعميل، وهذا المسار يعطي **نفس** القائمة محسوبة
 * على الخادم: مفيد للتحقق، ولجهاز بمرآة فارغة، ولئلا يكون ترتيب القائمة
 * مُعادًا في كل شاشة. القاعدة واحدة — `collectionView` من طبقة المجال.
 */
async function handleCollection(
  url: URL,
  env: Env,
  userId: string,
): Promise<Response> {
  const kind = url.searchParams.get('kind') ?? 'favorite';
  if (!isCollectionKind(kind)) return json({ error: 'unknown_kind' }, { status: 400 });
  // «أفضل 5» واجهة الملف الشخصي فيراها الأصدقاء؛ المفضلة و«لاحقًا» لصاحبها وحده
  const requested = url.searchParams.get('user');
  if (requested && requested !== userId && kind !== 'top') return json({ error: 'forbidden' }, { status: 403 });
  const owner = requested ?? userId;

  const [rows, works] = await env.DB.batch([
    env.DB.prepare(
      `SELECT kind, series_ref, member, position, updated_at
         FROM collections WHERE user_id = ? AND kind = ?`,
    ).bind(owner, kind),
    env.DB.prepare(
      `SELECT w.series_ref, w.title, w.cover_url, w.source_id, w.updated_at
         FROM works w
         JOIN collections c ON c.series_ref = w.series_ref
        WHERE c.user_id = ? AND c.kind = ?`,
    ).bind(owner, kind),
  ]);

  const items = collectionView({
    rows: (rows?.results ?? []) as unknown as CollectionRow[],
    works: (works?.results ?? []) as unknown as WorkDescriptor[],
    kind,
  });

  return json({
    kind,
    content: items,
    // النقص يُقال لا يُخمَّن: عمل بلا وصف تعرفه الشاشة فتطلبه بدل أن ترسم فراغًا
    needsDescriptor: items.filter((item) => item.needsDescriptor).map((item) => item.seriesRef),
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
  const [reads, usage, followed, marks] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      'SELECT chapter_key, read_count FROM chapter_reads WHERE user_id = ? AND read_count > 0',
    ).bind(targetId),
    env.DB.prepare('SELECT day, active_ms FROM usage_daily WHERE user_id = ?').bind(targetId),
    // المكتبة نفسها خاصة ولا تُزامَن للأصدقاء؛ عددها وحده إحصاء في الملف
    env.DB.prepare('SELECT COUNT(*) AS n FROM library WHERE user_id = ? AND removed = 0').bind(targetId),
    env.DB.prepare('SELECT chapter_key, read FROM chapter_marks WHERE user_id = ?').bind(targetId),
  ]);

  const stats = readStats(
    (reads?.results ?? []).map((row) => ({
      chapterKey: String(row['chapter_key']),
      readCount: Number(row['read_count'] ?? 0),
    })),
    (marks?.results ?? []).map((row) => ({ chapterKey: String(row['chapter_key']), read: Number(row['read']) === 1 })),
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
    if (day >= weekStart && day <= today) weekMs += ms;
  }

  const followedWorks = Number(followed?.results?.[0]?.['n'] ?? 0);
  return json({ userId: targetId, ...stats, followedWorks, usage: { todayMs, weekMs, totalMs } });
}

// ───────────────────────────── الصور ─────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * رفع صورة ملف شخصي. يرجع رابطها الدائم.
 *
 * النوع من بايتات الملف لا من ترويسته، والحجم محدود للصورة وللحساب. والرابط
 * بعنوان المحتوى: الرفع المكرّر لنفس الصورة لا ينشئ صفًّا ثانيًا.
 */
async function handleMediaUpload(request: Request, env: Env, userId: string, url: URL, now: number): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_MEDIA_BYTES) return json({ error: 'too_large', max: MAX_MEDIA_BYTES }, { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) return json({ error: 'empty' }, { status: 400 });
  if (bytes.length > MAX_MEDIA_BYTES) return json({ error: 'too_large', max: MAX_MEDIA_BYTES }, { status: 413 });
  const mime = sniffImageType(bytes);
  if (!mime) return json({ error: 'not_an_image' }, { status: 415 });

  const used = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM media WHERE owner_id = ?')
    .bind(userId)
    .first<{ total: number }>();
  if (Number(used?.total ?? 0) + bytes.length > MAX_MEDIA_BYTES_PER_USER) {
    return json({ error: 'quota' }, { status: 413 });
  }

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare(
    `INSERT INTO media (hash, owner_id, mime, size, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (hash) DO NOTHING`,
  )
    .bind(hash, userId, mime, bytes.length, toBase64(bytes), now)
    .run();
  return json({ hash, mime, size: bytes.length, url: `${url.origin}/v1/media/${hash}` });
}

/**
 * الصورة نفسها، بلا جلسة: `<img>` لا يرسل ترويسة هوية، وشاشة «من يتابع؟»
 * تعرضها قبل الدخول. المعرّف بصمة محتوى لا تُخمَّن، والصورة لا تتغيّر أبدًا
 * تحت رابطها فتُخزَّن سنة. و`nosniff` مع سياسة محتوى فارغة: حتى لو التبس
 * نوعٌ على متصفح لا يُنفَّذ شيء.
 */
async function handleMediaGet(env: Env, hash: string): Promise<Response> {
  if (!isMediaHash(hash)) return new Response('not found', { status: 404 });
  const row = await env.DB.prepare('SELECT mime, data FROM media WHERE hash = ?')
    .bind(hash)
    .first<{ mime: string; data: string }>();
  if (!row) return new Response('not found', { status: 404 });
  return new Response(fromBase64(row.data).buffer as ArrayBuffer, {
    headers: {
      'content-type': row.mime,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
      // لون الخلفية الحريرية يُستخرج من الصورة في canvas: يحتاج CORS
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
    },
  });
}

// ───────────────────────────── التوجيه ─────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

      if (path.startsWith('/v1/media/') && request.method === 'GET') {
        return await handleMediaGet(env, path.slice('/v1/media/'.length));
      }

      // بلا جلسة: ما تحتاجه شاشة اختيار الحساب فقط
      if (path === '/v1/accounts' && request.method === 'GET') {
        const response = await handleAccounts(env, now);
        return new Response(response.body, { status: response.status, headers: { ...JSON_HEADERS, ...cors } });
      }
      const token = bearerFrom(request);
      const userId = token ? await verifyToken(token, env.VANTARA_SESSION_SECRET) : null;
      if (!userId) return json({ error: 'unauthorized' }, { status: 401 }, cors);

      let response: Response | null = null;
      if (path === '/v1/sync' && request.method === 'GET') response = await handleSync(url, env, userId);
      else if (path === '/v1/ops' && request.method === 'POST') response = await handleOps(request, env, userId, now);
      else if (path === '/v1/presence' && request.method === 'POST') response = await handlePresenceBeat(request, env, userId, now);
      else if (path === '/v1/presence' && request.method === 'GET') response = await handlePresenceList(env, now);
      else if (path === '/v1/collections' && request.method === 'GET') {
        response = await handleCollection(url, env, userId);
      }
      else if (path === '/v1/week' && request.method === 'GET') response = await handleWeek(env, now);
      // نبض خفيف: رقم آخر كتابة فقط. الجهاز يسأله كل ثوانٍ ويسحب حين يتقدّم —
      // رسالة صديقك تصلك في ثوانٍ لا بعد دقيقة، بلا سحب كامل كل مرة
      else if (path === '/v1/pulse' && request.method === 'GET') response = json({ rev: await currentRev(env) });
      else if (path === '/v1/progress/pending' && request.method === 'GET') {
        response = await handlePendingProgress(env, userId);
      }
      else if (path === '/v1/media' && request.method === 'POST') {
        response = await handleMediaUpload(request, env, userId, url, now);
      }
      // الترجمة قيد التطوير: مقفلة إلا لمن فُتحت له (الحصة وحدها تجيب، لتقول للجهاز «مقفلة»)
      else if (path.startsWith('/v1/translate/') && path !== '/v1/translate/usage' && !(await translationAllowed(env as TranslationEnv, userId))) {
        response = json({ error: 'translation_locked' }, { status: 403 });
      }
      // الترجمة: المحفوظ لأي حساب، وما لم يُترجم يمرّ بالنموذج (المفتاح هنا وحده)
      else if (path === '/v1/translate/page' && request.method === 'POST') {
        response = await handleTranslatePage(request, env as TranslationEnv, userId, now);
      }
      // خط الرؤية: عامل جهاز البيت يرسل النصوص بمعرّفاتها، وLuna تردّ بالمعرّف
      else if (path === '/v1/translate/text' && request.method === 'POST') {
        response = await handleTranslateText(request, env as TranslationEnv, userId, now);
      }
      // حصة الأسبوع: لحاسبة الترجمة المقدّمة
      else if (path === '/v1/translate/usage' && request.method === 'GET') {
        response = await handleTranslateUsage(env as TranslationEnv, userId, now);
      }
      // التعلّم من الفصول العربية الموجودة لنفس العمل: القاموس والأسلوب مرة لكل عمل
      else if (path === '/v1/translate/learn' && request.method === 'POST') {
        response = await handleTranslateLearn(request, env as TranslationEnv, userId, now);
      }
      else if (path === '/v1/translate/cached' && request.method === 'GET') {
        response = await handleTranslateCached(url, env as TranslationEnv);
      }
      else if (path === '/v1/translate/glossary' && request.method === 'GET') {
        response = await handleTranslateGlossary(url, env as TranslationEnv);
      }
      // «رفيق»: الرسالة بث SSE يخرج كما هو (لا يُلفّ بترويسة JSON)
      else if (path === '/v1/rafiq/message' && request.method === 'POST') {
        const res = await handleRafiqMessage(request, env as RafiqEnv, userId, now, fetch, (p) => ctx?.waitUntil?.(p));
        return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json; charset=utf-8', 'cache-control': 'no-cache', ...cors } });
      }
      else if (path === '/v1/rafiq/state' && request.method === 'GET') response = await handleRafiqState(url, env as RafiqEnv, userId, now);
      else if (path === '/v1/rafiq/feedback' && request.method === 'POST') response = await handleRafiqFeedback(request, env as RafiqEnv, userId, now);
      else if (path === '/v1/rafiq/prefs' && (request.method === 'GET' || request.method === 'DELETE')) response = await handleRafiqPrefs(request, url, env as RafiqEnv, userId);
      else if (path === '/v1/rafiq/new' && request.method === 'POST') response = await handleRafiqNew(env as RafiqEnv, userId, now);
      else if (path === '/v1/rafiq/external' && (request.method === 'POST' || request.method === 'DELETE')) response = await handleRafiqExternal(request, url, env as RafiqEnv, userId, now);
      else if (path === '/v1/rafiq/usage' && request.method === 'GET') response = await handleRafiqUsage(env as RafiqEnv, userId, now);
      else if (path === '/v1/rafiq/conversations' && (request.method === 'GET' || request.method === 'DELETE')) response = await handleRafiqConversations(request, url, env as RafiqEnv, userId);
      else if (path.startsWith('/v1/stats/') && request.method === 'GET') {
        response = await handleStats(env, decodeURIComponent(path.slice('/v1/stats/'.length)), now);
      }

      if (!response) return json({ error: 'not_found' }, { status: 404 }, cors);
      return new Response(response.body, { status: response.status, headers: { ...JSON_HEADERS, ...cors } });
    } catch (error) {
      // B10: الرسالة لا تخرج — قد تحمل بنية الجدول أو جزءًا من قيمة —
      // لكن المعرّف يخرج. وهو الشيء الوحيد الذي يجعل «التطبيق ما اشتغل»
      // قابلًا للربط بهذا السطر بالذات.
      const correlationId = correlationIdFrom(request.headers.get(CORRELATION_HEADER));
      console.error('sync-worker', correlationId, error instanceof Error ? error.message : error);
      return json({ error: 'internal', correlationId }, { status: 500 }, {
        ...cors,
        [CORRELATION_HEADER]: correlationId,
      });
    }
  },
};
