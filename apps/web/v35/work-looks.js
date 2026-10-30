/**
 * أنماط صفحة عمل الأنمي الأربعة (إعدادات ← المظهر)، منقولة من التصاميم المعتمدة كما هي:
 * المنصة، البطاقة الطائرة، شاشة السينما، الحلقة أولًا. البطل (البنر وحركة العمق) من صفحة العمل
 * نفسها؛ هنا كل ما تحته. نفس DOM للجوال والشاشة العريضة، والتخطيط العريض في work-looks.css.
 * لا شيء هنا يجلب بيانات: كل ما يُعرض يأتي في ctx من anime.js.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const img = (src, cls = '', pos = '') => (src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" decoding="async"${pos ? ` style="object-position:${pos}"` : ''}>` : '');

/** مقطع الحلقات الظاهر: المسلسل الطويل مجموعات من 25 (المجموعة التي فيها حلقتك أولًا). */
export function episodeRange(total, current, chosen = null, size = 25) {
  if (total <= 24) return { from: 1, to: total, groups: [] };
  const groups = [];
  for (let a = 1; a <= total; a += size) groups.push([a, Math.min(total, a + size - 1)]);
  const at = chosen ?? groups.findIndex(([a, b]) => current >= a && current <= b);
  const [from, to] = groups[Math.max(0, at)] ?? groups[0];
  return { from, to, groups, at: Math.max(0, at) };
}

/** خط متقطع يبدأ وينتهي بشرطة كاملة مهما كان طوله. */
const dashLine = (n = 4) => `<svg class="wl-dash" preserveAspectRatio="none" viewBox="0 0 100 2" aria-hidden="true"><line x1="0" y1="1" x2="100" y2="1" pathLength="${2 * n - 1}" stroke-dasharray="1 1"/></svg>`;

function parts(c) {
  const { m, glyph } = c;
  const meta = c.meta.map((x) => `<span>${x.html ?? esc(x)}</span>`).join('');
  const genres = c.genres.map((g) => `<span>${esc(g)}</span>`).join('');
  const logo = c.logo ? `<img class="wl-logo" src="${esc(c.logo)}" alt="${esc(m.title)}">` : `<h1 class="wl-name" dir="auto">${esc(m.title)}</h1>`;
  const facts = c.facts.map(([k, v]) => `<div><small>${esc(k)}</small><b dir="auto">${esc(v)}</b></div>`).join('');
  const play = glyph('play', { size: 22, filled: true });
  const cur = c.point.episode;
  const curTitle = c.epTitle(cur);
  const range = episodeRange(c.total, cur, c.rangeAt);
  const ranges = range.groups.length
    ? `<div class="wl-ranges">${range.groups.map(([a, b], i) => `<button type="button" data-range="${i}" class="${i === range.at ? 'on' : ''}">${a}–${b}</button>`).join('')}</div>`
    : '';
  const eps = [];
  for (let n = range.from; n <= range.to; n++) eps.push(n);
  const epState = (n) => (c.seen(n) ? 'seen' : n === cur ? 'cur' : '');
  const epSub = (n) => (c.seen(n) ? `${c.minutes(n)} · شوهدت` : n === cur && c.left ? `باقي ${c.left} د` : c.minutes(n));
  const bar = (n) => (c.seen(n) ? '<u style="width:100%"></u>' : n === cur && c.ratio != null ? `<u style="width:${(c.ratio * 100).toFixed(1)}%"></u>` : '');
  const thumb = (n, size) => {
    const s = c.still(n, size === 'full');
    return `<div class="th">${img(s.src, '', s.still ? '' : 'center 22%')}<em>${n}</em>${bar(n)}</div>`;
  };
  const epRows = (withO = true) => `<div class="wl-eprows">${eps.map((n) => `<button type="button" class="er ${epState(n)}" data-ep="${n}">${thumb(n)}<span class="tx"><b dir="auto">${n}. ${esc(c.epTitle(n) || `الحلقة ${n}`)}</b>${withO && c.epOverview(n) ? `<p dir="auto">${esc(c.epOverview(n))}</p>` : ''}<span>${esc(epSub(n))}</span></span></button>`).join('')}</div>`;
  const chars = (cls, k = 10) => (c.characters.length ? `<div class="${cls}">${c.characters.slice(0, k).map((p) => `<div class="ch">${img(p.image, '', 'center 20%')}<b dir="auto">${esc(p.name)}</b><span dir="auto">${esc(p.voice ?? '')}</span></div>`).join('')}</div>` : '');
  const recs = (cls) => (m.recommendations?.length ? `<div class="${cls}">${m.recommendations.map((r) => `<button type="button" class="rc" data-open="${esc(r.id)}">${img(r.posterSmall ?? r.poster)}<b dir="auto">${esc(r.title)}</b><span>${r.score ? `★ ${r.score.toFixed(1)}` : esc(r.year ?? '')}</span></button>`).join('')}</div>` : '');
  const desc = m.description ? `<p class="wl-desc" dir="auto">${esc(m.description)}</p>` : '';
  const section = (title, body, key = '', more = false) =>
    body ? `<section class="wl-sec${key ? ` wl-s-${key}` : ''}"><div class="wl-h"><h2>${title}</h2>${more ? '<button type="button" class="wl-more" data-all>الكل</button>' : ''}</div>${body}</section>` : '';
  const recsMore = (m.recommendations?.length ?? 0) > c.recsCap;
  return { meta, genres, logo, facts, play, cur, curTitle, ranges, eps, epState, epSub, bar, thumb, epRows, chars, recs, recsMore, desc, section };
}

