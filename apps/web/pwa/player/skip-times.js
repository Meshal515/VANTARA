/**
 * تخطي المقدمة والنهاية — نقل حرفي لـ`IntroSkip.kt` و`SkipRepository.kt` في الـAPK.
 *
 * التوقيت من AniSkip (يسمح بالطلب من المتصفح) بمعرّف MAL، وإن غاب فمعرّف AniList
 * يُترجم عبر ani.zip. التوقيت يُقبل فقط إن طابق طول هذه النسخة من الحلقة (فرق
 * ≤ 20 ث أو 2.5%)، ويُزاح بفرق الطول كما يفعل مشغّل AniSkip نفسه.
 */

const CACHE_PREFIX = 'vantara.skip.';
const CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_ENTRIES = 128;

/**
 * @param {object|string} body ردّ AniSkip
 * @param {number} durationMs طول الفيديو المعروض
 * @returns {{opening: {startMs:number,endMs:number}|null, ending: {startMs:number,endMs:number}|null}}
 */
export function parseTimings(body, durationMs) {
  const none = { opening: null, ending: null };
  if (!(durationMs > 0)) return none;
  let result = body;
  if (typeof body === 'string') {
    try { result = JSON.parse(body); } catch { return none; }
  }
  if (result?.found !== true || !Array.isArray(result.results)) return none;
  const duration = durationMs / 1000;
  const matches = [];
  for (const row of result.results) {
    const type = row?.skipType ?? row?.skip_type;
    const isOpening = type === 'op' || type === 'mixed-op';
    if (!isOpening && type !== 'ed' && type !== 'mixed-ed') continue;
    const length = Number(row.episodeLength ?? row.episode_length);
    if (!Number.isFinite(length) || length <= 0 || Math.abs(length - duration) > Math.min(20, duration * 0.025)) continue;
    const start = Number(row.interval?.startTime ?? row.interval?.start_time);
    const end = Number(row.interval?.endTime ?? row.interval?.end_time);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > length || end - start < 10 || end - start > 240) continue;
    const offset = duration - length;
    const timing = { startMs: Math.max(0, Math.trunc((start + offset) * 1000)), endMs: Math.min(durationMs, Math.trunc((end + offset) * 1000)) };
    if (timing.endMs - timing.startMs < 10_000 || timing.startMs >= durationMs) continue;
    if ((isOpening && timing.startMs > durationMs / 2) || (!isOpening && timing.startMs < durationMs / 2)) continue;
    matches.push({ opening: isOpening, mixed: String(type).startsWith('mixed-'), difference: Math.abs(offset), timing });
  }
  matches.sort((a, b) => a.difference - b.difference || Number(a.mixed) - Number(b.mixed));
  const opening = matches.find((m) => m.opening)?.timing ?? null;
  let ending = matches.find((m) => !m.opening)?.timing ?? null;
  if (opening && ending && opening.endMs > ending.startMs) ending = null;
  return { opening, ending };
}

/** المقطع الذي يجب أن يظهر زرّه الآن (يختفي قبل نهايته بثانية). */
export function activeSegment(timings, positionMs) {
  const visible = (i) => i && positionMs >= i.startMs && positionMs < i.endMs - 1000;
  if (visible(timings?.opening)) return { opening: true, interval: timings.opening };
  if (visible(timings?.ending)) return { opening: false, interval: timings.ending };
  return null;
}

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
function read(key, now) {
  try {
    const raw = storage()?.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!(now - data.at >= 0 && now - data.at <= CACHE_TTL_MS)) return null;
    return data.body ?? null;
  } catch { return null; }
}
function write(key, body, now) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(CACHE_PREFIX + key, JSON.stringify({ at: now, body }));
    const keys = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k?.startsWith(CACHE_PREFIX)) keys.push(k); }
    if (keys.length > MAX_ENTRIES) {
      const aged = keys.map((k) => { try { return [k, JSON.parse(s.getItem(k)).at || 0]; } catch { return [k, 0]; } }).sort((a, b) => a[1] - b[1]);
      for (const [k] of aged.slice(0, keys.length - MAX_ENTRIES)) s.removeItem(k);
    }
  } catch {
    // التخزين ممتلئ أو محجوب: التوقيت يُجلب مجددًا في المرة القادمة
  }
}

