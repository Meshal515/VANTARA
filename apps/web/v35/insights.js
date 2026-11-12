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
/**
 * الشرائح بنسبها، مع حد أدنى مرئي لكل من له وقت (خلل «دحمي يختفي»): من تابع دقيقة أمام من تابع ساعات كانت
 * شريحته أصغر من فاصل الدرجتين فتصير صفرًا، وصورته لا تُرسم تحت 6%، فيبدو كأنه غاب. الآن كل شخص له
 * `minSweep` درجة على الأقل، والباقي يُوزّع بالنسب على الآخرين؛ والنسبة الحقيقية (`frac`) باقية للأرقام.
 */
export function pieSlices(group, { gap = 2, min = 22, max = 34, minSweep = 18 } = {}) {
  const total = group.reduce((t, p) => t + p.ms, 0);
  const real = group.map((p) => (total ? p.ms / total : 1 / group.length));
  const floor = group.length > 1 ? Math.min(minSweep, 360 / group.length) : 0;
  const small = real.map((f) => f * 360 < floor);
  const reserved = small.filter(Boolean).length * floor;
  const restReal = real.reduce((t, f, i) => t + (small[i] ? 0 : f), 0) || 1;
  const sweeps = real.map((f, i) => (small[i] ? floor : (f / restReal) * (360 - reserved)));
  let at = 0;
  return group.map((p, i) => {
    const frac = real[i];
    const sweep = sweeps[i];
    const s = { ...p, frac, start: at, sweep: Math.max(0, sweep - (group.length > 1 ? gap : 0)), mid: at + sweep / 2, avatar: Math.round(Math.min(max, Math.max(min, min + (max - min) * Math.min(1, (sweep / 360) * 2.5)))) };
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
  // المقفل (قرار المالك): ساعاته ظاهرة مجموعًا ولكل قسم (`sections` من الخادم)، وأعماله وحدها مقفلة
  const msOf = (r) => {
    if (filter === 'all' && Number.isFinite(r?.totalMs)) return r.totalMs;
    if (r?.locked) return Number(r.sections?.[filter] ?? 0);
    return (r?.content ?? []).filter((x) => (filter === 'all' || x.section === filter) && x.activeMs > 0).reduce((t, x) => t + x.activeMs, 0);
  };
  const visible = (r) => r && !r.locked && r.timeShared;
  // المقفل: وقته الكلي يظهر في «الكل» وحدها، وأعماله وأقسامه مقفلة
  const countsIn = (r) => visible(r) || Boolean(r?.locked && msOf(r) > 0);

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

  function computePeople() {
    const people = [...results.entries()].map(([uid, r]) => ({ uid, r, ms: countsIn(r) ? msOf(r) : 0, locked: !visible(r), shown: countsIn(r) }))
      .sort((a, b) => Number(b.uid === me()) - Number(a.uid === me()) || b.ms - a.ms);
    const shown = people.filter((p) => p.shown && p.ms > 0);
    return { people, shown, total: shown.reduce((t, p) => t + p.ms, 0) };
  }
  /** عدّ الرقم من قيمته الظاهرة إلى الجديدة (نص فقط، إطار واحد لكل تحديث، يحترم تقليل الحركة). */
  function countTo(node, to) {
    if (!node) return;
    const from = Number(node.dataset.ms ?? to);
    node.dataset.ms = String(to);
    cancelAnimationFrame(node._raf ?? 0);
    if (reducedMotion() || from === to) { node.textContent = duration(to); return; }
    const t0 = performance.now(), D = 600;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3);
      node.textContent = duration(from + (to - from) * e);
      if (k < 1) node._raf = requestAnimationFrame(step);
    };
    node._raf = requestAnimationFrame(step);
  }
  const reducedMotion = () => document.documentElement.dataset.motion === 'off' || Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const EASE = 'cubic-bezier(.22,.8,.2,1)';
  /**
   * «لا يختفي، يتحرك» (ملاحظة المالك، 9 نوفمبر): العقد نفسها تبقى، وكل عقدة تغيّر مكانها تنزلق إليه من
   * مكانها القديم (FLIP بـ transform وحده). لا تلاشٍ للقسم ولا إعادة بناء.
   */
  function flip(nodes, mutate) {
    const before = new Map(nodes.filter((n) => n.isConnected).map((n) => [n, n.getBoundingClientRect().top]));
    mutate();
    if (reducedMotion()) return;
    for (const [n, top] of before) {
      if (!n.isConnected || !n.animate) continue;
      const dy = top - n.getBoundingClientRect().top;
      if (Math.abs(dy) >= 1) n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: EASE });
    }
  }
  /** عقدة جديدة (شخص أو عمل لم يكن ظاهرًا) تدخل في مكانها بلا قفز. */
  function enter(node) {
    if (reducedMotion() || !node.animate) return;
    node.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE });
  }
  /** القائمة تحت الدائرة: صف لكل شخص مربوط به، يتحدّث في مكانه (الصور لا تُعاد) ويُرتّب بنقل العقد نفسها. */
  function legendRow(p) {
    const li = el('li');
    li.dataset.uid = p.uid;
    const b = el('button'); b.type = 'button';
    b.append(avatarNode(p.uid, 30));
    const nm = el('span', 'ins-nm', `${profileOf(p.uid).name}${p.uid === me() ? ' (أنت)' : ''}`); nm.dir = 'auto';
    b.append(nm, el('span', 'ins-h', ''));
    b.insertAdjacentHTML('beforeend', glyph('lock', { size: 15, cls: 'icon ins-lock' }));
    li.append(b);
    return li;
  }
  function paintLegend(legend, people) {
    const rows = new Map([...legend.children].map((li) => [li.dataset.uid, li]));
    flip([...rows.values()], () => {
      for (const p of people) {
        const fresh = !rows.has(p.uid);
        const li = rows.get(p.uid) ?? legendRow(p);
        // المقفل: ساعاته ظاهرة وقفل صغير يقول إن أعماله مقفلة. من لا وقت له هنا يبقى ظاهرًا بـ«—» (لا يخفت
        // ولا يختفي). الصنف «ins-none» لا «empty»: ذاك صنف حالة الفراغ العامة (min-height: 46vh لكل صف)
        li.className = `${p.uid === person ? 'on' : ''}${p.locked ? ' locked' : ''}${p.shown ? '' : ' ins-none'}`;
        // المقفل بلا رقم من الخادم: القفل وحده (قرار المالك)، لا «—»
        li.querySelector('.ins-h').textContent = p.shown ? duration(p.ms) : p.locked ? '' : '—';
        li.querySelector('.ins-lock').style.display = p.locked ? '' : 'none';
        li.querySelector('button').onclick = () => (p.shown ? pick(p.uid) : toast('لا وقت مسجّل له في هذا القسم', 2500));
        legend.append(li);
        if (fresh && legend.isConnected) enter(li);
      }
      for (const [uid, li] of rows) if (!people.some((p) => p.uid === uid)) li.remove();
    });
    return legend;
  }
  const legendNode = (people) => paintLegend(el('ul', 'ins-legend'), people);
  function piesNode(shown, pies = el('div', 'ins-pies')) {
    const groups = pieGroups(shown);
    if (!groups.length) pies.replaceChildren(el('p', 'ins-empty', 'لا وقت مسجّل في هذا القسم بعد'));
    else pies.replaceChildren(...groups.map(pie));
    return pies;
  }
  /**
   * تبديل القسم أو الشخص (الجولة الثالثة): لا هدم للصفحة. الشرائح تتحوّل من زواياها الحالية، والأرقام تُعدّ،
   * والخلفية تنتقل للون القسم، والأعمال وحدها تتلاشى وتظهر. البناء الكامل فقط إن تغيّر عدد الدوائر.
   */
  function update() {
    const box = host.querySelector('.ins');
    if (!box) return render();
    const { people, shown, total } = computePeople();
    box.dataset.kind = filter;
    for (const b of box.querySelectorAll('.ins-tabs button')) { const on = b.dataset.k === filter; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
    countTo(box.querySelector('.ins-head .ins-total'), total);
    const pies = box.querySelector('.ins-pies');
    const groups = pieGroups(shown);
    const wraps = [...pies.querySelectorAll(':scope > .ins-pie')];
    // نفس عدد الدوائر: تتحوّل مهما تغيّر من فيها (دخل أحد أو خرج). يُعاد البناء فقط إن تغيّر عددها
    if (groups.length && wraps.length === groups.length) groups.forEach((g, i) => morphPie(wraps[i], g));
    else piesNode(shown, pies);
    const legend = box.querySelector('.ins-legend');
    if (legend) paintLegend(legend, people);
    const works = box.querySelector('.ins-works');
    if (works) paintWorks(works, readHidden());
    tintSilk();
  }

  function render() {
    const hidden = readHidden();
    const { people, shown, total } = computePeople();
    const box = el('div', 'ins');
    box.dataset.kind = filter;

    const head = el('header', 'ins-head');
    const totalNode = el('strong', 'ins-total', duration(total));
    totalNode.dataset.ms = String(total);
    head.append(el('small', null, 'مجموع وقت السيرفر'), totalNode);
    const tabs = el('nav', 'ins-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.dataset.tabMotion = 'self';
    for (const [k, l] of FILTERS) {
      const b = el('button', k === filter ? 'on' : '', l); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(k === filter));
      b.dataset.k = k;
      b.onclick = () => { if (k === filter) return; filter = k; showShort = false; update(); };
      tabs.append(b);
    }

    const pies = piesNode(shown);
    const legend = legendNode(people);

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
    tintSilk();
    return silkWrap;
  }
  /** لون الخلفية للقسم المختار: لون رئيسية القسم كما اختاره المستخدم، و«الكل» بلون الواجهة. الحرير ينتقل بينها بسلاسة. */
  function tintSilk() {
    const homes = { manga: 'mangaHome', anime: 'animeHome', cinema: 'cinemaHome' };
    const src = (homes[filter] && document.getElementById(homes[filter])) || host;
    const accent = getComputedStyle(src).getPropertyValue('--accent').trim() || getComputedStyle(host).getPropertyValue('--accent').trim();
    if (silk && /^#[0-9a-f]{6}$/i.test(accent)) silk.setPalette(paletteFromAccent(accent));
    host.style.setProperty('--ins-accent', /^#[0-9a-f]{6}$/i.test(accent) ? accent : '');
  }
  const PIE = { size: 220, r: 78, w: 30 };
  const PIE_C = 2 * Math.PI * PIE.r;
  /** دائرة لمجموعة (حتى خمسة)؛ الشرائح والصور مربوطة بأصحابها (data-uid) فتتحوّل ولا تُهدم. */
  function pie(group) {
    const { size } = PIE;
    const cx = size / 2;
    const wrap = el('div', 'ins-pie');
    const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: '100%', height: '100%', role: 'img', 'aria-label': 'توزيع الساعات' });
    svg.append(svgEl('circle', { cx, cy: cx, r: PIE.r, fill: 'none', stroke: 'rgba(255,255,255,.06)', 'stroke-width': PIE.w }));
    wrap.append(svg);
    const mid = el('div', 'ins-mid');
    const midMs = el('strong', null, '');
    midMs.dataset.ms = '0';
    mid.append(midMs, el('small', null, ''));
    wrap.append(mid);
    morphPie(wrap, group, { enter: true });
    return wrap;
  }
  /**
   * الدائرة نفسها بأرقام جديدة: كل شريحة تنزلق لزاويتها، ومن دخل القسم تنمو شريحته من الصفر في مكانها،
   * ومن خرج تنكمش ثم تُزال. الصور تتبع أصحابها. لا هدم ولا إعادة رسم للدائرة.
   */
  function morphPie(wrap, group) {
    const { size, r, w } = PIE;
    const cx = size / 2, C = PIE_C;
    const svg = wrap.querySelector('svg');
    const slices = pieSlices(group);
    const keep = new Set(slices.map((s) => s.uid));
    const place = (node, s) => {
      const a = (s.mid - 90) * Math.PI / 180;
      node.style.left = `${((cx + r * Math.cos(a)) / size) * 100}%`;
      node.style.top = `${((cx + r * Math.sin(a)) / size) * 100}%`;
    };
    slices.forEach((s, i) => {
      const len = (s.sweep / 360) * C;
      const offset = String(C * 0.25 - (s.start / 360) * C);
      let c = [...svg.querySelectorAll('circle.ins-sl')].find((x) => x.dataset.uid === s.uid);
      if (!c) {
        c = svgEl('circle', { cx, cy: cx, r, fill: 'none', 'stroke-width': w, 'stroke-dasharray': `0 ${C}`, 'stroke-dashoffset': offset, class: 'ins-sl', 'data-uid': s.uid });
        c.addEventListener('click', () => pick(s.uid));
        svg.append(c);
        requestAnimationFrame(() => requestAnimationFrame(() => c.setAttribute('stroke-dasharray', `${len} ${C - len}`)));
      } else {
        c.dataset.gone = '';
        c.setAttribute('stroke-dasharray', `${len} ${C - len}`);
      }
      c.setAttribute('stroke-dashoffset', offset);
      c.style.setProperty('--o', String(1 - i * 0.14));
      c.classList.toggle('on', s.uid === person);
      let av = [...wrap.querySelectorAll('.ins-pav')].find((x) => x.dataset.uid === s.uid);
      if (!av) {
        av = avatarNode(s.uid, s.avatar);
        av.classList.add('ins-pav');
        av.dataset.uid = s.uid;
        av.onclick = () => pick(s.uid);
        place(av, s);
        wrap.append(av);
      } else {
        av.classList.remove('ins-pav--gone');
        av.style.setProperty('--s', `${s.avatar}px`);
        place(av, s);
      }
    });
    // من خرج: شريحته تنكمش وصورته تتلاشى، ثم يُزالان (إلا إن عاد قبل ذلك)
    for (const c of svg.querySelectorAll('circle.ins-sl')) {
      if (keep.has(c.dataset.uid)) continue;
      c.setAttribute('stroke-dasharray', `0 ${C}`);
      c.dataset.gone = '1';
      setTimeout(() => { if (c.dataset.gone === '1') c.remove(); }, 750);
    }
    for (const av of wrap.querySelectorAll('.ins-pav')) {
      if (keep.has(av.dataset.uid)) continue;
      av.classList.add('ins-pav--gone');
      setTimeout(() => { if (av.classList.contains('ins-pav--gone')) av.remove(); }, 400);
    }
    const sel = slices.find((x) => x.uid === person);
    const sum = group.reduce((t, p) => t + p.ms, 0);
    countTo(wrap.querySelector('.ins-mid strong'), sel ? sel.ms : sum);
    const label = wrap.querySelector('.ins-mid small');
    if (label) label.textContent = sel ? profileOf(sel.uid).name : 'هذه الدائرة';
    wrap._uids = group.map((p) => p.uid).join(',');
  }

  function pick(uid) {
    if (uid === person) return;
    person = uid; showShort = false;
    update();
  }

  /**
   * الأعمال تُرسم في مكانها: صف العمل الظاهر من قبل يبقى هو نفسه (غلافه لا يُحمَّل من جديد) وينزلق لمكانه،
   * والجديد يدخل، والخارج يُزال. كانت القائمة تتلاشى كلها وتُبنى من الصفر مع كل زر.
   */
  function paintWorks(box, hidden) {
    const r = results.get(person);
    const old = new Map([...box.querySelectorAll('.ins-row')].map((x) => [x.dataset.ref, x]));
    const who = profileOf(person).name;
    const head = el('h3', null, person === me() ? 'أعمالك' : `أعمال ${who}`);
    const content = !r || r.locked ? [] : (r.content ?? []).filter((x) => (filter === 'all' || x.section === filter) && x.activeMs > 0 && !(person === me() && hidden.has(x.seriesRef)))
      .sort((a, b) => b.activeMs - a.activeMs);
    flip([...old.values()], () => {
      if (!r || r.locked) { box.replaceChildren(head, el('p', 'ins-empty', 'أعماله مقفلة، وقته في VANTARA فقط ظاهر')); return; }
      if (!content.length) { box.replaceChildren(head, el('p', 'ins-empty', 'لا وقت مسجّل بعد')); return; }
      const { main, short } = splitShort(content);
      const max = Math.max(1, ...content.map((x) => x.activeMs));
      const take = (item) => {
        const kept = old.get(item.seriesRef);
        if (kept && kept._mine === (person === me())) { kept._bar.style.width = `${Math.max(8, item.activeMs / max * 100)}%`; old.delete(item.seriesRef); return kept; }
        const n = row(item, max);
        n._fresh = box.isConnected;
        return n;
      };
      const list = el('div', 'ins-list');
      list.append(...main.map(take));
      const nodes = [head, list];
      if (short.length) {
        if (showShort) { const more = el('div', 'ins-list ins-short'); more.append(...short.map(take)); nodes.push(more); }
        else {
          const b = el('button', 'ins-more', `عرض المزيد (${short.length} أقل من 10 دقائق)`); b.type = 'button';
          b.onclick = () => { showShort = true; paintWorks(box, readHidden()); };
          nodes.push(b);
        }
      }
      box.replaceChildren(...nodes);
      for (const n of box.querySelectorAll('.ins-row')) if (n._fresh) { n._fresh = false; enter(n); }
    });
  }

  function row(item, max) {
    const work = workFromRef(item.seriesRef, item.title, item.coverUrl);
    const rowEl = el('div', 'insights-rank ins-row');
    rowEl.dataset.ref = item.seriesRef;
    rowEl._mine = person === me();
    const main = el('button', 'ins-row-main'); main.type = 'button';
    const fill = el('span', 'insights-bar');
    fill.style.width = `${Math.max(8, item.activeMs / max * 100)}%`;
    rowEl._bar = fill;
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
        // الصف وحده يتلاشى ثم تُعاد قائمة الأعمال: المجموع والدائرة لا يتغيّران (الساعات تبقى محسوبة)
        rowEl.classList.add('ins-row-gone');
        setTimeout(() => { const works = host.querySelector('.ins-works'); if (works) paintWorks(works, readHidden()); }, reducedMotion() ? 0 : 220);
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
