import { flushFollowTime } from '../lib/follow-time.js';
import { glyph } from './icons.js';
import { createSilk } from '../lib/silk.js';
import { paletteFromAccent } from '../lib/silk-palette.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

export const duration = (ms) => {
  const value = Math.max(0, Number(ms) || 0);
  const mins = Math.floor(value / 60000);
  if (value > 0 && mins === 0) return 'أقل من دقيقة';
  if (mins < 60) return `${mins} د`;
  return `${Math.floor(mins / 60)} س ${String(mins % 60).padStart(2, '0')} د`;
};

/** اللون من بكسلات الغلاف نفسه إن سمحت استجابة الصورة بقراءتها؛ محفوظ لكل غلاف. */
function coverTone(img, key, bar) {
  const cacheKey = `vantara.cover-tone.${key}`;
  try {
    const saved = localStorage.getItem(cacheKey);
    if (saved && /^#[0-9a-f]{6}$/.test(saved)) { bar.style.setProperty('--insight-color', saved); return; }
  } catch { /* storage disabled */ }
  const sample = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 12;
      const c = canvas.getContext('2d', { willReadFrequently: true });
      c.drawImage(img, 0, 0, 12, 12);
      const pixels = c.getImageData(0, 0, 12, 12).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 160) continue;
        const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
        const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
        if (max - min < 20 || max < 35 || min > 215) continue;
        r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++;
      }
      if (!n) return;
      const hex = [r, g, b].map((v) => Math.round(v / n * 0.55 + 28).toString(16).padStart(2, '0')).join('');
      bar.style.setProperty('--insight-color', `#${hex}`);
      try { localStorage.setItem(cacheKey, `#${hex}`); } catch { /* storage disabled */ }
    } catch { /* cross-origin covers retain the calm theme fallback */ }
  };
  if (img.complete && img.naturalWidth) sample();
  else img.addEventListener('load', sample, { once: true });
}

const HIDE_KEY = 'vantara.insights.hidden.v1';
const SHORT_MS = 10 * 60_000;
const FILTERS = [['all', 'الكل'], ['manga', 'المانجا'], ['anime', 'الأنمي'], ['cinema', 'السينما']];

/** خمسة أشخاص كحد أقصى في الدائرة الواحدة؛ عشرة = دائرتان. */
export function pieGroups(people, size = 5) {
  const out = [];
  for (let i = 0; i < people.length; i += size) out.push(people.slice(i, i + size));
  return out;
}
/** الشرائح بزوايا (درجات من الأعلى مع عقارب الساعة)، ومقاس الأفاتار محصور فلا يغطي ولا يختفي. */
export function pieSlices(group, { gap = 2, min = 22, max = 34 } = {}) {
  const total = group.reduce((t, p) => t + p.ms, 0);
  let at = 0;
  return group.map((p) => {
    const frac = total ? p.ms / total : 1 / group.length;
    const sweep = frac * 360;
    const s = { ...p, frac, start: at, sweep: Math.max(0, sweep - (group.length > 1 ? gap : 0)), mid: at + sweep / 2, avatar: Math.round(Math.min(max, Math.max(min, min + (max - min) * Math.min(1, frac * 2.5)))) };
    at += sweep;
    return s;
  });
}
/** الأعمال الأقل من عشر دقائق تُطوى تحت «عرض المزيد». */
export function splitShort(content, threshold = SHORT_MS) {
  return { main: content.filter((r) => r.activeMs >= threshold), short: content.filter((r) => r.activeMs < threshold) };
}
function readHidden() { try { return new Set(JSON.parse(localStorage.getItem(HIDE_KEY) ?? '[]')); } catch { return new Set(); } }
function writeHidden(set) { try { localStorage.setItem(HIDE_KEY, JSON.stringify([...set])); } catch { /* تفضيل محلي */ } }

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };

