/**
 * جسر الأنمي والسينما للـPWA: نفس واجهة إضافة `AnimeEngine` الأصلية
 * (`lib/anime-engine.js` يناديها كما هي) — بحث متدفق، جلسات تجهيز بأحداث
 * `route`/`prepared`، أفضل سيرفر، ومشغّل ويب بدل المشغّل الأصلي.
 *
 * الطرق (routes) نفس شكل `Route` في الـAPK:
 *   { id, sourceId, server, code, quality, variant, state, candidates, reason }
 * والمرشّح (candidate) رابط فيديو جاهز من سيرفر: { id, url, type, referer, quality, … }.
 */

import { getRuntime } from '../runtime.js';
import { supports } from '../../lib/capabilities.js';

/** القسم مفعّل في الويب؟ (مفاتيح الميزات في lib/release.js) */
const sectionOn = (content) => (content === 'cinema' ? supports('pwaCinema') : supports('animeWebSources'));
const videoDefs = (r, content = null) => r.registry.list(content).filter((d) => d.content !== 'manga' && sectionOn(d.content));

const listeners = new Map();
function emit(event, data) {
  for (const fn of listeners.get(event) ?? []) {
    try {
      fn(data);
    } catch {
      // مستمع معطوب لا يوقف الباقين
    }
  }
}