/** «من نفس العالم»: ما قبله، ثم العمل نفسه («أنت هنا»)، ثم ما بعده، ثم بقية المرتبط؛ أنمي ومانجا. */
function worldItems(c) {
  const all = c.m.world ?? (c.m.relations ?? []).map((r) => ({ ...r, kind: 'anime', relationType: r.relation === 'الجزء السابق' ? 'PREQUEL' : r.relation === 'الجزء التالي' ? 'SEQUEL' : 'OTHER' }));
  const before = all.filter((r) => r.relationType === 'PREQUEL' || r.relationType === 'PARENT' || r.relationType === 'ADAPTATION' || r.relationType === 'SOURCE');
  const after = all.filter((r) => r.relationType === 'SEQUEL');
  const rest = all.filter((r) => !before.includes(r) && !after.includes(r));
  const here = { id: c.m.id, title: c.m.title, poster: c.m.poster, posterSmall: c.m.posterSmall, banner: c.heroSrc ?? c.m.banner, year: c.m.year, here: true, kind: 'anime' };
  const list = [...before, here, ...after, ...rest];
  return list.length > 1 ? list : [];
}
/** «مانجا · قبل الأحداث»، «المانجا الأصلية»، «أنت هنا · 2022»، «عمل مرتبط · 2026». */
function worldLabel(w) {
  if (w.here) return ['أنت هنا', w.year].filter(Boolean).join(' · ');
  if (w.kind === 'manga') return w.relationType === 'ADAPTATION' || w.relationType === 'SOURCE' ? 'المانجا الأصلية' : ['مانجا', w.relation].join(' · ');
  return [w.relation, w.year].filter(Boolean).join(' · ');
}
/** الأنمي فقط يُفتح في صفحة الأنمي؛ المانجا تُعرض بلا رابط. */
const openAttr = (w) => (w.here || w.kind === 'manga' ? '' : `data-open="${esc(w.id)}"`);

