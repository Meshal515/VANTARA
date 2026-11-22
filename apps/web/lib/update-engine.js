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
import { adultManga, ecchiManga, isBlockedKey } from './adult-filter.js';
import { buildsLibrary } from './source-policy.js';

const FLUSH_MS = 4000;
const MAX_UNITS = 40;
const MAX_BATCH = 20;
const MAX_BATCH_UNITS = 200;
// v1: الطابور كله في مفتاح واحد، يُحوَّل نصًا كاملًا مرتين مع كل تقرير (UQ1: كلفة تربيعية، 3.8 ث لـ600 عمل بلا إرسال).
// v2: مدخل لكل عمل وفهرس صغير بأسماء المداخل؛ التقرير يكتب مدخله وحده، والفهرس فقط حين يُضاف عمل أو يُحذف.
// القديم يُقرأ مرة ويُنقل (لا يضيع تقرير)، ثم يُفرَّغ.
const STORAGE_KEY = 'vantara.update-reports.v1';
const INDEX_KEY = 'vantara.update-reports.v2';
const ENTRY_PREFIX = 'vantara.update-reports.v2:';
const MAX_QUEUE_WORKS = 1000;
const MAX_QUEUE_UNITS = 50_000;
// UQ2: كان يحجز حتى 2MB من localStorage المشترك (المواضع، قرارات الأغلفة، سجل الدمج)
const MAX_STORAGE_BYTES = 1_000_000;

let transport = null;
const queue = new Map();
/** حجم كل مدخل محفوظ ووحداته: الإجمالي بعدّاد، لا بتحويل الطابور كله مع كل تقرير. */
const sizes = new Map();
let totalBytes = 0;
let totalUnits = 0;
let timer = null;
let inFlight = null;
let dropped = 0;
let storageFailed = false;

const keyOf = (r) => `${r.work}|${r.kind}|${r.source?.s ?? ''}`;
const unitKey = (u) => `${u.season ?? 0}:${u.number}`;
const order = (a, b) => (b.season ?? 0) - (a.season ?? 0) || b.number - a.number;
const store = () => globalThis.localStorage ?? null;

function account(key, entry) {
  const old = sizes.get(key);
  if (old) { totalBytes -= old.bytes; totalUnits -= old.units; }
  if (!entry) { sizes.delete(key); return null; }
  const text = JSON.stringify(entry);
  sizes.set(key, { bytes: text.length, units: entry.units.length });
  totalBytes += text.length; totalUnits += entry.units.length;
  return text;
}
function writeIndex() {
  try { store()?.setItem(INDEX_KEY, JSON.stringify([...queue.keys()])); } catch { storageFailed = true; }
}
// الفهرس يُكتب مرة في نهاية اللحظة الجارية لا مع كل عمل جديد: مئات التقارير المتتالية (جلب قائمة) فهرس واحد
let indexPending = false;
function scheduleIndex() {
  if (indexPending) return;
  indexPending = true;
  queueMicrotask(() => { indexPending = false; writeIndex(); });
}
/** يحفظ مدخل عمل واحد (أو يمحوه)، والفهرس فقط إن تغيّرت قائمة الأعمال. */
function persistEntry(key, text, indexChanged) {
  const ls = store();
  if (!ls) { storageFailed = true; return; }
  try {
    if (text == null) { if (ls.removeItem) ls.removeItem(ENTRY_PREFIX + key); else ls.setItem(ENTRY_PREFIX + key, ''); }
    else ls.setItem(ENTRY_PREFIX + key, text);
    if (indexChanged) scheduleIndex();
    storageFailed = false;
  } catch { storageFailed = true; }
}
function setEntry(key, entry) {
  const isNew = !queue.has(key);
  queue.set(key, entry);
  persistEntry(key, account(key, entry), isNew);
}
function deleteEntry(key) {
  if (!queue.delete(key)) return;
  account(key, null);
  persistEntry(key, null, true);
}
try {
  const ls = store();
  const add = (row) => {
    if (queue.size < MAX_QUEUE_WORKS && row?.work && row?.title && Array.isArray(row.units)) { queue.set(keyOf(row), row); account(keyOf(row), row); }
  };
  for (const key of JSON.parse(ls?.getItem(INDEX_KEY) ?? '[]')) {
    try { add(JSON.parse(ls.getItem(ENTRY_PREFIX + key) || 'null')); } catch { /* مدخل تالف لا يُسقط الباقي */ }
  }
  const legacy = JSON.parse(ls?.getItem(STORAGE_KEY) ?? '[]');
  if (Array.isArray(legacy) && legacy.length) {
    for (const row of legacy) if (!queue.has(keyOf(row ?? {}))) add(row);
    for (const [key, entry] of queue) persistEntry(key, JSON.stringify(entry), false);
    writeIndex();
    ls.setItem(STORAGE_KEY, '[]');
  }
} catch { storageFailed = true; }

export function updateReportStatus() {
  return { pendingWorks: queue.size, pendingUnits: totalUnits, dropped, storageFailed, sending: Boolean(inFlight) };
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
      if (remaining.length) setEntry(key, { ...current, units: remaining });
      else deleteEntry(key);
    }
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
  // الحد بالعدّادات: كلفة التقرير بحجم عمله وحده، لا بحجم الطابور كله
  const old = sizes.get(key);
  const total = totalUnits - (old?.units ?? 0) + merged.units.length;
  const bytes = totalBytes - (old?.bytes ?? 0) + JSON.stringify(merged).length;
  if ((!prev && queue.size >= MAX_QUEUE_WORKS) || total > MAX_QUEUE_UNITS || bytes > MAX_STORAGE_BYTES) {
    dropped += r.units?.length ?? 1;
    return false;
  }
  setEntry(key, merged);
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
  // «آخر التحديثات» عامة لكل المستخدمين ويبنيها المصدر العربي الآمن وحده (قرار المالك، 22 نوفمبر): الإنجليزي
  // والمختلط يقرأ منه صاحبه ولا يبلَّغ، والكبار والإيتشي لا يُبلَّغ عنهما من أي مصدر
  if (!buildsLibrary(sourceId) || adultManga(manga) || ecchiManga(manga) || isBlockedKey(`ext:${key}`)) return;
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
