/**
 * Update Engine — المصادر تكتشف، وVANTARA يقرّر ويحفظ الحقيقة.
 *
 * كل مسار يرى فصولًا أو حلقات (Latest، البحث، صفحة العمل، جلب الفصول، الزحف،
 * التحديث اليدوي) يبلّغ «هذا العمل وما أراه من وحداته»، وهنا يتحوّل لأحداث ثابتة:
 * - أول مشاهدة للعمل خط أساس بلا أحداث: 400 فصل قديم لا تصير 400 تحديث.
 *   الوحدات المؤرّخة تُحفظ كاملة حتى تحت خط الأساس؛ القديم تاريخ، لا خبر حي.
 * - هوية الحدث = العمل الموحّد + نوع الوحدة + رقمها، لا رقم المصدر.
 *   نفس الفصل من ثلاثة مصادر = حدث واحد بثلاثة مصادر.
 * - وقتان منفصلان: `published_at` من المصدر إن كان موثوقًا، و`first_seen_at` أول
 *   اكتشاف لـVANTARA. والترتيب `at` يُثبَّت عند الإنشاء ولا يُعاد ضبطه أبدًا،
 *   فالخط الزمني لا يتبدّل بترتيب ردود المصادر، ويبقى الحدث وإن اختفى المصدر.
 */

import type { D1Database } from './types.ts';

export interface UpdatesEnv {
  DB: D1Database;
}

type Section = 'manga' | 'anime' | 'cinema';
type Kind = 'chapter' | 'episode' | 'movie';
interface Source {
  s: string;
  u?: string;
  t?: string;
  m?: string;
}

const MAX_EVENTS = 100;
const MAX_SOURCES = 12;
const EARLIEST_PUBLICATION = Date.UTC(1900, 0, 1);
const WORK = {
  manga: /^ext:[^\x00-\x1f|]{1,200}$/,
  anime: /^anime:\d{1,9}$/,
  cinema: /^cinema:tt\d{1,10}$/,
} as const;

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** هوية الحدث: العمل + الوحدة. 12.50 و12.5 نفس الفصل. */
export function eventId(work: string, kind: Kind, season: number | null, number: number | null): string {
  const n = number == null ? '' : String(Math.round(number * 1000) / 1000);
  if (kind === 'chapter') return `${work}|c:${n}`;
  if (kind === 'movie') return `${work}|movie`;
  return season == null ? `${work}|e:${n}` : `${work}|s${season}e:${n}`;
}

interface Unit {
  season: number | null;
  number: number;
  publishedAt: number | null;
}
interface Report {
  work: string;
  section: Section;
  kind: Kind;
  title: string;
  cover: string | null;
  source: Source | null;
  units: Unit[];
}

/** خط أساس العمل: أعلى وحدة معروفة. */
interface Mark {
  season: number | null;
  number: number;
}

/** حدث جديد على خط أساس قديم: وقت نشر حديث موثوق لأول مشاهدة. */
/** أكبر قفزة تُقبل فوق خط الأساس؛ ما بعدها ترقيم مصدر خاطئ لا فصول جديدة. */
const JUMP = { chapter: 30, episode: 12 } as const;
/** أكبر دفعة بلا تواريخ تُعدّ إصدارًا حقيقيًا؛ ما فوقها لحاق مصدر أكمل. */
const BURST = 3;

const reliable = (p: unknown, now: number) => {
  const n = num(p);
  return n != null && n >= EARLIEST_PUBLICATION && n <= now ? n : null;
};
const isAbove = (u: Unit, m: Mark) => (u.season ?? 0) > (m.season ?? 0) || ((u.season ?? 0) === (m.season ?? 0) && u.number > m.number);

