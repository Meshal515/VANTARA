/**
 * «آخر التحديثات» — الخط الزمني من ذاكرة VANTARA (`Update Engine`).
 *
 * نفس السلوك في الأقسام الثلاثة (قانون التوحيد): الجديد فوق، القديم تحته ولا
 * يختفي، ثلاث بطاقات في الصف، ووقت نسبي حقيقي على كل بطاقة. الألوان من رموز القسم وحدها.
 * لا يُعاد ترتيب شيء بسبب ردود المصادر: الترتيب وقت ثابت من الخادم.
 */

import { timeline } from '../lib/update-engine.js';
import { decodeEntities, normalizeTitle } from '../lib/catalog.js';
import { loadAliases } from '../lib/manga-alias-store.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Catch-up is persisted by the server, but never masquerades as a live release. */
export function mergeTimelineEvents(visible, incoming, { enteredAt, now = Date.now(), refresh = false }) {
  const known = new Map(visible.map((e) => [e.id, e]));
  let inserted = false;
  for (const event of incoming) {
    const p = event.publishedAt;
    const observed = event.observedAdvance === true && Number.isFinite(event.firstSeenAt) && event.firstSeenAt > 0 && event.firstSeenAt <= now && (event.firstSeenAt >= enteredAt || now - event.firstSeenAt <= 90_000);
    const live = observed || (Number.isFinite(p) && p > 0 && p <= now && (p >= enteredAt || now - p <= 90_000));
    if (known.has(event.id)) known.set(event.id, { ...event, at: known.get(event.id).at });
    else if (refresh || live) { known.set(event.id, event); inserted = true; }
  }
  const events = [...known.values()];
  return inserted ? events.sort((a, b) => b.at - a.at || String(b.id).localeCompare(String(a.id))) : events;
}

/**
 * Reconcile newer pages without dropping older pages: those may be offscreen
 * and expensive to reload (especially covers on mobile PWA and WebView).
 */
export function reconcileTimelineRefresh(visible, incoming, now = Date.now()) {
  return mergeTimelineEvents(visible, incoming, { enteredAt: 0, now, refresh: true });
}

/** Preserve the first visible card's screen position while newer cards are added above it. */
function scrollingParent(node, view) {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (parent === node.ownerDocument?.scrollingElement) break;
    const overflow = view?.getComputedStyle?.(parent)?.overflowY;
    if (/^(auto|scroll|overlay)$/.test(overflow)) return parent;
  }
  return null;
}

export function paintWithScrollAnchor(list, paint, view = list.ownerDocument?.defaultView) {
  const scroller = scrollingParent(list, view);
  const rect = scroller?.getBoundingClientRect();
  const top = Math.max(0, rect ? rect.top + (scroller.clientTop ?? 0) : 0);
  const bottom = Math.min(view?.innerHeight ?? Infinity, rect ? top + scroller.clientHeight : Infinity);
  const anchor = [...list.children].find(node => {
    if (!node.dataset?.eventId || typeof node.getBoundingClientRect !== 'function') return false;
    const rect = node.getBoundingClientRect();
    return rect.bottom > top && rect.top < bottom;
  });
  const id = anchor?.dataset.workKey ?? anchor?.dataset.eventId;
  const before = anchor?.getBoundingClientRect().top;
  paint();
  if (!id || !Number.isFinite(before)) return;
  const retained = [...list.children].find(node => (node.dataset?.workKey ?? node.dataset?.eventId) === id);
  if (!retained) return;
  const delta = retained.getBoundingClientRect().top - before;
  if (Number.isFinite(delta) && Math.abs(delta) > 0.5) {
    if (scroller?.scrollBy) scroller.scrollBy(0, delta);
    else if (scroller) scroller.scrollTop += delta;
    else view?.scrollBy?.(0, delta);
  }
}