const rid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** رموز ثابتة للسيرفرات (نفس `ServerCodes` في الـAPK): الواجهة تعرض الرمز لا اسم الاستضافة. */
const KNOWN = {
  hgcloud: 'HGC', streamhg: 'HGC', streamwish: 'SWH', mp4upload: 'MPU', google: 'GDR', drive: 'GDR', ok: 'OKR', 'ok.ru': 'OKR', okru: 'OKR',
  videa: 'VDA', '4shared': 'FSH', yonaplay: 'YNP', vk: 'VKV', megamax: 'MMX', streamruby: 'RBY', rubyvid: 'RBY', uqload: 'UQL', earnvids: 'EVD',
  lulustream: 'LLS', mixdrop: 'MXD', krakenfiles: 'KRK', voe: 'VOE', dood: 'DDS', doodstream: 'DDS', filemoon: 'FMN', mega: 'MEG', sendvid: 'SVD', myseed: 'MSD',
};
export function codeOf(name) {
  const n = String(name ?? '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
  for (const word of [n.replace(/\s+/g, ''), ...n.split(' ')]) if (KNOWN[word]) return KNOWN[word];
  for (const [k, v] of Object.entries(KNOWN)) if (n.includes(k)) return v;
  const letters = n.replace(/[^a-z]/g, '').toUpperCase();
  return (letters.slice(0, 3) || 'SRV').padEnd(3, 'X');
}

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

async function rt() {
  const r = getRuntime();
  await r.ready;
  return r;
}

// ───────────────────────── البحث ─────────────────────────

async function searchSource(r, def, query) {
  const { value } = await r.store.cached('source', `${def.id}|vsearch|${fold(query)}`, () => r.registry.call(def.id, (src) => src.search(query)), { ttlMs: 30 * 60 * 1000 });
  return (value ?? []).map((it) => ({ ...it, sourceId: def.id }));
}

const searches = new Map();

// ───────────────────────── الجلسات ─────────────────────────

const sessions = new Map();

function snapshot(s) {
  return { routes: [...s.routes.values()].map((r) => ({ ...r })), done: s.done, retryAt: 0 };
}

function upsert(s, route) {
  s.routes.set(route.id, route);
  if (!s.closed) emit('route', { session: s.id, retryAt: 0, route: { ...route } });
  for (const w of s.waiters.splice(0)) w();
}

async function episodesOf(r, copy) {
  const { value } = await r.store.cached('meta', `${copy.sourceId}|episodes|${copy.url}`, () => r.registry.call(copy.sourceId, (src) => src.episodes(copy)), { ttlMs: 30 * 60 * 1000 });
  return value ?? [];
}

/** مرشحون مرتّبون: الجودة الأقرب للمطلوبة (والأعلى عند التعادل). */
function rank(s, list) {
  const want = s.quality ?? 1080;
  return [...list].sort((a, b) => Math.abs((a.quality ?? want) - want) - Math.abs((b.quality ?? want) - want) || (b.quality ?? 0) - (a.quality ?? 0));
}

async function runCopy(r, s, copy, episode) {
  const source = r.registry.source(copy.sourceId);
  const def = r.registry.def(copy.sourceId);
  if (!source || !def) return;
  let eps;
  try {
    eps = await episodesOf(r, copy);
  } catch {
    return;
  }
  // فيلم: السينما تطلب الحلقة -1 (نفس عقد الـAPK) ⇒ الصفحة نفسها
  const ep = Number(episode) < 0
    ? eps[0] ?? null
    : eps.find((e) => Number(e.number) === Number(episode)) ?? (eps.length === 1 && Number(episode) === 1 ? eps[0] : null);
  if (!ep || s.closed) return;
  let servers;
  try {
    servers = await r.registry.call(copy.sourceId, (src) => src.servers(ep));
  } catch {
    return;
  }
  const routes = servers.map((sv) => ({
    id: `${copy.sourceId}|${sv.key}`,
    sourceId: copy.sourceId,
    server: sv.name,
    code: codeOf(sv.name),
    quality: sv.quality ?? null,
    variant: sv.variant ?? 'SUB',
    state: sv.unsupported ? 'UNAVAILABLE' : 'RESOLVING',
    candidates: [],
    reason: sv.unsupported ? 'غير مدعوم في نسخة الويب' : null,
  }));
  routes.forEach((route) => upsert(s, route));
  const work = servers
    .map((sv, i) => ({ sv, route: routes[i] }))
    .filter((x) => !x.sv.unsupported)
    .sort((a, b) => Number(b.sv.name === s.preferredServer && copy.sourceId === s.preferredSourceId) - Number(a.sv.name === s.preferredServer && copy.sourceId === s.preferredSourceId));
  // ثلاثة سيرفرات معًا لكل مصدر: سريع، ولا يُغرق الموقع
  let next = 0;
  const worker = async () => {
    while (next < work.length && !s.closed) {
      const { sv, route } = work[next++];
      try {
        const streams = await Promise.race([source.streams(sv), new Promise((_, rej) => setTimeout(() => rej(new Error('لم يرد خلال 45 ثانية')), 45_000))]);
        const ids = [];
        for (const st of streams ?? []) {
          const id = `${copy.sourceId}|${ep.url}|${st.url.length}|${ids.length}|${route.id}`;
          s.cands.set(id, { id, sourceId: copy.sourceId, sourceName: def.label, server: sv.name, code: route.code, route: route.id, url: st.url, referer: st.referer ?? null, type: st.type, quality: st.quality ?? sv.quality ?? null, variant: route.variant });
          ids.push(id);
        }
        // الفحص قبل «جاهز» لا بعده: مقطع «This video is temporarily unavailable» (Sendvid) ملف mp4
        // حقيقي من ثوانٍ؛ لو عُلّم جاهزًا أولًا لبدأ تشغيله قبل أن يُكشف
        const judged = await judgeCandidates(r, s, ids);
        const live = judged.ids;
        const quality = Math.max(0, ...live.map((id) => s.cands.get(id).quality ?? 0)) || route.quality;
        upsert(s, {
          ...route,
          state: live.length ? 'READY' : 'UNAVAILABLE',
          candidates: live,
          quality,
          ...(judged.probed !== null && live.length ? { probed: judged.probed, probeMs: judged.ms } : {}),
          reason: live.length ? null : ids.length ? judged.reason : 'لم يُستخرج رابط فيديو',
        });
      } catch (error) {
        upsert(s, { ...route, state: 'UNAVAILABLE', reason: String(error?.message ?? error) });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/** أصغر من هذا لا يكون حلقة أو فيلمًا: مقطع «غير متاح» من المضيف (Sendvid ~ مئات الكيلوبايت). */
export const MIN_REAL_BYTES = 3 * 1024 * 1024;

/**
 * حكم رابط واحد من أول بايتين عبر الجالب:
 *   true  وسائط حقيقية (أو قائمة HLS)
 *   false صفحة أو خطأ أو ملف أصغر من حلقة (مقطع بديل)، مع السبب
 *   null  لا حكم (بطء أو انقطاع الفحص): لا يُحجب الرابط
 */
export async function probeCandidate(r, c, { timeoutMs = 8000, fetchImpl = fetch } = {}) {
  try {
    await r.ensureMedia();
    const res = await fetchImpl(r.fetcher.mediaUrl(c.url, c.referer), { headers: { range: 'bytes=0-1' }, signal: AbortSignal.timeout(timeoutMs) });
    const type = res.headers.get('content-type') ?? '';
    void res.body?.cancel?.().catch?.(() => {});
    const hls = /mpegurl/i.test(type) || /\.m3u8/.test(c.url);
    if (!res.ok) return { ok: false, reason: `المضيف ردّ ${res.status}` };
    if (!hls && !/video|octet-stream|mp2t/i.test(type)) return { ok: false, reason: 'المضيف ردّ بصفحة لا فيديو' };
    const total = Number(/\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? NaN);
    if (!hls && Number.isFinite(total) && total < MIN_REAL_BYTES) return { ok: false, reason: 'مقطع بديل من المضيف (الفيديو غير متاح عنده)' };
    return { ok: true, reason: null };
  } catch {
    return { ok: null, reason: null };
  }
}

/** الروابط التي تُبقى لسيرفر: يُحذف ما حُكم عليه بوضوح؛ وما لا حكم عليه يبقى. */
async function judgeCandidates(r, s, ids) {
  const t0 = Date.now();
  const out = [];
  let reason = null;
  let probed = null;
  for (const id of ids.slice(0, 3)) {
    if (s.closed) break;
    const v = await probeCandidate(r, s.cands.get(id));
    if (v.ok === false) {
      reason = v.reason;
      continue;
    }
    out.push(id);
    if (v.ok === true) probed = true;
  }
  return { ids: [...out, ...ids.slice(3)], probed: out.length ? probed : false, reason, ms: Date.now() - t0 };
}

async function startCopies(r, s, copies) {
  const fresh = copies.filter((c) => c?.sourceId && !s.copies.has(`${c.sourceId}|${c.url}`));
  for (const c of fresh) s.copies.add(`${c.sourceId}|${c.url}`);
  s.running += 1;
  await Promise.all(fresh.map((c) => runCopy(r, s, c, s.episode)));
  s.running -= 1;
  if (s.running === 0 && !s.closed) {
    s.done = true;
    emit('prepared', { session: s.id, retryAt: 0 });
    for (const w of s.waiters.splice(0)) w();
  }
  return fresh.length;
}

function readyCandidates(s, prefer = null) {
  const ready = [...s.routes.values()].filter((r) => r.state === 'READY');
  const ordered = ready.sort((a, b) => Number(b.code === prefer) - Number(a.code === prefer));
  const out = [];
  for (const route of ordered) out.push(...rank(s, route.candidates.map((id) => s.cands.get(id)).filter(Boolean)));
  return prefer ? out : rank(s, out);
}

// ───────────────────────── الإضافة ─────────────────────────

export const AnimeEngine = {
  async configure() {
    return { ok: true, errors: [] };
  },

  async sources() {
    const r = await rt();
    return {
      sources: videoDefs(r).map((d) => ({
        id: d.id, name: d.label, content: d.content, enabled: true, disabledReason: null, loadError: null, domain: d.domain, catalog: null, web: true,
      })),
    };
  },

  async health() {
    const r = await rt();
    const status = r.registry.status();
    return {
      records: Object.entries(status)
        .filter(([id]) => r.registry.def(id)?.content !== 'manga')
        .map(([id, rec]) => ({ key: `source:${id}`, ok: rec.health?.ok ?? 0, fail: rec.health?.fail ?? 0, lastOk: rec.health?.lastOk ?? 0, lastError: rec.health?.lastError ?? null, blockedUntil: rec.health?.coolUntil ?? 0, domain: rec.stable?.def?.domain ?? null })),
    };
  },

  async unblock() {},

  async verify() {
    return { ok: false, error: 'التحقق اليدوي غير متاح في نسخة الويب' };
  },

  async diagnose({ sourceId, query = 'naruto' }) {
    const r = await rt();
    const steps = [];
    const step = async (label, fn) => {
      const t0 = Date.now();
      try {
        const detail = await fn();
        steps.push({ label, state: 'ok', detail: `${detail} · ${Date.now() - t0}ms` });
        return true;
      } catch (e) {
        steps.push({ label, state: 'fail', detail: e?.message ?? String(e) });
        return false;
      }
    };
    const src = r.registry.source(sourceId);
    if (!src) return { steps: [{ label: 'المصدر', state: 'fail', detail: 'غير متاح في نسخة الويب' }] };
    let items = [];
    let eps = [];
    let servers = [];
    if (await step(`بحث «${query}»`, async () => `${(items = await src.search(query)).length} نتيجة`)) {
      if (items[0] && await step(`حلقات «${items[0].title}»`, async () => `${(eps = await src.episodes(items[0])).length} حلقة`)) {
        if (eps[0] && await step('السيرفرات', async () => `${(servers = await src.servers(eps[0])).length} سيرفر`)) {
          for (const sv of servers.slice(0, 3)) await step(`تشغيل ${sv.name}`, async () => `${(await src.streams(sv)).length} رابط`);
        }
      }
    }
    return { steps };
  },

  async search({ query, content = 'anime' }) {
    const r = await rt();
    const defs = videoDefs(r, content);
    const lists = await Promise.all(defs.map((d) => searchSource(r, d, query).catch(() => [])));
    const works = new Map();
    for (const it of lists.flat()) {
      const key = fold(it.title);
      const w = works.get(key) ?? { key, title: it.title, thumbnail: it.thumbnail ?? null, copies: [] };
      if (!w.copies.some((c) => c.sourceId === it.sourceId)) w.copies.push(it);
      w.thumbnail ??= it.thumbnail ?? null;
      works.set(key, w);
    }
    return { works: [...works.values()] };
  },

  async searchStream({ query, content = 'anime', searchId = rid('q'), timeoutMs = 25_000 }) {
    const r = await rt();
    const job = { cancelled: false };
    searches.set(searchId, job);
    void (async () => {
      await Promise.all(
        videoDefs(r, content).map(async (def) => {
          const t0 = Date.now();
          if (r.registry.cooling(def.id)) {
            if (!job.cancelled) emit('searchHit', { searchId, sourceId: def.id, ms: 0, items: [], error: 'يرتاح بعد أعطال', skipped: true, needsHuman: false });
            return;
          }
          let items = [];
          let error = null;
          let needsHuman = false;
          try {
            items = await Promise.race([searchSource(r, def, query), new Promise((_, rej) => setTimeout(() => rej(new Error('لم يرد في الوقت')), timeoutMs))]);
          } catch (e) {
            error = e?.message ?? String(e);
            needsHuman = e?.code === 'challenge' && e?.challenge === 'interactive';
          }
          if (!job.cancelled) emit('searchHit', { searchId, sourceId: def.id, ms: Date.now() - t0, items, error, skipped: false, needsHuman });
        }),
      );
      searches.delete(searchId);
      emit('searchDone', { searchId });
    })();
    return { searchId };
  },

  async cancelSearch({ searchId }) {
    const job = searches.get(searchId);
    if (job) job.cancelled = true;
  },

  async details({ anime }) {
    return { anime };
  },

  async episodes({ anime }) {
    const r = await rt();
    return { episodes: await episodesOf(r, anime) };
  },

  async prepare({ copies, episode, quality = 1080, variant = 'SUB', preferredSourceId = null, preferredServer = null, session = null, probe = false }) {
    const r = await rt();
    const id = session ?? rid('s');
    const s = { id, episode: Number(episode), quality, variant, probe: Boolean(probe), preferredSourceId, preferredServer, routes: new Map(), cands: new Map(), copies: new Set(), done: false, closed: false, running: 0, waiters: [] };
    sessions.set(id, s);
    const ordered = preferredSourceId ? [...copies].sort((a, b) => Number(b.sourceId === preferredSourceId) - Number(a.sourceId === preferredSourceId)) : copies;
    void startCopies(r, s, ordered ?? []);
    return { session: id, ...snapshot(s) };
  },

  async extend({ session, copies }) {
    const s = sessions.get(session);
    if (!s || s.closed) return { added: 0 };
    const r = await rt();
    s.done = false;
    return { added: await startCopies(r, s, copies ?? []) };
  },

  async routes({ session }) {
    const s = sessions.get(session);
    return s ? snapshot(s) : { routes: [], done: true, retryAt: 0 };
  },

  async best({ session, prefer = null, waitMs = 45_000 }) {
    const s = sessions.get(session);
    if (!s) throw new Error('الجلسة انتهت');
    const until = Date.now() + waitMs;
    while (!readyCandidates(s, prefer).length && !s.done && Date.now() < until) {
      await new Promise((resolve) => {
        s.waiters.push(resolve);
        setTimeout(resolve, 1000);
      });
    }
    const c = readyCandidates(s, prefer)[0] ?? null;
    return { candidate: c?.id ?? null, route: c?.route ?? null, code: c?.code ?? null };
  },

  async pick({ session, route }) {
    const s = sessions.get(session);
    if (!s) throw new Error('الجلسة انتهت');
    const r = s.routes.get(route);
    return { candidate: rank(s, (r?.candidates ?? []).map((id) => s.cands.get(id)).filter(Boolean))[0]?.id ?? null };
  },

  async play(args) {
    const s = sessions.get(args.session);
    if (!s) throw new Error('الجلسة انتهت، افتحها من جديد');
    const r = await rt();
    const { openPlayer } = await import('../player/player.js');
    openPlayer({ ...args, runtime: r, engine: AnimeEngine, sessionOf: (id) => sessions.get(id), readyCandidates, emit });
  },

  async closeSession({ session }) {
    const s = sessions.get(session);
    if (s) {
      s.closed = true;
      sessions.delete(session);
    }
  },

  async outbox() {
    return { items: [] };
  },

  async crawl() {},
  async stopCrawl() {},

  addListener(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return { remove: async () => listeners.get(event)?.delete(fn) };
  },
};