/** يتحقق من تقرير مجسّ (عمل + ما يراه من وحداته) ويعيده بشكله المعتمد، أو null. */
export function parseReport(raw: unknown, now: number): Report | null {
  const r = raw as Record<string, unknown>;
  const section = r?.section;
  const kind = r?.kind;
  if (section !== 'manga' && section !== 'anime' && section !== 'cinema') return null;
  if (kind !== 'chapter' && kind !== 'episode' && kind !== 'movie') return null;
  if (section === 'manga' && kind !== 'chapter') return null;
  if (section === 'anime' && kind !== 'episode') return null;
  if (section === 'cinema' && kind === 'chapter') return null;
  const work = str(r.work, 220);
  if (!work || !WORK[section].test(work)) return null;
  const title = str(r.title, 200);
  if (!title) return null;
  const cover = str(r.cover, 600);
  const s = r.source as Record<string, unknown> | undefined;
  const sid = str(s?.s, 120);
  // u = رابط العمل في المصدر، t = اسمه هناك، m = حالة الإضافة (memo): ما يلزم لفتحه منه
  const source = sid && /^[\w.:@-]+$/.test(sid)
    ? { s: sid, ...(str(s?.u, 500) ? { u: str(s?.u, 500)! } : {}), ...(str(s?.t, 200) ? { t: str(s?.t, 200)! } : {}), ...(str(s?.m, 500) ? { m: str(s?.m, 500)! } : {}) }
    : null;
  const seasoned = section === 'cinema' && kind === 'episode';
  const units: Unit[] = [];
  for (const u of Array.isArray(r.units) ? r.units.slice(0, 60) : []) {
    const x = u as Record<string, unknown>;
    if (Number(x?.publishedAt) > now) continue;
    const number = num(x?.number);
    const season = num(x?.season);
    if (kind === 'movie') {
      units.push({ season: null, number: 0, publishedAt: reliable(x?.publishedAt, now) });
      break;
    }
    if (number == null || number < 0 || number > 100_000) continue;
    if (seasoned && (season == null || season < 1 || season > 200)) continue;
    units.push({ season: seasoned ? Math.floor(season!) : null, number, publishedAt: reliable(x?.publishedAt, now) });
  }
  if (kind === 'movie' && !units.length) units.push({ season: null, number: 0, publishedAt: null });
  if (!units.length) return null;
  return { work, section, kind, title, cover: cover && /^https?:\/\//.test(cover) ? cover : null, source, units };
}

function mergeSources(old: Source[], add: Source[]): Source[] {
  const out = [...old];
  for (const s of add) {
    const i = out.findIndex((x) => x.s === s.s);
    if (i >= 0) out[i] = { ...out[i], ...s };
    else out.push(s);
  }
  return out.slice(0, MAX_SOURCES);
}

/**
 * Every dated unit is history, including delayed catch-up below the watermark.
 * Undated first sightings stay a baseline; small later advances may use firstSeenAt.
 * The UI accepts live insertions only with a trustworthy, genuinely recent publishedAt.
 * An undated movie visit never manufactures a release event.
 */
export function decide(report: Report, mark: Mark | null, _now: number): { fresh: Unit[]; mark: Mark | null } {
  if (report.kind === 'movie') return { fresh: report.units.filter((u) => u.publishedAt != null).slice(0, 1), mark: mark ?? { season: null, number: 0 } };
  const sorted = [...report.units].sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || a.number - b.number);
  const top = sorted[sorted.length - 1]!;
  if (!mark) {
    return { fresh: sorted.filter((u) => u.publishedAt != null), mark: { season: top.season, number: top.number } };
  }
  const limit = JUMP[report.kind];
  const above = sorted.filter((u) => {
    if (!isAbove(u, mark)) return false;
    // موسم جديد يبدأ من أوله؛ وفي نفس الموسم قفزة معقولة فقط
    if ((u.season ?? 0) > (mark.season ?? 0)) return (u.season ?? 0) === (mark.season ?? 0) + 1 && u.number <= limit;
    return u.number - mark.number <= limit;
  });
  const undated = above.filter((u) => u.publishedAt == null);
  const catchUp = undated.length > BURST;
  const fresh = [...sorted.filter((u) => u.publishedAt != null), ...above.filter((u) => u.publishedAt == null && !catchUp)];
  const last = above[above.length - 1];
  return { fresh, mark: last ? { season: last.season, number: last.number } : mark };
}