const LOOKS = {
  /* ── المنصة ── */
  platform(c, p) {
    const world = worldItems(c);
    return `
      <div class="wl-htxt">${p.logo}<div class="wl-meta">${p.meta}</div><div class="wl-genres">${p.genres}</div></div>
      <div class="wl-grid">
        <aside class="wl-aside">
          <div class="wl-plate"><div class="wl-cover">${img(c.m.poster ?? c.m.posterSmall, '', 'center 20%')}</div><div class="wl-facts">${p.facts}</div></div>
          <button type="button" class="wl-cta" data-ep="${p.cur}"><span class="dot">${p.play}</span><span>${esc(c.label)}<small dir="auto">${esc([p.curTitle, c.left ? `باقي ${c.left} د` : null].filter(Boolean).join(' · '))}</small></span></button>
          <div class="wl-pg" style="--w:${c.seenRatio * 100}%"><i></i><span>${esc(c.progressText)}</span></div>
        </aside>
        <main class="wl-main">${p.desc}${p.section('الحلقات', p.ranges + p.epRows(), 'eps')}${p.section('الشخصيات', p.chars('wl-chars', 10), 'chars')}${p.section('من نفس العالم', world.length ? `<div class="wl-world">${world.map((w) => `<button type="button" class="wn${w.here ? ' here' : ''}" ${openAttr(w)}>${img(w.posterSmall ?? w.poster)}<b dir="auto">${esc(w.title)}</b><span>${esc(worldLabel(w))}</span></button>`).join('')}</div>` : '', 'world')}${p.section('إذا عجبك هذا', p.recs('wl-recs'), 'recs', p.recsMore)}</main>
      </div>
      <div class="wl-dock"><span class="wl-dock-cover">${img(c.m.posterSmall ?? c.m.poster, '', 'center 20%')}</span><span class="wl-dock-text" style="--w:${c.seenRatio * 100}%"><b>${esc(c.label)}</b><small dir="auto">${esc([p.curTitle, c.progressText].filter(Boolean).join(' · '))}</small><i></i></span><button type="button" class="dot" data-ep="${p.cur}" aria-label="${esc(c.label)}">${p.play}</button></div>`;
  },

  /* ── البطاقة الطائرة ── */
  card(c, p) {
    const world = worldItems(c);
    const strip = p.eps.map((n) => `<button type="button" class="sp ${p.epState(n)}" data-ep="${n}">${p.thumb(n, n === p.cur ? 'full' : '')}<b dir="auto">${n}. ${esc(c.epTitle(n) || `الحلقة ${n}`)}</b>${n === p.cur && c.epOverview(n) ? `<p dir="auto">${esc(c.epOverview(n))}</p>` : ''}<span>${esc(p.epSub(n))}</span></button>`).join('');
    return `
      <div class="wl-head">
        <div class="wl-stage3d"><div class="wl-card">${img(c.m.poster ?? c.m.posterSmall, '', 'center 20%')}</div></div>
        <div class="wl-info">${p.logo}<div class="wl-meta">${p.meta}</div><div class="wl-genres">${p.genres}</div><div class="wl-row"><button type="button" class="wl-big" data-ep="${p.cur}"><span class="dot">${p.play}</span>${esc(c.label)}</button><span class="wl-sub">${esc(c.progressText)}</span></div></div>
      </div>
      <div class="wl-body">${p.desc}<section class="wl-sec wl-full"><h2>الحلقات</h2>${p.ranges}<div class="wl-strip">${strip}</div></section>${c.characters.length ? `<section class="wl-sec wl-full"><h2>الشخصيات</h2>${p.chars('wl-tall', 8)}</section>` : ''}${p.section('من نفس العالم', world.length ? `<div class="wl-world">${world.map((w) => `<button type="button" class="wn${w.here ? ' here' : ''}" ${openAttr(w)}>${img(w.posterSmall ?? w.poster)}<b dir="auto">${esc(w.title)}</b><span>${esc(worldLabel(w))}</span></button>`).join(dashLine(4))}</div>` : '')}${p.section('إذا عجبك هذا', p.recs('wl-recs'), 'recs', p.recsMore)}</div>`;
  },

  /* ── شاشة السينما ── */
  screen(c, p) {
    const world = worldItems(c);
    return `
      <div class="wl-top">
        <div class="wl-cover">${img(c.m.poster ?? c.m.posterSmall, '', 'center 20%')}</div>
        <div class="wl-mid">${p.logo}<div class="wl-meta">${p.meta}</div><div class="wl-genres">${p.genres}</div></div>
        <button type="button" class="wl-go" data-ep="${p.cur}"><span class="dot">${p.play}</span><span><b>${esc(c.label)}</b><small dir="auto">${esc([p.curTitle, c.progressText].filter(Boolean).join(' · '))}</small></span></button>
      </div>
      <div class="wl-body">${p.desc}${p.section('الحلقات', p.ranges + `<div class="wl-line" style="--done:${c.lineDone}">${p.epRows()}</div>`)}${p.section('الشخصيات', p.chars('wl-ring', 9))}${p.section('من نفس العالم', world.length ? `<div class="wl-world">${world.map((w, i) => `<button type="button" class="wn${w.here ? ' here' : ''}${w.banner ? ' banner' : ''}" ${openAttr(w)}>${w.banner ? img(w.banner, 'bn') : ''}${img(w.posterSmall ?? w.poster, 'cv')}<i>${i + 1}</i><span class="t"><b dir="auto">${esc(w.title)}</b><span>${esc(worldLabel(w))}</span></span></button>`).join('')}</div>` : '')}${p.section('إذا عجبك هذا', p.recs('wl-recs'), 'recs', p.recsMore)}</div>`;
  },

  /* ── الحلقة أولًا ── */
  episode(c, p) {
    const world = worldItems(c);
    const from = Math.max(1, p.cur - 4);
    const to = Math.min(c.total || p.cur, from + 9);
    const scrub = [];
    for (let n = from; n <= to; n++) {
      const s = c.still(n);
      scrub.push(`<button type="button" class="${p.epState(n)}" data-ep="${n}">${img(s.src, '', s.still ? '' : 'center 22%')}<em>${n}</em></button>`);
    }
    return `
      <div class="wl-headrow">
        <div class="wl-now"><small>${c.point.resume ? 'تابع من حيث وقفت' : 'ابدأ من هنا'} · الحلقة ${p.cur}</small><h1 dir="auto">${esc(p.curTitle || `الحلقة ${p.cur}`)}</h1>${c.epOverview(p.cur) ? `<p dir="auto">${esc(c.epOverview(p.cur))}</p>` : ''}<div class="wl-pl"><button type="button" class="dot" data-ep="${p.cur}" aria-label="${esc(c.label)}">${p.play}</button>${c.ratio != null ? `<i style="--w:${(c.ratio * 100).toFixed(1)}%"></i><span>باقي ${c.left ?? ''} د</span>` : ''}</div></div>
        <div class="wl-series">${img(c.m.posterSmall ?? c.m.poster, '', 'center 20%')}<div>${p.logo}<div class="wl-meta">${p.meta}</div><div class="wl-genres">${p.genres}</div></div></div>
      </div>
      <div class="wl-scrub"><div class="wl-track">${scrub.join('')}</div><div class="wl-sline" style="--w:${c.seenRatio * 100}%"></div></div>
      <div class="wl-body"><div class="wl-left">${p.desc}${p.section('كل الحلقات', p.ranges + p.epRows(false), 'eps')}${p.section('الشخصيات', p.chars('wl-grid4', 10), 'chars')}${p.section('إذا عجبك هذا', p.recs('wl-recs'), 'recs', p.recsMore)}</div><div class="wl-right">${p.section('معلومات', `<div class="wl-facts">${p.facts}</div>`, 'facts')}${p.section('من نفس العالم', world.length ? `<div class="wl-world">${world.map((w) => `<button type="button" class="wn${w.here ? ' here' : ''}" ${openAttr(w)}>${img(w.posterSmall ?? w.poster)}<b dir="auto">${esc(w.title)}</b><span>${esc(worldLabel(w))}</span></button>`).join('')}</div>` : '', 'world')}</div></div>
      <div class="wl-mini"><span class="wl-mini-th">${img(c.still(p.cur).src)}</span><span><b>${esc(c.label)}</b><small dir="auto">${esc(p.curTitle ?? '')}</small></span><button type="button" class="dot" data-ep="${p.cur}" aria-label="${esc(c.label)}">${p.play}</button></div>`;
  },
};