const mounted = new WeakMap();
const groupKey = g => `${g.section ?? ''}|${g.work}`;
const eventTime = (g, now = Date.now()) => Number.isFinite(g.publishedAt) && g.publishedAt > 0
  ? agoAr(g.at, now) : `رُصد ${agoAr(g.at, now)}`;

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
 * حدثٌ سُجّل بعنوان منسوخ من HTML («Don&#039;t Breathe»): يُعرض مفكوكًا، ومفتاح
 * المانجا يُعاد منه فيلتقي بالعمل نفسه (غلافه ونسخه) بدل بطاقة يتيمة بحرف.
 */
export function canonicalEvent(e) {
  const title = decodeEntities(e.title);
  if (title === e.title) return e;
  const work = e.section === 'manga' && String(e.work).startsWith('ext:') ? `ext:${normalizeTitle(title)}` : e.work;
  return { ...e, title, work };
}

/**
 * بطاقة واحدة لكل عمل في مكان أحدث ما نزل منه، ومعها كم وحدة أخرى نزلت قبله
 * («الفصل 201 +2»). كانت الدفعات تُدمج متتالية فقط، فعملٌ تخلّلته أعمال يظهر
 * مرتين وثلاثًا في الشبكة نفسها. الترتيب يبقى صادقًا: أحدث حدث يقرّر الموضع.
 */
export function groupEvents(events, canonical = null) {
  const out = [];
  const byWork = new Map();
  for (const raw of events) {
    let e = canonicalEvent(raw);
    // نفس العمل بأسماء مختلفة («Magic Emperor» و«Demonic Emperor»): مفتاح الهوية الواحدة
    const same = canonical?.get(e.work);
    if (same && same !== e.work) e = { ...e, work: same };
    const key = `${e.section ?? ''}|${e.work}`;
    const g = byWork.get(key);
    if (!g) {
      const group = { ...e, events: [e], high: e.number ?? 0, low: e.number ?? 0, sources: e.sources ?? [], units: new Set([`${e.season ?? ''}:${e.number}`]) };
      byWork.set(key, group);
      out.push(group);
      continue;
    }
    g.sources = [...new Map([...g.sources, ...(e.sources ?? [])].map((s) => [s.s, s])).values()];
    g.cover ??= e.cover;
    // نفس الفصل من مفتاحين قديمين (قبل التصحيح) لا يُعدّ مرتين
    const unit = `${e.season ?? ''}:${e.number}`;
    if (g.units.has(unit)) continue;
    g.units.add(unit);
    g.events.push(e);
    if ((e.season ?? null) === (g.season ?? null)) {
      g.low = Math.min(g.low, e.number ?? 0);
      g.high = Math.max(g.high, e.number ?? 0);
    }
  }
  for (const g of out) delete g.units;
  return out;
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

/** «الفصل 401»، «الفصول 399–401»، «الحلقة 8»، «S02E05»، «متاح الآن». */
export function unitLabel(g) {
  const many = g.events?.length > 1 && g.low !== g.high;
  if (g.kind === 'movie') return 'فيلم';
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
export function mountTimeline(host, { section, el, open, empty, image, mountCover, canonical = null, visible = () => host.isConnected }) {
  mounted.get(host)?.dispose();
  const state = { events: [], next: null, bridgeNext: null, bridgeKnown: null, loading: false, refreshing: false, done: false, token: {}, enteredAt: Date.now(), polled: false };
  const token = state.token, active = () => token === state.token;
  host.replaceChildren();
  host.classList.add('up-feed');
  const list = el('div', 'up-list'), more = el('div', 'up-more');
  host.append(list, more);
  const refresh = el('button', 'link', 'تحديث');
  const older = el('button', 'link up-load-more', 'تحميل المزيد');
  const status = el('span', 'up-status');
  status.setAttribute('role', 'status');
  refresh.type = older.type = 'button';
  refresh.onclick = () => void api.refresh();
  older.onclick = () => void api.loadMore();
  more.append(older, refresh, status);
  let inView = false, autoTimer = null, polling = false;
  const view = host.ownerDocument?.defaultView;
  const scrollRoot = scrollingParent(list, view);
  function controls() {
    refresh.disabled = state.loading || state.refreshing;
    older.disabled = state.loading || state.refreshing;
    older.hidden = (state.done && !state.bridgeNext) || !state.polled;
    refresh.textContent = state.refreshing ? 'جارٍ التحديث…' : 'تحديث';
    older.textContent = state.loading ? 'جارٍ التحميل…' : 'تحميل المزيد';
  }
  function error() {
    status.textContent = 'تعذّر جلب التحديثات. أعد المحاولة.';
    if (!state.events.length) list.replaceChildren(el('div', 'up-error', 'تعذّر جلب آخر التحديثات. اضغط تحديث لإعادة المحاولة.'));
  }
  function updateCard(b, g) {
    const previous = b._group;
    // New chapters change the event ID, but retain the work's actual DOM and image.
    if (!previous || (!previous.cover && g.cover)) {
      const art = b.querySelector('.up-art');
      if (mountCover) mountCover(art, g);
      else if (g.cover) art.append(image(g.cover));
    }
    b.querySelector('.up-title').textContent = g.title;
    const unit = b.querySelector('.up-unit');
    unit.textContent = unitLabel({ ...g, low: g.high, events: [g] });
    unit.dir = g.season != null && g.kind !== 'movie' ? 'ltr' : 'auto';
    let plus = b.querySelector('.up-plus');
    const extra = g.events.length - 1;
    if (extra > 0) {
      if (!plus) { plus = el('span', 'up-plus'); plus.dir = 'ltr'; b.querySelector('.up-line').append(plus); }
      plus.textContent = `+${extra}`;
    } else plus?.remove();
    b.querySelector('.up-when').textContent = eventTime(g);
    b._group = g;
    b.dataset.eventId = g.id;
    b.dataset.workKey = groupKey(g);
  }
  function row(g) {
    const b = el('button', 'up-card'); b.type = 'button';
    const title = el('b', 'up-title'); title.dir = 'auto';
    const line = el('span', 'up-line'); line.append(el('span', 'up-unit'));
    b.append(el('span', 'up-art'), title, line, el('span', 'up-when'));
    b.onclick = () => open(b._group);
    updateCard(b, g);
    return b;
  }
  function paint() {
    const before = new Map([...list.children].map(n => [n.dataset.workKey, n]));
    const next = groupEvents(state.events, canonical?.(state.events) ?? null).map(g => {
      const node = before.get(groupKey(g));
      if (node) { updateCard(node, g); return node; }
      return row(g);
    });
    const keep = new Set(next);
    next.forEach((node, i) => { if (list.children[i] !== node) list.insertBefore(node, list.children[i] ?? null); });
    for (const node of [...list.children]) if (!keep.has(node)) node.remove();
    if (!state.events.length && state.done) list.replaceChildren(empty());
  }
  function continueVisible() {
    clearTimeout(autoTimer);
    if (!active() || (state.done && !state.bridgeNext) || !inView || !visible() || document.hidden) return;
    // An observer need not fire again while deduplicated pages leave the sentinel visible.
    autoTimer = setTimeout(() => {
      if (!active() || !visible() || document.hidden) return;
      const bounds = more.getBoundingClientRect?.();
      const viewport = scrollRoot?.getBoundingClientRect?.();
      if (bounds && (bounds.top > (viewport?.bottom ?? view?.innerHeight ?? Infinity) + 600 || bounds.bottom < (viewport?.top ?? 0) - 600)) return;
      void load();
    }, 0);
  }
  const load = async () => {
    if (!active() || state.loading || state.refreshing || (state.done && !state.bridgeNext)) return false;
    state.loading = true; controls(); status.textContent = '';
    if (!state.events.length) list.replaceChildren(...Array.from({ length: 6 }, () => el('div', 'up-skel')));
    let success = false;
    try {
      if (section === 'manga') await loadAliases();
      if (!active()) return false;
      const requestedCursor = state.bridgeNext ?? state.next;
      const page = await timeline(section, { before: requestedCursor });
      if (!active()) return false;
      if (!page || !Array.isArray(page.events)) { error(); return false; }
      if (page.next && page.next === requestedCursor) { error(); return false; }
      state.events = [...new Map([...state.events, ...page.events].map(e => [e.id, e])).values()];
      if (!state.polled) { state.enteredAt = page.snapshotAt ?? state.enteredAt; state.polled = true; }
      if (state.bridgeNext) {
        if (!page.next || page.events.some(e => state.bridgeKnown?.has(e.id))) { state.bridgeNext = null; state.bridgeKnown = null; }
        else state.bridgeNext = page.next;
      } else { state.next = page.next; state.done = !page.next; }
      paintWithScrollAnchor(list, paint);
      success = true;
      return true;
    } catch { if (active()) error(); return false; }
    finally { if (active()) { state.loading = false; controls(); if (success) continueVisible(); } }
  };
  const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
    inView = entries.some(e => e.isIntersecting);
    if (inView) void load();
  }, { root: scrollRoot, rootMargin: '600px' });
  io?.observe(more);
  const timer = setInterval(async () => {
    if (!host.isConnected || !host.classList.contains('up-feed')) { api.dispose(); return; }
    if (!state.polled || polling || state.loading || state.refreshing || !visible() || document.hidden) return;
    polling = true;
    try {
      if (section === 'manga') await loadAliases();
      const requestedCursor = state.bridgeNext;
      const page = await timeline(section, { limit: 100, ...(requestedCursor ? { before: requestedCursor } : {}) });
      if (!active() || !page || !Array.isArray(page.events)) return;
      if (requestedCursor && page.next === requestedCursor) return;
      const previous = new Set(state.events.map(e => e.id));
      if (requestedCursor) {
        if (!page.next || page.events.some(e => state.bridgeKnown?.has(e.id))) { state.bridgeNext = null; state.bridgeKnown = null; }
        else state.bridgeNext = page.next;
      } else if (previous.size && page.next && !page.events.some(e => previous.has(e.id))) {
        state.bridgeKnown = previous; state.bridgeNext = page.next;
      }
      state.events = mergeTimelineEvents(state.events, page.events, { enteredAt: state.enteredAt, now: page.snapshotAt ?? Date.now() });
      paintWithScrollAnchor(list, paint);
      controls();
    } catch { /* The existing timeline stays visible during a transient outage. */ }
    finally { polling = false; }
  }, 5000);
  const api = {
    dispose() { state.token = {}; clearInterval(timer); clearTimeout(autoTimer); io?.disconnect(); },
    loadMore: load,
    async refresh() {
      if (!active() || state.loading || state.refreshing) return false;
      state.refreshing = true; controls(); status.textContent = '';
      try {
        if (section === 'manga') await loadAliases();
        if (!active()) return false;
        const page = await timeline(section, { limit: 100 });
        if (!active()) return false;
        if (!page || !Array.isArray(page.events)) { error(); return false; }
        if (!state.events.length) { state.next = page.next; state.done = !page.next; }
        else if (!state.bridgeNext && page.next && !page.events.some(e => state.events.some(old => old.id === e.id))) {
          // More than 100 releases may have arrived since the retained pages.
          // Bridge that gap before resuming the original historical cursor.
          state.bridgeKnown = new Set(state.events.map(e => e.id)); state.bridgeNext = page.next;
        }
        state.events = reconcileTimelineRefresh(state.events, page.events, page.snapshotAt ?? Date.now());
        if (!state.polled) { state.enteredAt = page.snapshotAt ?? state.enteredAt; state.polled = true; }
        paintWithScrollAnchor(list, paint);
        return true;
      } catch { if (active()) error(); return false; }
      finally { if (active()) { state.refreshing = false; controls(); } }
    },
  };
  mounted.set(host, api);
  controls();
  void load();
  return api;
}

/** أول N تحديثات (لشريط الرئيسية)، مجمّعة. */
export async function latestGroups(section, n = 14, canonical = null) {
  if (section === 'manga') await loadAliases();
  const page = await timeline(section, { limit: 40 });
  return page ? groupEvents(page.events, canonical?.(page.events) ?? null).slice(0, n) : null;
}