export async function handleUpdatesObserve(request: Request, env: UpdatesEnv, now: number): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { works?: unknown } | null;
  const reports = (Array.isArray(body?.works) ? body!.works.slice(0, MAX_EVENTS) : []).map((r) => parseReport(r, now)).filter((r): r is Report => r !== null);
  if (!reports.length) return reply({ accepted: 0, created: 0, baselined: 0 });

  const works = [...new Set(reports.map((r) => r.work))];
  const marks = new Map<string, Mark>();
  const { results: markRows } = await env.DB.prepare(`SELECT work, max_season, max_number FROM update_watermarks WHERE work IN (${works.map(() => '?').join(',')})`)
    .bind(...works)
    .all<{ work: string; max_season: number | null; max_number: number | null }>();
  for (const m of markRows ?? []) marks.set(m.work, { season: m.max_season, number: m.max_number ?? 0 });

  // كل وحدة يراها المجسّ قد تكون حدثًا موجودًا: مصدر جديد يُدمج تحته
  const allIds = reports.flatMap((r) => r.units.map((u) => eventId(r.work, r.kind, u.season, r.kind === 'movie' ? null : u.number)));
  const known = new Map<string, { sources: string; cover: string | null; published_at: number | null }>();
  for (let i = 0; i < allIds.length; i += 90) {
    const ids = allIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT id, sources, cover, published_at FROM update_events WHERE id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids)
      .all<{ id: string; sources: string; cover: string | null; published_at: number | null }>();
    for (const r of results ?? []) known.set(r.id, r);
  }

  const writes = [];
  const markValues: unknown[][] = [];
  const insertValues: unknown[][] = [];
  const updateValues = new Map<string, { sources: string; cover: string | null; publishedAt: number | null }>();
  let created = 0;
  let baselined = 0;
  const createdIds = new Set<string>();
  for (const r of reports) {
    const before = marks.get(r.work) ?? null;
    const { fresh, mark } = decide(r, before, now);
    if (!before) baselined++;
    if (mark && (!before || mark.season !== before.season || mark.number !== before.number)) {
      marks.set(r.work, mark);
      markValues.push([r.work, r.section, mark.season, mark.number, now, now]);
    }
    const freshIds = new Set(fresh.map((u) => eventId(r.work, r.kind, u.season, r.kind === 'movie' ? null : u.number)));
    for (const u of r.units) {
      const id = eventId(r.work, r.kind, u.season, r.kind === 'movie' ? null : u.number);
      const row = known.get(id);
      const add = r.source ? [r.source] : [];
      if (row) {
        let old: Source[] = [];
        try {
          old = JSON.parse(row.sources) as Source[];
        } catch {
          old = [];
        }
        const merged = mergeSources(old, add);
        // first_seen_at لا يتغير. أول تاريخ نشر موثوق يصحّح مكان الحدث مرة واحدة.
        if (JSON.stringify(merged) === row.sources && (row.cover || !r.cover) && (row.published_at != null || u.publishedAt == null)) continue;
        row.sources = JSON.stringify(merged);
        const prior = updateValues.get(id);
        updateValues.set(id, { sources: row.sources, cover: prior?.cover ?? r.cover, publishedAt: prior?.publishedAt ?? u.publishedAt });
        row.cover ??= r.cover;
        row.published_at ??= u.publishedAt;
        continue;
      }
      if (!freshIds.has(id) || createdIds.has(id)) continue;
      createdIds.add(id);
      created++;
      known.set(id, { sources: JSON.stringify(add), cover: r.cover, published_at: u.publishedAt });
      insertValues.push([id, r.work, r.section, r.kind, u.season, r.kind === 'movie' ? null : u.number, r.title, r.cover, u.publishedAt ?? now, u.publishedAt, now, JSON.stringify(add), now]);
    }
  }
  // D1 counts SQL statements, including statements inside a batch. Pack rows
  // below its 100 bound-parameter limit instead of issuing one query per event.
  for (let i = 0; i < markValues.length; i += 16) {
    const rows = markValues.slice(i, i + 16);
    writes.push(env.DB.prepare(`INSERT INTO update_watermarks (work, section, max_season, max_number, baseline_at, updated_at)
      VALUES ${rows.map(() => '(?,?,?,?,?,?)').join(',')}
      ON CONFLICT(work) DO UPDATE SET max_season=excluded.max_season, max_number=excluded.max_number, updated_at=excluded.updated_at`).bind(...rows.flat()));
  }
  for (let i = 0; i < insertValues.length; i += 7) {
    const rows = insertValues.slice(i, i + 7);
    writes.push(env.DB.prepare(`INSERT INTO update_events (id,work,section,kind,season,number,title,cover,at,published_at,first_seen_at,sources,updated_at)
      VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')} ON CONFLICT(id) DO NOTHING`).bind(...rows.flat()));
  }
  const updates = [...updateValues];
  for (let i = 0; i < updates.length; i += 8) {
    const rows = updates.slice(i, i + 8);
    const choose = `CASE id ${rows.map(() => 'WHEN ? THEN ?').join(' ')} END`;
    writes.push(env.DB.prepare(`UPDATE update_events SET sources=${choose}, cover=COALESCE(cover,${choose}),
      at=CASE WHEN published_at IS NULL THEN COALESCE(${choose},at) ELSE at END,
      published_at=COALESCE(published_at,${choose}),updated_at=? WHERE id IN (${rows.map(() => '?').join(',')})`)
      .bind(...rows.flatMap(([id,u]) => [id,u.sources]), ...rows.flatMap(([id,u]) => [id,u.cover]),
        ...rows.flatMap(([id,u]) => [id,u.publishedAt]), ...rows.flatMap(([id,u]) => [id,u.publishedAt]), now, ...rows.map(([id]) => id)));
  }
  if (writes.length) await env.DB.batch(writes);
  return reply({ accepted: reports.length, created, baselined });
}