export const LOOK_IDS = Object.keys(LOOKS);

/** يرسم النمط في host ويربط الضغطات (تشغيل حلقة، فتح عمل، تبديل مجموعة الحلقات). */
export function renderLook(look, host, c, { center = true } = {}) {
  const make = LOOKS[look];
  if (!make || !host) return;
  // إعادة الرسم (وصول بيانات أو تقدّم) تحفظ موضع الشرائط الأفقية؛ لا تقفز تحت إصبع المستخدم
  const kept = [...host.querySelectorAll('.wl-strip, .wl-track, .wl-tall, .wl-ring')].map((el) => el.scrollLeft);
  host.className = `wl wl-${look}`;
  host.innerHTML = make(c, parts(c));
  if (!center) [...host.querySelectorAll('.wl-strip, .wl-track, .wl-tall, .wl-ring')].forEach((el, i) => { if (kept[i] != null) el.scrollLeft = kept[i]; });
  // صورة تعذّرت: الشعار يحل محله الاسم مكتوبًا، وغيره يختفي بدل رمز الصورة المكسورة
  for (const im of host.querySelectorAll('img')) {
    im.onerror = () => {
      if (im.classList.contains('wl-logo')) {
        const h = document.createElement('h1');
        h.className = 'wl-name';
        h.dir = 'auto';
        h.textContent = c.m.title;
        im.replaceWith(h);
      } else im.style.visibility = 'hidden';
    };
  }
  host.onclick = (e) => {
    const all = e.target.closest('[data-all]');
    if (all) {
      const grid = all.closest('.wl-sec')?.querySelector('.wl-recs');
      grid?.classList.toggle('all');
      all.textContent = grid?.classList.contains('all') ? 'أقل' : 'الكل';
      return;
    }
    const r = e.target.closest('[data-range]');
    if (r) return c.onRange?.(Number(r.dataset.range));
    const ep = e.target.closest('[data-ep]');
    if (ep) return c.play(Number(ep.dataset.ep));
    const open = e.target.closest('[data-open]');
    if (open) return c.open(open.dataset.open);
  };
  // الحلقة الحالية في وسط الشرائط الأفقية عند أول رسم وعند تبديل المجموعة فقط (أفقيًا؛ الصفحة لا تتحرك)
  if (center) requestAnimationFrame(() => {
    for (const strip of host.querySelectorAll('.wl-strip, .wl-track')) {
      const cur = strip.querySelector('.cur');
      if (!cur) continue;
      const a = cur.getBoundingClientRect();
      const b = strip.getBoundingClientRect();
      strip.scrollLeft += a.left + a.width / 2 - (b.left + b.width / 2);
    }
  });
}

