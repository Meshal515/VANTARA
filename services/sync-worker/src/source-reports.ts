/**
 * صحة المصادر من الأجهزة الحقيقية: `/v1/diag/sources`.
 *
 * POST: الجهاز يرسل دفعة أحداث مجمّعة {section, sourceId, stage, outcome, reason, ms, n}
 *       فتُضاف لعدّادات اليوم. لا شيء شخصي: لا مستخدم ولا عمل ولا رابط، والسبب
 *       يُقصّ ويُنظّف من الروابط والأرقام الطويلة.
 * GET:  مجموع آخر `days` أيام (افتراضيًا 2) لكل منصة/مصدر/خطوة/نتيجة — للقياس.
 */

import type { D1Database } from './types.ts';

export interface SourceReportsEnv {
  DB: D1Database;
}

const MAX_EVENTS = 200;
const SECTIONS = new Set(['manga', 'anime', 'cinema']);
const PLATFORMS = new Set(['apk', 'pwa']);
const OUTCOMES = new Set(['ok', 'timeout', 'error', 'challenge', 'no_match', 'empty', 'unavailable']);
const ID = /^[a-z0-9._@-]{1,120}$/i;
const STAGE = /^[a-z_]{1,24}$/;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** سبب قصير بلا روابط ولا أرقام طويلة (قد تحمل معرّفات). */
export function cleanReason(raw: unknown): string {
  return String(raw ?? '')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\d{5,}/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

export async function handleSourceReportPost(request: Request, env: SourceReportsEnv, now: number): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { platform?: unknown; appVersion?: unknown; events?: unknown } | null;
  const platform = String(body?.platform ?? '');
  if (!PLATFORMS.has(platform)) return json({ error: 'bad_platform' }, 400);
  const appVersion = String(body?.appVersion ?? '').slice(0, 24) || '?';
  const events = Array.isArray(body?.events) ? body!.events.slice(0, MAX_EVENTS) : [];
  const day = dayOf(now);
  const writes = [];
  for (const raw of events) {
    const e = raw as Record<string, unknown>;
    const section = String(e.section ?? '');
    const sourceId = String(e.sourceId ?? '');
    const stage = String(e.stage ?? '');
    const outcome = String(e.outcome ?? '');
    if (!SECTIONS.has(section) || !ID.test(sourceId) || !STAGE.test(stage) || !OUTCOMES.has(outcome)) continue;
    const n = Math.max(1, Math.min(1000, Math.floor(Number(e.n ?? 1)) || 1));
    const ms = Math.max(0, Math.min(600_000, Math.floor(Number(e.ms ?? 0)) || 0));
    const msMax = Math.max(ms, Math.min(600_000, Math.floor(Number(e.msMax ?? ms)) || 0));
    writes.push(
      env.DB.prepare(
        `INSERT INTO source_reports (day, platform, app_version, section, source_id, stage, outcome, reason, count, ms_sum, ms_max)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (day, platform, app_version, section, source_id, stage, outcome, reason)
         DO UPDATE SET count = count + excluded.count, ms_sum = ms_sum + excluded.ms_sum, ms_max = MAX(ms_max, excluded.ms_max)`,
      ).bind(day, platform, appVersion, section, sourceId, stage, outcome, outcome === 'ok' ? '' : cleanReason(e.reason), n, ms * n, msMax),
    );
  }
  if (writes.length) await env.DB.batch(writes);
  return json({ accepted: writes.length });
}

export async function handleSourceReportGet(url: URL, env: SourceReportsEnv, now: number): Promise<Response> {
  const days = Math.max(1, Math.min(14, Number(url.searchParams.get('days') ?? 2) || 2));
  const since = dayOf(now - (days - 1) * 86_400_000);
  const { results } = await env.DB.prepare(
    `SELECT platform, app_version, section, source_id, stage, outcome, reason, SUM(count) AS count, SUM(ms_sum) AS ms_sum, MAX(ms_max) AS ms_max
       FROM source_reports WHERE day >= ?
      GROUP BY platform, app_version, section, source_id, stage, outcome, reason
      ORDER BY platform, section, source_id, stage, count DESC
      LIMIT 2000`,
  ).bind(since).all();
  return json({ since, rows: results ?? [] });
}