export async function handleUpdatesList(url: URL, env: UpdatesEnv): Promise<Response> {
  const section = url.searchParams.get('section');
  if (section !== 'manga' && section !== 'anime' && section !== 'cinema') return reply({ error: 'section' }, 400);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 40));
  const before = url.searchParams.get('before');
  const [atRaw, idRaw] = (before ?? '').split('~');
  const beforeAt = Number(atRaw);
  const cursor = before && Number.isFinite(beforeAt) && idRaw ? { at: beforeAt, id: idRaw } : null;
  const work = url.searchParams.get('work');
  // أحداث كُتبت قبل قاعدة اللحاق (مصدر أكمل لحق بعمل نعرفه) لا تُعرض: محتوى بتاريخ
  // قديم رآه VANTARA أول مرة، أو دفعة بلا تواريخ أكبر من إصدار حقيقي في لحظة واحدة
  const where = [
    'section = ?',
    `(kind <> 'movie' OR published_at IS NOT NULL)`,
    `(published_at IS NOT NULL OR (SELECT COUNT(*) FROM update_events b WHERE b.work = update_events.work AND b.first_seen_at = update_events.first_seen_at AND b.published_at IS NULL) <= ${BURST})`,
  ];
  const binds: unknown[] = [section];
  if (work) {
    where.push('work = ?');
    binds.push(work.slice(0, 220));
  }
  if (cursor) {
    where.push('(at < ? OR (at = ? AND id < ?))');
    binds.push(cursor.at, cursor.at, cursor.id);
  }
  const { results } = await env.DB.prepare(
    // الغلاف غلاف العمل الموحّد (works) إن عُرف، لا غلاف أول مصدر بلّغ الفصل
    `SELECT id, work, section, kind, season, number, title,
            COALESCE((SELECT cover_url FROM works WHERE works.series_ref = update_events.work), cover) AS cover,
            at, published_at, first_seen_at, sources
     FROM update_events WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<{ id: string; work: string; section: Section; kind: Kind; season: number | null; number: number | null; title: string; cover: string | null; at: number; published_at: number | null; first_seen_at: number; sources: string }>();
  const rows = results ?? [];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return reply({
    events: page.map((r) => {
      let sources: Source[] = [];
      try {
        sources = JSON.parse(r.sources) as Source[];
      } catch {
        sources = [];
      }
      return {
        id: r.id,
        work: r.work,
        section: r.section,
        kind: r.kind,
        season: r.season,
        number: r.number,
        title: r.title,
        cover: r.cover,
        at: r.at,
        publishedAt: r.published_at,
        firstSeenAt: r.first_seen_at,
        sources,
      };
    }),
    snapshotAt: Date.now(),
    next: rows.length > limit && last ? `${last.at}~${last.id}` : null,
  });
}
