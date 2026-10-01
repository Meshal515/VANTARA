/**
 * «آخر التحديثات» — الخط الزمني من ذاكرة VANTARA (`Update Engine`).
 *
 * نفس السلوك في الأقسام الثلاثة (قانون التوحيد): الجديد فوق، القديم تحته ولا
 * يختفي، أيام بعناوين، ووقت نسبي حقيقي. الألوان من رموز القسم وحدها.
 * لا يُعاد ترتيب شيء بسبب ردود المصادر: الترتيب وقت ثابت من الخادم.
 */

import { timeline } from '../lib/update-engine.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

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
export function mountTimeline(host, { section, el, open, empty, image }) {
  const state = { events: [], next: null, loading: false, done: false, token: {} };
  const token = state.token;
  host.replaceChildren();
  host.classList.add('up-feed');
  const list = el('div', 'up-list');
  const more = el('div', 'up-more');
  host.append(list, more);

  const row = (g) => {
    const b = el('button', 'up-row');
    b.type = 'button';
    const art = el('span', 'up-art');
    if (g.cover) art.append(image(g.cover));
    const copy = el('span', 'up-copy');
    const t = el('b', 'up-title', g.title);
    t.dir = 'auto';
    const unit = el('span', 'up-unit', unitLabel(g));
    unit.dir = g.season != null && g.kind !== 'movie' ? 'ltr' : 'auto';
    copy.append(t, unit);
    const side = el('span', 'up-side');
    side.append(el('time', 'up-time', agoAr(g.at)));
    if (g.sources.length > 1) side.append(el('span', 'up-sources', `${g.sources.length} مصادر`));
    b.append(art, copy, side);
    b.onclick = () => open(g);
    return b;
  };

  const paint = () => {
    const groups = groupEvents(state.events);
    const nodes = [];
    let day = null;
    for (const g of groups) {
      const d = dayOf(g.at);
      if (d !== day) {
        day = d;
        nodes.push(el('h3', 'up-day', d));
      }
      nodes.push(row(g));
    }
    list.replaceChildren(...nodes);
    if (!state.events.length && state.done) list.replaceChildren(empty());
  };

  const load = async () => {
    if (state.loading || state.done) return;
    state.loading = true;
    more.textContent = state.events.length ? 'نحمّل الأقدم…' : '';
    if (!state.events.length) list.replaceChildren(...Array.from({ length: 6 }, () => el('div', 'up-skel')));
    const page = await timeline(section, { before: state.next });
    if (token !== state.token) return;
    state.loading = false;
    if (!page) {
      more.textContent = '';
      if (!state.events.length) {
        state.done = true;
        list.replaceChildren(empty());
      }
      return;
    }
    state.events.push(...page.events);
    state.next = page.next;
    state.done = !page.next;
    more.textContent = '';
    paint();
  };

  // المزيد عند الاقتراب من آخر القائمة
  const io = typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void load(), { rootMargin: '600px' });
  io?.observe(more);
  void load();
  return {
    refresh() {
      state.token = {};
      io?.disconnect();
      return mountTimeline(host, { section, el, open, empty, image });
    },
  };
}

/** أول N تحديثات (لشريط الرئيسية)، مجمّعة. */
export async function latestGroups(section, n = 14) {
  const page = await timeline(section, { limit: 40 });
  return page ? groupEvents(page.events).slice(0, n) : null;
}
