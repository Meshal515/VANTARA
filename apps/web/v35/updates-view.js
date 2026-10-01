/**
 * «آخر التحديثات» — الخط الزمني من ذاكرة VANTARA (`Update Engine`).
 *
 * نفس السلوك في الأقسام الثلاثة (قانون التوحيد): الجديد فوق، القديم تحته ولا
 * يختفي، ثلاث بطاقات في الصف، ووقت نسبي حقيقي على كل بطاقة. الألوان من رموز القسم وحدها.
 * لا يُعاد ترتيب شيء بسبب ردود المصادر: الترتيب وقت ثابت من الخادم.
 */

import { timeline } from '../lib/update-engine.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Catch-up is persisted by the server, but never masquerades as a live release. */
export function mergeTimelineEvents(visible, incoming, { enteredAt, now = Date.now(), refresh = false }) {
  const known = new Map(visible.map((e) => [e.id, e]));
  let inserted = false;
  for (const event of incoming) {
    const p = event.publishedAt;
    const live = Number.isFinite(p) && p > 0 && p <= now && (p >= enteredAt || now - p <= 90_000);
    if (known.has(event.id)) known.set(event.id, { ...event, at: known.get(event.id).at });
    else if (refresh || live) { known.set(event.id, event); inserted = true; }
  }
  const events = [...known.values()];
  return inserted ? events.sort((a, b) => b.at - a.at || String(b.id).localeCompare(String(a.id))) : events;
}

const mounted = new WeakMap();

/** «الآن»، «قبل دقيقتين»، «قبل 3 ساعات»، «أمس»… */
export function agoAr(at, now = Date.now()) {
  const d = Math.max(0, now - at);
  if (d < MIN) return 'الآن';
  const plural = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
  if (d < HOUR) return `قبل ${plural(Math.floor(d / MIN), 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')}`;
  if (d < DAY) return `قبل ${plural(Math.floor(d / HOUR), 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`;
  const start = new Date(now).setHours(0, 0, 0, 0);
  if (at >= start - DAY) return 'أمس';
  if (d < 7 * DAY) return `قبل ${plural(Math.ceil((start - at) / DAY), 'يوم', 'يومين', 'أيام', 'يومًا')}`;
  return new Date(at).toLocaleDateString('ar', { day: 'numeric', month: 'long', numberingSystem: 'latn' });
}

export function dayOf(at, now = Date.now()) {
  const start = new Date(now).setHours(0, 0, 0, 0);
  if (at >= start) return 'اليوم';
  if (at >= start - DAY) return 'أمس';
  return new Date(at).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long', numberingSystem: 'latn' });
}

/**
 * أحداث متتالية لنفس العمل في نفس الساعات (دفعة فصول) تُعرض بطاقة واحدة:
 * «الفصول 399–401». لا تُدمج عبر عمل آخر بينها: الترتيب الزمني يبقى صادقًا.
 */
export function groupEvents(events, windowMs = 6 * HOUR) {
  const out = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last.work === e.work && last.kind === e.kind && (last.season ?? null) === (e.season ?? null) && last.at - e.at <= windowMs) {
      last.events.push(e);
      last.low = Math.min(last.low, e.number ?? 0);
      last.sources = [...new Map([...last.sources, ...(e.sources ?? [])].map((s) => [s.s, s])).values()];
      continue;
    }
    out.push({ ...e, events: [e], high: e.number ?? 0, low: e.number ?? 0, sources: e.sources ?? [] });
  }
  return out;
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

/** «الفصل 401»، «الفصول 399–401»، «الحلقة 8»، «S02E05»، «متاح الآن». */
export function unitLabel(g) {
  const many = g.events?.length > 1 && g.low !== g.high;
  if (g.kind === 'movie') return 'متاح الآن';
  if (g.kind === 'chapter') return many ? `الفصول ${fmt(g.low)}–${fmt(g.high)}` : `الفصل ${fmt(g.high)}`;
  if (g.season != null) {
    const s = String(g.season).padStart(2, '0');
    return many ? `S${s} · E${fmt(g.low)}–${fmt(g.high)}` : `S${s}E${String(fmt(g.high)).padStart(2, '0')}`;
  }
  return many ? `الحلقات ${fmt(g.low)}–${fmt(g.high)}` : `الحلقة ${fmt(g.high)}`;
}

/**
 * يرسم الخط الزمني في `host` ويحمّل المزيد بالتمرير. `open(group)` يفتح العمل.
 * `empty()` ما يُعرض قبل أن يسجّل VANTARA أي تحديث لهذا القسم.
 */
