/**
 * مجسّات Update Engine على الجهاز.
 *
 * القاعدة: المصادر تكتشف، وVANTARA يقرّر ويحفظ الحقيقة. أي مسار يرى فصولًا أو
 * حلقات — Latest، البحث، صفحة العمل، جلب الفصول، الزحف، التحديث اليدوي — يبلّغ
 * هنا «هذا العمل وما أراه من وحداته»، والخادم وحده يقرّر: أول مشاهدة خط أساس بلا
 * أحداث، وما فوقه بعدها حدث واحد مهما تعددت مصادره (`/v1/updates/observe`).
 *
 * التقارير تُجمع وتُرسل دفعة كل بضع ثوانٍ، ولا تؤخّر القارئ ولا المشغّل شيئًا.
 */

import { chapterNumberOf, normalizeTitle } from './catalog.js';

const FLUSH_MS = 4000;
const MAX_UNITS = 40;
const MAX_BATCH = 20;
const MAX_BATCH_UNITS = 200;

let transport = null;
const queue = new Map();
let timer = null;

/** `send(path, {method, body})` → `{status, body}` (نفس `sync.translation`). */
export function connectUpdates(send) {
  transport = send;
  if (queue.size) schedule();
}

function schedule() {
  if (!timer && transport) timer = setTimeout(() => void flush(), FLUSH_MS);
}

export async function flush() {
  clearTimeout(timer);
  timer = null;
  if (!transport || !queue.size) return;
  const works = [];
  let units = 0;
  for (const work of queue.values()) {
    const count = work.units?.length || 1;
    if (works.length >= MAX_BATCH || (works.length && units + count > MAX_BATCH_UNITS)) break;
    works.push(work); units += count;
  }
  for (const w of works) queue.delete(keyOf(w));
  try {
    await transport('/v1/updates/observe', { method: 'POST', body: { works } });
  } catch {
    // مجسّ لا يُفشل شيئًا: ما ضاع يُرى في المسح التالي
  }
  if (queue.size) schedule();
}

const keyOf = (r) => `${r.work}|${r.kind}|${r.source?.s ?? ''}`;
const unitKey = (u) => `${u.season ?? 0}:${u.number}`;
const order = (a, b) => (b.season ?? 0) - (a.season ?? 0) || b.number - a.number;

/** يضيف تقريرًا (يدمج وحداته مع ما ينتظر للعمل نفسه من نفس المصدر). */
export function report(r) {
  if (!r?.work || !r.title || (r.kind !== 'movie' && !r.units?.length)) return;
  const key = keyOf(r);
  const prev = queue.get(key);
  const units = new Map((prev?.units ?? []).map((u) => [unitKey(u), u]));
  for (const u of r.units ?? []) units.set(unitKey(u), { ...units.get(unitKey(u)), ...u });
  queue.set(key, { ...prev, ...r, units: [...units.values()].sort(order).slice(0, MAX_UNITS) });
  schedule();
}

/**
 * تواريخ رفع لا يُعتمد عليها: مصدر يضع «الآن» لكل فصوله (كلها في نفس الدقيقة).
 * نُسقطها فيعتمد الخادم على أول اكتشاف بدلها.
 */
export function trustDates(units) {
  const dated = units.filter((u) => u.publishedAt);
  if (dated.length < 10) return units;
  const times = dated.map((u) => u.publishedAt);
  return Math.max(...times) - Math.min(...times) < 60_000 ? units.map(({ publishedAt, ...u }) => u) : units;
}

/**
 * عملٌ رآه مسح Latest يصعد في قائمة «آخر التحديثات» لمصدره منذ مسحٍ سابق في
 * `since`: المصدر نفسه يشهد أنه تحدّث بين `since` والآن. يُرفق بتقرير فصوله
 * التالي فيسجّل الخادم أعلى فصل حتى إن كان أول مشاهدة للعمل أو بلا تاريخ رفع
 * (كان يصير خط أساس صامتًا فيسقط العمل من «آخر التحديثات»).
 */
const LISTED_TTL_MS = 120_000;
const listedHints = new Map();
const listedKey = (sourceId, manga) => `${sourceId}|${manga?.url ?? ''}|${normalizeTitle(manga?.title)}`;
export function noteListed(sourceId, manga, since, now = Date.now()) {
  if (!Number.isFinite(since) || since <= 0 || since > now) return;
  for (const [k, v] of listedHints) if (now - v.at > LISTED_TTL_MS) listedHints.delete(k);
  listedHints.set(listedKey(sourceId, manga), { since, at: now });
}
function takeListed(sourceId, manga) {
  const key = listedKey(sourceId, manga);
  const hint = listedHints.get(key);
  listedHints.delete(key);
  return hint && Date.now() - hint.at <= LISTED_TTL_MS ? hint.since : null;
}

/** المانجا: كل ما يجلبه محرك الإضافات من فصول (أي مسار). */
export function observeMangaChapters(sourceId, manga, chapters) {
  const key = normalizeTitle(manga?.title);
  const listed = takeListed(sourceId, manga);
  if (!key || !chapters?.length) return;
  const units = trustDates(
    chapters
      .map((c) => ({ number: chapterNumberOf(c), ...(Number(c?.dateUpload) > 0 ? { publishedAt: Number(c.dateUpload) } : {}) }))
      .filter((u) => Number.isFinite(u.number) && u.number >= 0)
      .sort(order)
      .slice(0, MAX_UNITS),
  );
  if (!units.length) return;
  report({
    work: `ext:${key}`,
    section: 'manga',
    kind: 'chapter',
    title: manga.title,
    cover: manga.thumbnailUrl ?? null,
    source: { s: sourceId, ...(manga.url ? { u: manga.url } : {}), ...(manga.title ? { t: manga.title } : {}), ...(typeof manga.memo === 'string' && manga.memo ? { m: manga.memo } : {}) },
    units,
    ...(listed ? { listed } : {}),
  });
}

/** الخط الزمني من ذاكرة VANTARA: الأحدث أولًا، بمؤشر ثابت للصفحات التالية. */
export async function timeline(section, { before = null, limit = 40 } = {}) {
  if (!transport) return null;
  const q = new URLSearchParams({ section, limit: String(limit), ...(before ? { before } : {}) });
  const res = await transport(`/v1/updates?${q}`).catch(() => null);
  return res?.status === 200 ? res.body : null;
}