export function createInsights({ sync, host, mountImage, openWork, previewWork = openWork, workFromRef, toast, confirm = (m) => globalThis.confirm?.(m) }) {
  let person = null;
  let filter = 'all';
  let requestId = 0;
  let results = new Map();
  let showShort = false;
  const me = () => sync.user?.userId;

  const profileOf = (uid) => {
    const a = sync.rows('accounts', (x) => x.user_id === uid)[0];
    const p = sync.rows('profiles', (x) => x.user_id === uid)[0];
    return { name: p?.display_name || a?.username || '؟', avatar: p?.avatar_key || null };
  };
  // المجموع من الخادم (يشمل وقت الأعمال المخفية)، وتفصيل الأقسام من القائمة
  const msOf = (r) => (filter === 'all' && Number.isFinite(r?.totalMs) ? r.totalMs : (r?.content ?? []).filter((x) => (filter === 'all' || x.section === filter) && x.activeMs > 0).reduce((t, x) => t + x.activeMs, 0));
  const visible = (r) => r && !r.locked && r.timeShared;
  // المقفل: وقته الكلي يظهر في «الكل» وحدها، وأعماله وأقسامه مقفلة
  const countsIn = (r) => visible(r) || (r?.locked && filter === 'all' && Number(r.totalMs) > 0);

  function avatarNode(uid, size) {
    const { name, avatar } = profileOf(uid);
    const n = el('span', 'ins-av');
    n.style.setProperty('--s', `${size}px`);
    if (avatar) { const i = el('img'); i.src = avatar; i.alt = ''; n.append(i); } else n.textContent = name.slice(0, 1).toUpperCase();
    return n;
  }

  async function show() {
    const id = ++requestId;
    person ??= me();
    host.replaceChildren(skeleton());
    host.setAttribute('aria-busy', 'true');
    await flushFollowTime(sync).catch(() => {});
    await sync.push?.().catch?.(() => {});
    const ids = sync.rows('accounts').map((a) => a.user_id).filter(Boolean).slice(0, 10);
    const got = await Promise.all(ids.map((uid) => sync.insights(uid).then((r) => [uid, r]).catch(() => [uid, null])));
    if (id !== requestId || !host.isConnected) return;
    results = new Map(got);
    host.setAttribute('aria-busy', 'false');
    if (!countsIn(results.get(person))) person = me();
    render();
  }

  function skeleton() {
    const box = el('div', 'ins');
    const t = el('div', 'ins-total'); t.append(el('i', 'ins-sk ins-sk-total'));
    const ring = el('div', 'ins-pies'); ring.append(el('i', 'ins-sk ins-sk-ring'));
    box.append(t, ring);
    return box;
  }

  function render() {
    const hidden = readHidden();
    const people = [...results.entries()].map(([uid, r]) => ({ uid, r, ms: countsIn(r) ? msOf(r) : 0, locked: !visible(r), shown: countsIn(r) }))
      .sort((a, b) => Number(b.uid === me()) - Number(a.uid === me()) || b.ms - a.ms);
    const shown = people.filter((p) => p.shown && p.ms > 0);
    const total = shown.reduce((t, p) => t + p.ms, 0);
    const box = el('div', 'ins');
    box.dataset.kind = filter;

    const head = el('header', 'ins-head');
    head.append(el('small', null, 'مجموع وقت السيرفر'), el('strong', 'ins-total', duration(total)));
    const tabs = el('nav', 'ins-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [k, l] of FILTERS) {
      const b = el('button', k === filter ? 'on' : '', l); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(k === filter));
      b.onclick = () => { if (k === filter) return; filter = k; showShort = false; box.classList.add('ins-swap'); setTimeout(render, 180); };
      tabs.append(b);
    }

    const pies = el('div', 'ins-pies');
    const groups = pieGroups(shown);
    if (!groups.length) { const e = el('p', 'ins-empty', 'لا وقت مسجّل في هذا القسم بعد'); pies.append(e); }
    for (const g of groups) pies.append(pie(g));

    const legend = el('ul', 'ins-legend');
    for (const p of people) {
      const li = el('li', `${p.uid === person ? 'on' : ''}${p.locked ? ' locked' : ''}`);
      const b = el('button'); b.type = 'button';
      b.append(avatarNode(p.uid, 30));
      const nm = el('span', 'ins-nm', `${profileOf(p.uid).name}${p.uid === me() ? ' (أنت)' : ''}`); nm.dir = 'auto';
      b.append(nm, el('span', 'ins-h', p.shown ? duration(p.ms) : 'مقفل'));
      if (p.locked) b.insertAdjacentHTML('beforeend', glyph('lock', { size: 15 }));
      b.onclick = () => (p.shown ? pick(p.uid) : toast('مقفل في هذا القسم', 2500));
      li.append(b); legend.append(li);
    }

    const works = el('section', 'ins-works');
    paintWorks(works, hidden);
    box.append(head, tabs, pies, legend, works);
    host.replaceChildren(silkLayer(), box);
    requestAnimationFrame(() => box.classList.add('ins-in'));
  }

  // خلفية الحرير نفسها التي في البنر، بلون القسم
  let silkWrap = null, silk = null;
  function silkLayer() {
    if (!silkWrap) {
      silkWrap = el('div', 'ins-silk'); silkWrap.setAttribute('aria-hidden', 'true');
      const c = document.createElement('canvas'); silkWrap.append(c);
      try { silk = createSilk(c); } catch { silk = null; }
    }
    const accent = getComputedStyle(host).getPropertyValue('--accent').trim();
    if (silk && /^#[0-9a-f]{6}$/i.test(accent)) silk.setPalette(paletteFromAccent(accent));
    return silkWrap;
  }
  function pie(group) {
    const size = 220, cx = size / 2, r = 78, w = 30, C = 2 * Math.PI * r;
    const wrap = el('div', 'ins-pie');
    const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: '100%', height: '100%', role: 'img', 'aria-label': 'توزيع الساعات' });
    svg.append(svgEl('circle', { cx, cy: cx, r, fill: 'none', stroke: 'rgba(255,255,255,.06)', 'stroke-width': w }));
    const slices = pieSlices(group);
    const sum = group.reduce((t, p) => t + p.ms, 0);
    slices.forEach((s, i) => {
      const len = (s.sweep / 360) * C;
      const c = svgEl('circle', { cx, cy: cx, r, fill: 'none', 'stroke-width': w, 'stroke-dasharray': `0 ${C}`, 'stroke-dashoffset': C * 0.25 - (s.start / 360) * C, class: `ins-sl${s.uid === person ? ' on' : ''}`, 'data-i': i });
      c.style.setProperty('--o', String(1 - i * 0.14));
      c.addEventListener('click', () => pick(s.uid));
      svg.append(c);
      requestAnimationFrame(() => requestAnimationFrame(() => c.setAttribute('stroke-dasharray', `${len} ${C - len}`)));
    });
    wrap.append(svg);
    // الأفاتار على منتصف شريحته فوق الحلقة، بحجم محصور
    for (const s of slices) {
      if (s.frac < 0.06) continue;
      const a = (s.mid - 90) * Math.PI / 180;
      const node = avatarNode(s.uid, s.avatar);
      node.classList.add('ins-pav');
      node.style.left = `${((cx + r * Math.cos(a)) / size) * 100}%`;
      node.style.top = `${((cx + r * Math.sin(a)) / size) * 100}%`;
      node.onclick = () => pick(s.uid);
      wrap.append(node);
    }
    const sel = slices.find((s) => s.uid === person);
    const mid = el('div', 'ins-mid');
    mid.append(el('strong', null, duration(sel ? sel.ms : sum)), el('small', null, sel ? profileOf(sel.uid).name : 'هذه الدائرة'));
    wrap.append(mid);
    return wrap;
  }

  function pick(uid) {
    if (uid === person) return;
    person = uid; showShort = false;
    host.querySelector('.ins')?.classList.add('ins-swap');
    setTimeout(render, 160);
  }

  function paintWorks(box, hidden) {
    const r = results.get(person);
    box.replaceChildren();
    const who = profileOf(person).name;
    box.append(el('h3', null, person === me() ? 'أعمالك' : `أعمال ${who}`));
    if (!r || r.locked) { box.append(el('p', 'ins-empty', 'أعماله مقفلة، وقته في VANTARA فقط ظاهر')); return; }
    const content = (r.content ?? []).filter((x) => (filter === 'all' || x.section === filter) && x.activeMs > 0 && !(person === me() && hidden.has(x.seriesRef)))
      .sort((a, b) => b.activeMs - a.activeMs);
    if (!content.length) { box.append(el('p', 'ins-empty', 'لا وقت مسجّل بعد')); return; }
    const { main, short } = splitShort(content);
    const max = Math.max(1, ...content.map((x) => x.activeMs));
    const list = el('div', 'ins-list');
    for (const item of main) list.append(row(item, max));
    box.append(list);
    if (short.length) {
      if (showShort) { const more = el('div', 'ins-list ins-short'); for (const item of short) more.append(row(item, max)); box.append(more); }
      else {
        const b = el('button', 'ins-more', `عرض المزيد (${short.length} أقل من 10 دقائق)`); b.type = 'button';
        b.onclick = () => { showShort = true; paintWorks(box, readHidden()); };
        box.append(b);
      }
    }
  }

  function row(item, max) {
    const work = workFromRef(item.seriesRef, item.title, item.coverUrl);
    const rowEl = el('div', 'insights-rank ins-row');
    const main = el('button', 'ins-row-main'); main.type = 'button';
    const fill = el('span', 'insights-bar');
    fill.style.width = `${Math.max(8, item.activeMs / max * 100)}%`;
    const track = el('span', 'insights-track');
    const cover = el('span', 'insights-cover');
    void Promise.resolve(mountImage(cover, work)).then(() => {
      const img = cover.querySelector('img');
      if (img) coverTone(img, item.coverUrl || item.seriesRef, fill);
    }).catch(() => {});
    fill.append(cover); track.append(fill);
    const text = el('span', 'insights-rank-copy');
    const t = el('strong', null, item.title || work.title?.english || '—'); t.dir = 'auto';
    text.append(t, el('small', null, duration(item.activeMs)));
    main.append(track, text);
    main.onclick = () => void previewWork(work);
    rowEl.append(main);
    if (person === me()) {
      const del = el('button', 'ins-del'); del.type = 'button'; del.setAttribute('aria-label', 'إخفاء العمل');
      del.innerHTML = glyph('trash', { size: 18 });
      del.onclick = () => {
        const ok = confirm('إخفاء هذا العمل من إحصائياتك نهائيًا؟\n\nما أحد يقدر يشوفه بعدها، ولا تقدر ترجعه. ساعاتك تبقى محسوبة كما هي.');
        if (!ok) return;
        const h = readHidden(); h.add(item.seriesRef); writeHidden(h);
        render();
        void Promise.resolve(sync.hideInsight?.(item.seriesRef)).then((ok) => {
          toast(ok === false ? 'أُخفي عندك، وسيُرسل للخادم لاحقًا' : 'أُخفي العمل نهائيًا، وساعاتك كما هي', 2600);
          if (ok) { const cur = results.get(me()); if (cur?.content) cur.content = cur.content.filter((x) => x.seriesRef !== item.seriesRef); }
        });
      };
      rowEl.append(del);
    }
    return rowEl;
  }

  return { show };
}