export function mountTimeline(host, { section, el, open, empty, image, mountCover, visible = () => host.isConnected }) {
  mounted.get(host)?.dispose();
  const state = { events: [], next: null, loading: false, done: false, token: {}, enteredAt: Date.now(), polled: false };
  const token = state.token;
  host.replaceChildren();
  host.classList.add('up-feed');
  const list = el('div', 'up-list');
  const more = el('div', 'up-more');
  host.append(list, more);
  const refresh = el('button', 'link', 'تحديث');
  refresh.type = 'button';
  refresh.onclick = () => mounted.get(host)?.refresh();
  more.append(refresh);

  // بطاقة: الغلاف كاملًا بلا ما يغطيه، وتحته الاسم ثم «الفصل 401» ثم الوقت والمصادر
  const row = (g) => {
    const b = el('button', 'up-card');
    b.type = 'button';
    const art = el('span', 'up-art');
    if (mountCover) mountCover(art, g);
    else if (g.cover) art.append(image(g.cover));
    const t = el('b', 'up-title', g.title);
    t.dir = 'auto';
    // دفعة فصول: الأحدث وبجانبه كم معه («الفصل 201 +2») بدل مدى طويل لا يتسع
    const unit = el('span', 'up-unit', unitLabel({ ...g, low: g.high, events: [g] }));
    unit.dir = g.season != null && g.kind !== 'movie' ? 'ltr' : 'auto';
    const extra = g.events.length - 1;
    const line = el('span', 'up-line');
    line.append(unit);
    if (extra > 0) {
      const plus = el('span', 'up-plus', `+${extra}`);
      plus.dir = 'ltr';
      line.append(plus);
    }
    b.append(art, t, line, el('span', 'up-when', agoAr(g.at)));
    b.onclick = () => open(g);
    b._group = g;
    b.dataset.eventId = g.id;
    return b;
  };

  // شبكة متصلة بلا عناوين أيام (كانت تترك فراغات): الوقت على كل بطاقة يكفي
  const paint = () => {
    const before = new Map([...list.children].map((n) => [n.dataset.eventId, n]));
    const next = groupEvents(state.events).map((g) => {
      const node = before.get(g.id);
      if (node && JSON.stringify(node._group) === JSON.stringify(g)) return node;
      return row(g);
    });
    next.forEach((node, i) => { if (list.children[i] !== node) list.insertBefore(node, list.children[i] ?? null); });
    for (const node of [...list.children]) if (!next.includes(node)) node.remove();
    if (!state.events.length && state.done) list.replaceChildren(empty());
  };

  const load = async () => {
    if (state.loading || state.done) return;
    state.loading = true;
    refresh.disabled = true;
    if (!state.events.length) list.replaceChildren(...Array.from({ length: 6 }, () => el('div', 'up-skel')));
    const page = await timeline(section, { before: state.next });
    if (token !== state.token) return;
    state.loading = false;
    if (!page) {
      refresh.disabled = false;
      if (!state.events.length) {
        state.done = true;
        list.replaceChildren(empty());
      }
      return;
    }
    state.events = [...new Map([...state.events, ...page.events].map((e) => [e.id, e])).values()];
    if (!state.polled) { state.enteredAt = page.snapshotAt ?? state.enteredAt; state.polled = true; }
    state.next = page.next;
    state.done = !page.next;
    refresh.disabled = false;
    paint();
  };

  // المزيد عند الاقتراب من آخر القائمة
  const io = typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void load(), { rootMargin: '600px' });
  io?.observe(more);
  void load();
  let polling = false;
  const timer = setInterval(async () => {
    if (!host.isConnected || !host.classList.contains('up-feed')) { api.dispose(); return; }
    if (!state.polled || polling || state.loading || !visible() || document.hidden) return;
    polling = true;
    try {
      const page = await timeline(section, { limit: 100 });
      if (token !== state.token || !page) return;
      const next = mergeTimelineEvents(state.events, page.events, { enteredAt: state.enteredAt, now: page.snapshotAt ?? Date.now() });
      if (JSON.stringify(next) !== JSON.stringify(state.events)) { state.events = next; paint(); }
    } finally { polling = false; }
  }, 5000);
  const api = {
    dispose() { state.token = {}; clearInterval(timer); io?.disconnect(); },
    refresh() {
      return mountTimeline(host, { section, el, open, empty, image, mountCover, visible });
    },
  };
  mounted.set(host, api);
  return api;
}

/** أول N تحديثات (لشريط الرئيسية)، مجمّعة. */
export async function latestGroups(section, n = 14) {
  const page = await timeline(section, { limit: 40 });
  return page ? groupEvents(page.events).slice(0, n) : null;
}