/**
 * حركة كل نمط مع التمرير، كما في تصميمه، بدل انطواء البنر الخاص بالأساسي:
 * - المنصة: البنر يغوص (أبطأ من الصفحة، يغمق ويتضبب) والشعار والمعلومات يرتفعان ويختفيان.
 * - البطاقة الطائرة: خلفية مضبّبة بطيئة وفوقها البنر أسرع منها (عمق بطبقتين)، والبطاقة المائلة
 *   تعتدل وترتفع.
 * - شاشة السينما: الشاشة تميل للخلف كتلفاز على حامل، تصغر وتبهت، والغلاف يرتفع قليلًا.
 * - الحلقة أولًا: لقطة الحلقة تبتعد (ميل خفيف، تصغر، تستدير حوافها، تبهت)، ثم يظهر شريط «تابع» الصغير.
 * تُحسب كل إطار من موضع التمرير نفسه (rAF)، بلا CSS مربوط بالتمرير، فلا تعلق مع دفعة الإصبع.
 * @returns {() => void} فكّ الربط
 */
export function bindLookMotion(look, host, { hero = null, bg = null, active = () => true } = {}) {
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {};
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const f = (n) => n.toFixed(2);
  let raf = 0;
  const run = () => {
    raf = 0;
    if (!active() || !host.isConnected) return;
    const y = Math.max(0, globalThis.scrollY);
    const vh = globalThis.innerHeight || 800;
    if (look === 'platform') {
      const t = clamp(y / (vh * 0.4));
      // يغوص ويغمق ويتضبب: البنر يبهت فوق نسخته المضبّبة الداكنة خلفه (::before)، تحويل وشفافية فقط —
      // filter: blur() متغيّر مع كل إطار يعيد رسم البنر كله على الجوال وهو من أسباب التعليق
      if (bg) {
        bg.style.transform = `translate3d(0, ${f(y * 0.35)}px, 0) scale(${f(1 + 0.05 * t)})`;
        bg.style.opacity = f(1 - 0.6 * t);
      }
      const txt = host.querySelector('.wl-htxt');
      if (txt) {
        txt.style.transform = `translate3d(0, ${f(-20 * t)}px, 0)`;
        txt.style.opacity = f(clamp(1 - 1.3 * t));
      }
    } else if (look === 'card') {
      const t = clamp(y / (vh * 0.45));
      hero?.style.setProperty('--far-y', `${f(y * 0.5)}px`);
      if (bg) bg.style.transform = `translate3d(0, ${f(y * 0.25)}px, 0)`;
      const card = host.querySelector('.wl-card');
      if (card) card.style.transform = `rotateY(${f(-18 * (1 - t))}deg) rotateX(${f(6 * (1 - t))}deg) translate3d(0, ${f(-24 * t)}px, ${f(30 * t)}px)`;
    } else if (look === 'screen') {
      const t = clamp(y / (vh * 0.38));
      if (hero) {
        hero.style.transform = `perspective(1000px) rotateX(${f(24 * t)}deg) translate3d(0, ${f(y * 0.25)}px, ${f(-90 * t)}px) scale(${f(1 - 0.05 * t)})`;
        hero.style.opacity = f(1 - 0.8 * t);
      }
      const cover = host.querySelector('.wl-top .wl-cover');
      if (cover) cover.style.transform = `translate3d(0, ${f(-16 * t)}px, 0)`;
    } else if (look === 'episode') {
      const t = clamp(y / (vh * 0.4));
      if (hero) {
        hero.style.transform = `perspective(900px) translate3d(0, ${f(y * 0.15)}px, ${f(-60 * t)}px) rotateX(${f(7 * t)}deg) scale(${f(1 - 0.05 * t)})`;
        // استدارة الحواف بفئة واحدة وانتقال قصير، لا قيمة جديدة مع كل إطار (إعادة رسم وقص)
        hero.classList.toggle('wl-lifted', t > 0.04);
        hero.style.opacity = f(1 - 0.7 * t);
      }
      const now = host.querySelector('.wl-now');
      if (now) now.style.opacity = f(1 - 0.6 * t);
      const mini = host.querySelector('.wl-mini');
      const k = clamp((t - 0.55) / 0.45);
      if (mini) {
        mini.style.opacity = f(k);
        mini.style.transform = `translate(50%, ${f(-80 + 90 * k)}px)`;
        mini.style.pointerEvents = k > 0.5 ? 'auto' : 'none';
      }
    }
  };
  const on = () => {
    if (!raf) raf = requestAnimationFrame(run);
  };
  globalThis.addEventListener('scroll', on, { passive: true });
  globalThis.addEventListener('resize', on, { passive: true });
  run();
  // بعد كل رسم للنمط (وصول التفاصيل) تُطبَّق الحالة الحالية على العناصر الجديدة
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(on) : null;
  mo?.observe(host, { childList: true });
  return () => {
    globalThis.removeEventListener('scroll', on);
    globalThis.removeEventListener('resize', on);
    mo?.disconnect();
    if (raf) cancelAnimationFrame(raf);
  };
}
