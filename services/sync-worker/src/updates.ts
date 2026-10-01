/**
 * Update Engine — VANTARA هي المصدر الأب للتحديثات.
 *
 * الأجهزة تبلّغ ما تراه (مسح Latest للمانجا، حلقات AniList، حلقات المسلسل
 * وتوفّر الفيلم في السينما)، وهنا يتحوّل كل ذلك لأحداث ثابتة:
 * - هوية الحدث = العمل الموحّد + نوع الوحدة + رقمها، لا رقم المصدر.
 *   نفس الفصل من ثلاثة مصادر = حدث واحد بثلاثة مصادر.
 * - الوقت `at` يُثبَّت عند الإنشاء: وقت النشر إن أعطاه المصدر وكان معقولًا،
 *   وإلا أول وقت اكتشفه فيه VANTARA. لا يُعاد ضبطه بأي تحديث لاحق،
 *   فالخط الزمني لا يتبدّل بترتيب ردود المصادر.
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
}
interface Incoming {
  id: string;
  work: string;
  section: Section;
  kind: Kind;
  season: number | null;
  number: number | null;
  title: string;
  cover: string | null;
  publishedAt: number | null;
  source: Source | null;
}

const MAX_EVENTS = 100;
const MAX_SOURCES = 12;
const YEAR = 365 * 86_400_000;
const WORK = {
  manga: /^ext:[^\s|]{1,200}$/,
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

/** يتحقق من حدث مُبلَّغ ويعيده بشكله المعتمد، أو null. */
export function parseEvent(raw: unknown, now: number): Incoming | null {
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
  const number = kind === 'movie' ? null : num(r.number);
  if (kind !== 'movie' && (number == null || number < 0 || number > 100_000)) return null;
  const seasonRaw = num(r.season);
  const season = kind === 'episode' && section === 'cinema' ? (seasonRaw != null && seasonRaw >= 0 && seasonRaw <= 200 ? Math.floor(seasonRaw) : null) : null;
  if (section === 'cinema' && kind === 'episode' && season == null) return null;
  const title = str(r.title, 200);
  if (!title) return null;
  const cover = str(r.cover, 600);
  // وقت نشر «موثوق»: خلال السنة الماضية ولا في المستقبل (جداول البث القادمة ليست تحديثًا)
  const p = num(r.publishedAt);
  const publishedAt = p != null && p <= now + 10 * 60_000 && p >= now - YEAR ? Math.min(p, now) : null;
  const s = r.source as Record<string, unknown> | undefined;
  const sid = str(s?.s, 120);
  const source = sid && /^[\w.:@-]+$/.test(sid) ? { s: sid, ...(str(s?.u, 500) ? { u: str(s?.u, 500)! } : {}), ...(str(s?.t, 200) ? { t: str(s?.t, 200)! } : {}) } : null;
  return { id: eventId(work, kind, season, number), work, section, kind, season, number, title, cover: cover && /^https?:\/\//.test(cover) ? cover : null, publishedAt, source };
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

export async function handleUpdatesObserve(request: Request, env: UpdatesEnv, now: number): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { events?: unknown } | null;
  const list = Array.isArray(body?.events) ? body!.events.slice(0, MAX_EVENTS) : [];
  // نفس الحدث مرتين في الطلب نفسه (مصدران): يُدمج قبل الكتابة
  const byId = new Map<string, Incoming & { sources: Source[] }>();
  for (const raw of list) {
    const e = parseEvent(raw, now);
    if (!e) continue;
    const prev = byId.get(e.id);
    if (prev) {
      prev.sources = mergeSources(prev.sources, e.source ? [e.source] : []);
      prev.publishedAt = prev.publishedAt ?? e.publishedAt;
      prev.cover = prev.cover ?? e.cover;
    } else byId.set(e.id, { ...e, sources: e.source ? [e.source] : [] });
  }
  if (!byId.size) return reply({ accepted: 0, created: 0 });

  const ids = [...byId.keys()];
  const { results } = await env.DB.prepare(`SELECT id, sources, cover, published_at FROM update_events WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ id: string; sources: string; cover: string | null; published_at: number | null }>();
  const known = new Map((results ?? []).map((r) => [r.id, r]));
  const writes = [];
  let created = 0;
  for (const e of byId.values()) {
    const row = known.get(e.id);
    if (!row) {
      created++;
      writes.push(
        env.DB.prepare(
          `INSERT INTO update_events (id, work, section, kind, season, number, title, cover, at, published_at, first_seen_at, sources, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
        ).bind(e.id, e.work, e.section, e.kind, e.season, e.number, e.title, e.cover, e.publishedAt ?? now, e.publishedAt, now, JSON.stringify(e.sources), now),
      );
      continue;
    }
    let old: Source[] = [];
    try {
      old = JSON.parse(row.sources) as Source[];
    } catch {
      old = [];
    }
    const merged = mergeSources(old, e.sources);
    // `at` لا يُلمس أبدًا: المصدر الثاني يُضاف تحت نفس الحدث في مكانه
    if (JSON.stringify(merged) === row.sources && (row.cover || !e.cover) && (row.published_at != null || e.publishedAt == null)) continue;
    writes.push(
      env.DB.prepare('UPDATE update_events SET sources = ?, cover = COALESCE(cover, ?), published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(merged), e.cover, e.publishedAt, now, e.id),
    );
  }
  if (writes.length) await env.DB.batch(writes);
  return reply({ accepted: byId.size, created });
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
  const where = ['section = ?'];
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
    `SELECT id, work, section, kind, season, number, title, cover, at, published_at, first_seen_at, sources
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
    next: rows.length > limit && last ? `${last.at}~${last.id}` : null,
  });
}
