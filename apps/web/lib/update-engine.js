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
const STORAGE_KEY = 'vantara.update-reports.v1';
const MAX_QUEUE_WORKS = 1000;
const MAX_QUEUE_UNITS = 50_000;
const MAX_STORAGE_BYTES = 2_000_000;

let transport = null;
const queue = new Map();
let timer = null;
let inFlight = null;
let dropped = 0;
let storageFailed = false;

const keyOf = (r) => `${r.work}|${r.kind}|${r.source?.s ?? ''}`;
const unitKey = (u) => `${u.season ?? 0}:${u.number}`;
const order = (a, b) => (b.season ?? 0) - (a.season ?? 0) || b.number - a.number;

function persist() {
  try {
    const value = JSON.stringify([...queue.values()]);
    if (value.length > MAX_STORAGE_BYTES) { storageFailed = true; return; }
    globalThis.localStorage?.setItem(STORAGE_KEY, value);
    storageFailed = !globalThis.localStorage;
  } catch { storageFailed = true; }
}
try {
  const rows = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '[]');
  if (Array.isArray(rows)) for (const row of rows.slice(0, MAX_QUEUE_WORKS)) {
    if (row?.work && row?.title && Array.isArray(row.units)) queue.set(keyOf(row), row);
  }
} catch { storageFailed = true; }

export function updateReportStatus() {
  return { pendingWorks: queue.size, pendingUnits: [...queue.values()].reduce((n, w) => n + w.units.length, 0), dropped, storageFailed, sending: Boolean(inFlight) };
}

/** `send(path, {method, body})` → `{status, body}` (نفس `sync.translation`). */
export function connectUpdates(send) {
  transport = send;
  if (queue.size) schedule();
}

function schedule() {
  if (!timer && transport) timer = setTimeout(() => void flush(), FLUSH_MS);
}

export async function flush() {
  if (inFlight) return inFlight;
  clearTimeout(timer);
  timer = null;
  if (!transport || !queue.size) return;
  const works = [];
  let units = 0;
  for (const work of queue.values()) {
    const chunk = { ...work, units: work.units.slice(0, MAX_UNITS) };
    const count = chunk.units.length || 1;
    if (works.length >= MAX_BATCH || (works.length && units + count > MAX_BATCH_UNITS)) break;
    works.push(chunk); units += count;
  }
  // Keep in-flight reports durable until acknowledgement. A reload may resend;
  // server event IDs make that retry idempotent.
  inFlight = (async () => {
    let accepted = false;
    try {
      const res = await transport('/v1/updates/observe', { method: 'POST', body: { works } });
      accepted = res?.status >= 200 && res?.status < 300;
    } catch { /* Retry persisted observations. */ }
    if (accepted) for (const work of works) {
      const key = keyOf(work);
      const current = queue.get(key);
      if (!current) continue;
      const sent = new Map(work.units.map(u => [unitKey(u), JSON.stringify(u)]));
      const remaining = current.units.filter(u => sent.get(unitKey(u)) !== JSON.stringify(u));
      if (remaining.length) queue.set(key, { ...current, units: remaining });
      else queue.delete(key);
    }
    persist();
  })();
  try { await inFlight; } finally {
    inFlight = null;
    if (queue.size) schedule();
  }
}

/** يضيف تقريرًا (يدمج وحداته مع ما ينتظر للعمل نفسه من نفس المصدر). */
export function report(r) {
  if (!r?.work || !r.title || (r.kind !== 'movie' && !r.units?.length)) return;
  const key = keyOf(r);
  const prev = queue.get(key);
  const units = new Map((prev?.units ?? []).map((u) => [unitKey(u), u]));
  for (const u of r.units ?? []) units.set(unitKey(u), { ...units.get(unitKey(u)), ...u });
  const merged = { ...prev, ...r, units: [...units.values()].sort(order) };
  const total = [...queue.values()].reduce((n, w) => n + w.units.length, 0) - (prev?.units.length ?? 0) + merged.units.length;
  if ((!prev && queue.size >= MAX_QUEUE_WORKS) || total > MAX_QUEUE_UNITS || JSON.stringify([...queue.values()].filter(w => keyOf(w) !== key).concat(merged)).length > MAX_STORAGE_BYTES) {
    dropped += r.units?.length ?? 1;
    return false;
  }
  queue.set(key, merged);
  persist();
  schedule();
  return true;
}

/**
 * تواريخ رفع لا يُعتمد عليها: مصدر يضع «الآن» لكل فصوله (كلها في نفس الدقيقة).
 * نُسقطها؛ الخادم لا يُنشئ حدثًا بلا تاريخ إلا بعد تقدّم خط أساس المصدر.
 */
export function trustDates(units) {
  const dated = units.filter((u) => u.publishedAt);
  if (dated.length < 10) return units;
  const times = dated.map((u) => u.publishedAt);
  return Math.max(...times) - Math.min(...times) < 60_000 ? units.map(({ publishedAt, ...u }) => u) : units;
}

/** Listing-motion hint for diagnosis only. The server never uses this as proof
 * of publication or as permission to create an undated first-sighting event. */
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
      .sort(order),
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

/** أعلى فصل لكل عمل مانجا كما يعرفه الخادم: [مفتاح، فصل]، أو null. */
export async function topChapters() {
  if (!transport) return null;
  const res = await transport('/v1/updates/twins').catch(() => null);
  return res?.status === 200 && Array.isArray(res.body?.works) ? res.body.works : null;
}

/** الخط الزمني من ذاكرة VANTARA: الأحدث أولًا، بمؤشر ثابت للصفحات التالية. */
export async function timeline(section, { before = null, limit = 40 } = {}) {
  if (!transport) return null;
  const q = new URLSearchParams({ section, limit: String(limit), ...(before ? { before } : {}) });
  const res = await transport(`/v1/updates?${q}`).catch(() => null);
  return res?.status === 200 ? res.body : null;
}