/**
 * @returns {Promise<{status:'READY'|'NOT_FOUND'|'UNMATCHED'|'MISSING_ID'|'FAILED'|'SPECIAL', timings, cached?:boolean}>}
 */
export async function loadSkipTimes({ malId, anilistId, episode, durationMs, force = false, fetchImpl = globalThis.fetch, now = Date.now(), signal } = {}) {
  const none = { opening: null, ending: null };
  if (!Number.isFinite(episode) || episode <= 0 || episode % 1 !== 0) return { status: 'SPECIAL', timings: none };
  if (!(durationMs > 0)) return { status: 'UNMATCHED', timings: none };
  const get = async (url) => {
    try {
      const r = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
      return { code: r.status, body: r.status >= 200 && r.status < 300 ? await r.text() : '' };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return { code: 0, body: '' };
    }
  };
  let id = Number(malId) > 0 ? Number(malId) : null;
  if (!id && Number(anilistId) > 0) {
    const key = `map-${anilistId}`;
    id = Number(read(key, now)) || null;
    if (!id) {
      const r = await get(`https://api.ani.zip/mappings?anilist_id=${anilistId}`);
      if (r.code === 0 || r.code === 429 || r.code >= 500) return { status: 'FAILED', timings: none };
      try {
        const m = JSON.parse(r.body)?.mappings;
        if (Number(m?.anilist_id) === Number(anilistId) && Number(m?.mal_id) > 0) { id = Number(m.mal_id); write(key, String(id), now); }
      } catch { /* لا مطابقة */ }
    }
  }
  if (!id) return { status: 'MISSING_ID', timings: none };
  const key = `t-${id}-${episode}-${Math.trunc(durationMs / 1000)}`;
  if (!force) {
    const cached = read(key, now);
    if (cached) {
      const timings = parseTimings(cached, durationMs);
      if (timings.opening || timings.ending) return { status: 'READY', timings, cached: true };
    }
  }
  let unmatched = false;
  let failed = false;
  for (const version of [2, 1]) {
    const types = version === 2 ? 'op&types%5B%5D=ed&types%5B%5D=mixed-op&types%5B%5D=mixed-ed' : 'op&types%5B%5D=ed';
    const length = version === 2 ? 'episodeLength' : 'episode_length';
    const r = await get(`https://api.aniskip.com/v${version}/skip-times/${id}/${episode}?types%5B%5D=${types}&${length}=${durationMs / 1000}`);
    if (r.code === 429) return { status: 'FAILED', timings: none };
    if (r.code === 404) continue;
    if (r.code < 200 || r.code > 299) { failed = true; continue; }
    let parsed;
    try { parsed = JSON.parse(r.body); } catch { failed = true; continue; }
    if (typeof parsed?.found !== 'boolean') { failed = true; continue; }
    if (!parsed.found) continue;
    const timings = parseTimings(parsed, durationMs);
    if (timings.opening || timings.ending) { write(key, r.body, now); return { status: 'READY', timings }; }
    unmatched = true;
  }
  return { status: unmatched ? 'UNMATCHED' : failed ? 'FAILED' : 'NOT_FOUND', timings: none };
}

export function skipStatusText(result, pending, clock) {
  if (pending) return 'جارٍ جلب توقيت الحلقة…';
  if (!result) return 'يبدأ الجلب مع تشغيل الفيديو';
  switch (result.status) {
    case 'READY': return [
      result.timings.opening && `المقدمة ${clock(result.timings.opening.startMs / 1000)}–${clock(result.timings.opening.endMs / 1000)}`,
      result.timings.ending && `النهاية ${clock(result.timings.ending.startMs / 1000)}–${clock(result.timings.ending.endMs / 1000)}`,
    ].filter(Boolean).join(' · ');
    case 'NOT_FOUND': return 'لم يُسجّل توقيت لهذه الحلقة بعد';
    case 'UNMATCHED': return 'التوقيت الموجود لا يطابق نسخة الفيديو';
    case 'MISSING_ID': return 'تعذّر مطابقة معرّف الأنمي';
    case 'FAILED': return 'تعذّر الاتصال بخدمة التوقيت؛ تقدر تعيد الجلب';
    default: return 'هذه الحلقة الخاصة تحتاج توقيتًا مستقلًا';
  }
}
