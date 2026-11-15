/**
 * «التحميلات»: مكتبة ما احتفظت به على جهازك، وطابور ما يُنزَّل الآن.
 *
 * منطقتان: «جاري التحميل» (صفوف أفقية بالتقدّم والسرعة والتحكم) و«على الجهاز» (شبكة أغلفة
 * الأعمال نفسها من مكتبتي، عمل واحد لكل بطاقة بعدد ما حُفظ منه). لا اسم «المكتملة»: ستة فصول
 * من 150 ليست عملًا مكتملًا.
 *
 * الأداء: تحديث السرعة يلمس نص الصف وشريطه وحدهما (transform: scaleX)، لا يعيد بناء البطاقة
 * ولا القائمة. التحديثات تُجمع في إطار واحد. مغادرة الصفحة تُلغي الاشتراك ولا تمس التنزيلات.
 */

import { downloads } from '../lib/downloads/index.js';
import { ACTIVE_STATES, ERROR_LABEL, STATES, STATE_LABEL, countText, localWork, matchesNumberList, numberLabel, onDeviceWorks, parseNumberList, pickUnits, queueSummary, unitLabel } from '../lib/downloads/model.js';
import { PARALLEL_CHOICES } from '../lib/downloads/manager.js';
import { artUrl, dropWorkArt, saveWorkArt } from '../lib/downloads/art.js';
import { createLocalMangaEngine, localRows } from '../lib/downloads/local-reader.js';
import { etaSeconds, formatBytes, formatEta, formatProgressBytes, formatSpeed, progressRatio } from '../lib/downloads/units.js';
import { glyph } from './icons.js';

const SECTION_LABEL = { all: 'الكل', anime: 'أنمي', manga: 'مانجا', cinema: 'سينما' };
const QUALITY_CHOICES = [[null, 'الأفضل'], [1080, '1080p'], [720, '720p'], [480, '480p']];

/** نص LTR معزول داخل سطر عربي: الأرقام والوحدات لا تنقلب. */
const ltr = (el, text, cls) => {
  const b = el('bdi', cls ?? null, text);
  b.dir = 'ltr';
  return b;
};

export function createDownloadsUI(deps) {
  const { q, el, toast, openSheet, closeSheet, showPage } = deps;
  const view = {
    tab: 'queue',
    filter: 'all',
    scroll: { queue: 0, device: 0 },
    rows: new Map(),
    off: null,
    frame: 0,
    dirty: new Set(),
    listDirty: false,
    work: null,
  };
  let ctx = null; // { manager, store, caps }

  const ready = () => (ctx ? Promise.resolve(ctx) : downloads().then((c) => (ctx = c)));

  // ───────────── المدخل: زر «التحميلات» في مكتبتي ─────────────

  /** الدائرة حول أيقونة المدخل تقول إن هناك تنزيلًا يعمل، بلا رقم مزعج. */
  function paintEntry(summary) {
    for (const b of deps.root.querySelectorAll('[data-act="openDownloads"]')) b.classList.toggle('is-busy', summary.active + summary.waiting > 0);
  }

  // ───────────── الصفحة ─────────────

  async function open(tab) {
    const c = await ready();
    if (tab) view.tab = tab;
    else if (!c.manager.list().some((i) => i.state !== STATES.ready)) view.tab = 'device';
    showPage('downloads');
    subscribe();
    render();
  }

  function subscribe() {
    if (view.off || !ctx) return;
    view.off = ctx.manager.subscribe((e) => {
      if (e.type === 'progress' || e.type === 'change') {
        view.dirty.add(e.id);
        if (e.type === 'change') view.listDirty = view.listDirty || e.item?.state === STATES.ready || !view.rows.has(e.id);
      } else view.listDirty = true;
      schedule();
    });
  }

  /** تُنادى عند مغادرة الصفحة: الاشتراك يُلغى، والتنزيلات تكمل في الخلفية. */
  function leave() {
    view.off?.();
    view.off = null;
    if (view.frame) cancelAnimationFrame(view.frame);
    view.frame = 0;
  }

  function schedule() {
    if (view.frame) return;
    view.frame = requestAnimationFrame(() => {
      view.frame = 0;
      paintEntry(ctx.manager.summary());
      if (deps.currentPage?.() === 'downloadWork' && view.listDirty && view.work) {
        view.listDirty = false;
        view.dirty.clear();
        return renderWork(view.work);
      }
      if (deps.currentPage?.() !== 'downloads') return;
      if (view.listDirty) {
        view.listDirty = false;
        view.dirty.clear();
        return render({ keepScroll: true });
      }
      for (const id of view.dirty) updateRow(id);
      view.dirty.clear();
      paintSummary();
    });
  }

  function host() {
    return q('downloadsBody');
  }

  function render({ keepScroll = false } = {}) {
    const box = host();
    if (!box || !ctx) return;
    const page = q('downloads');
    if (!keepScroll && page) view.scroll[view.tab === 'queue' ? 'device' : 'queue'] = page.scrollTop;
    const items = ctx.manager.list();
    const pending = items.filter((i) => i.state !== STATES.ready);
    const nodes = [tabs(pending.length), filters(items)];
    if (!ctx.caps.video) nodes.push(note('على هذا الجهاز تُنزَّل فصول المانجا فقط. تنزيل الحلقات والأفلام في تطبيق Android وويندوز.'));
    if (view.tab === 'queue') nodes.push(queueView(pending));
    else nodes.push(deviceView(items));
    box.replaceChildren(...nodes);
    if (page && !keepScroll) page.scrollTop = view.scroll[view.tab] ?? 0;
  }

  function note(text) {
    const p = el('p', 'dl-note', text);
    return p;
  }

  function tabs(pendingCount) {
    const bar = el('div', 'segmented library-tabs dl-tabs');
    bar.setAttribute('role', 'tablist');
    for (const [k, label, n] of [['queue', 'جاري التحميل', pendingCount], ['device', 'على الجهاز', 0]]) {
      const b = el('button', `library-tab${view.tab === k ? ' active' : ''}`, label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(view.tab === k));
      if (n) b.append(el('b', null, String(n)));
      b.onclick = () => {
        if (view.tab === k) return;
        const page = q('downloads');
        if (page) view.scroll[view.tab] = page.scrollTop;
        view.tab = k;
        render({ keepScroll: true });
        if (page) page.scrollTop = view.scroll[k] ?? 0;
      };
      bar.append(b);
    }
    return bar;
  }

  /** فلاتر الأقسام: الموجود فعلًا في التنزيلات وما يدعمه الجهاز، لا خيارات وهمية. */
  function filters(items) {
    const present = new Set(items.map((i) => i.section));
    const supported = ctx.caps.video ? ['anime', 'manga', 'cinema'] : ['manga'];
    const list = ['all', ...supported.filter((s) => present.has(s))];
    const wrap = el('div', 'dl-filters');
    if (list.length <= 2) return wrap;
    for (const k of list) {
      const b = el('button', `dl-chip${view.filter === k ? ' is-on' : ''}`, SECTION_LABEL[k]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(view.filter === k));
      b.onclick = () => {
        view.filter = k;
        render({ keepScroll: true });
      };
      wrap.append(b);
    }
    return wrap;
  }

  const visible = (i) => view.filter === 'all' || i.section === view.filter;

  // ───────────── جاري التحميل ─────────────

  function queueView(pending) {
    const wrap = el('div', 'dl-queue');
    const list = pending.filter(visible);
    view.rows.clear();
    if (!list.length) {
      wrap.append(empty('downloads', 'لا شيء يُنزَّل الآن', 'افتح أي عمل، ثم ⋮ ← «تحميل».'));
      return wrap;
    }
    wrap.append(summaryBar());
    const rows = el('div', 'dl-rows');
    for (const item of list) rows.append(row(item));
    wrap.append(rows);
    paintSummary();
    return wrap;
  }

  function summaryBar() {
    const bar = el('div', 'dl-summary');
    bar.id = 'dlSummary';
    const text = el('span', 'dl-summary-text');
    const btn = el('button', 'dl-summary-btn');
    btn.type = 'button';
    btn.onclick = () => {
      const s = ctx.manager.summary();
      if (s.active + s.waiting > 0) ctx.manager.pauseAll();
      else ctx.manager.resumeAll();
    };
    const settings = el('button', 'icon-btn dl-summary-settings');
    settings.type = 'button';
    settings.setAttribute('aria-label', 'إعدادات التحميل');
    settings.innerHTML = glyph('sliders', { size: 20 });
    settings.onclick = () => openSettings();
    bar.append(text, btn, settings);
    return bar;
  }

  function paintSummary() {
    const bar = q('dlSummary');
    if (!bar || !ctx) return;
    const s = queueSummary(ctx.manager.list());
    const parts = [];
    if (s.active) parts.push(`${s.active} نشط`);
    if (s.waiting) parts.push(`${s.waiting} في الانتظار`);
    if (s.paused) parts.push(`${s.paused} متوقف`);
    if (s.failed) parts.push(`${s.failed} فشل`);
    const text = bar.querySelector('.dl-summary-text');
    text.replaceChildren(el('span', null, parts.join(' · ') || 'لا شيء يعمل'));
    const speed = formatSpeed(s.speed);
    if (speed) text.append(el('span', 'dl-dot', '·'), ltr(el, speed, 'dl-speed'));
    const btn = bar.querySelector('.dl-summary-btn');
    const running = s.active + s.waiting > 0;
    btn.innerHTML = `${glyph(running ? 'pause' : 'play', { size: 16 })}<span>${running ? 'إيقاف الكل' : 'استئناف الكل'}</span>`;
    btn.hidden = !running && !s.paused;
  }

  function thumb(item) {
    const t = el('span', 'dl-thumb');
    if (item.work.color) t.style.setProperty('--work-color', item.work.color);
    const img = el('img');
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.hidden = true;
    img.onload = () => { img.hidden = false; };
    t.append(img);
    void artUrl(ctx.store, item.work.ref, 'cover').then((u) => {
      const src = u ?? (navigator.onLine !== false ? item.work.cover : null);
      if (src) img.src = src;
    });
    return t;
  }

  function row(item) {
    const r = el('div', 'dl-row');
    r.dataset.id = item.id;
    r.dataset.section = item.section;
    const main = el('div', 'dl-main');
    const title = el('b', 'dl-title', item.work.title);
    title.dir = 'auto';
    const unit = el('span', 'dl-unit');
    const bar = el('div', 'dl-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', `${item.work.title} — ${unitLabel(item)}`);
    const fill = el('i');
    bar.append(fill);
    const meta = el('div', 'dl-meta');
    main.append(title, unit, bar, meta);
    const ctl = el('button', 'dl-ctl');
    ctl.type = 'button';
    ctl.onclick = (e) => {
      e.stopPropagation();
      const cur = ctx.manager.get(item.id);
      if (!cur) return;
      if (cur.state === STATES.paused || cur.state === STATES.failed || cur.state === STATES.noSpace) ctx.manager.resume(cur.id);
      else ctx.manager.pause(cur.id);
    };
    const info = el('button', 'dl-info');
    info.type = 'button';
    info.setAttribute('aria-label', 'تفاصيل التنزيل');
    info.innerHTML = glyph('info', { size: 20 });
    info.onclick = (e) => {
      e.stopPropagation();
      openInfo(item.id);
    };
    r.append(thumb(item), main, ctl, info);
    view.rows.set(item.id, { r, unit, bar, fill, meta, ctl, last: '' });
    updateRow(item.id);
    return r;
  }

  function updateRow(id) {
    const refs = view.rows.get(id);
    const item = ctx?.manager.get(id);
    if (!refs || !item) return;
    const ratio = item.kind === 'manga' ? progressRatio(item.pages, item.pagesTotal) : progressRatio(item.bytes, item.total);
    const active = item.state === STATES.downloading;
    refs.r.dataset.state = item.state;
    // سطر الوحدة: «الحلقة 8 · 1080p · MKV»
    const unitText = [unitLabel(item), item.source?.quality ? `${item.source.quality}p` : null, item.media?.container && item.media.container !== 'HLS' ? item.media.container : null].filter(Boolean).join(' · ');
    if (refs.unit.textContent !== unitText) refs.unit.textContent = unitText;
    // الشريط: نسبة حقيقية أو غير محدد؛ متوقف بلا حركة
    const indeterminate = ratio == null && (active || item.state === STATES.resolving || item.state === STATES.verifying);
    refs.bar.classList.toggle('is-indeterminate', indeterminate);
    refs.bar.classList.toggle('is-idle', !active && !indeterminate);
    refs.fill.style.transform = `scaleX(${ratio ?? 0})`;
    if (ratio != null) refs.bar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    else refs.bar.removeAttribute('aria-valuenow');
    // سطر الحالة: الحجم والنسبة، ثم السرعة والوقت المتبقي (مستقر فقط)
    const key = `${item.state}|${item.bytes}|${item.total}|${item.pages}|${Math.round(item.speed / 1024)}|${item.error?.code ?? ''}`;
    if (refs.last !== key) {
      refs.last = key;
      refs.meta.replaceChildren(...metaLine(item, ratio));
    }
    const resumeLike = item.state === STATES.paused || item.state === STATES.failed || item.state === STATES.noSpace;
    const icon = item.state === STATES.failed || item.state === STATES.noSpace ? 'refresh' : resumeLike ? 'play' : 'pause';
    const label = item.state === STATES.failed || item.state === STATES.noSpace ? 'إعادة المحاولة' : resumeLike ? 'استئناف' : 'إيقاف مؤقت';
    if (refs.ctl.dataset.icon !== icon) {
      refs.ctl.dataset.icon = icon;
      refs.ctl.innerHTML = glyph(icon, { size: 18, filled: icon !== 'refresh' });
      refs.ctl.setAttribute('aria-label', label);
    }
  }

  function metaLine(item, ratio) {
    const out = [];
    if (item.state === STATES.failed || item.state === STATES.noSpace) {
      out.push(el('span', 'dl-state is-bad', item.state === STATES.noSpace ? STATE_LABEL.no_space : ERROR_LABEL[item.error?.code] ?? ERROR_LABEL.UNKNOWN));
      return out;
    }
    if (item.state !== STATES.downloading) out.push(el('span', `dl-state${item.state === STATES.reconnecting ? ' is-warn' : ''}`, STATE_LABEL[item.state] ?? item.state));
    if (item.kind === 'manga') {
      if (item.pagesTotal) out.push(ltr(el, `${item.pages ?? 0}/${item.pagesTotal}`), el('span', null, 'صفحة'));
    } else if (item.bytes > 0 || item.total > 0) out.push(ltr(el, formatProgressBytes(item.bytes, item.total)));
    if (ratio != null && item.state === STATES.downloading) out.push(ltr(el, `${Math.floor(ratio * 100)}%`, 'dl-pct'));
    if (item.state === STATES.downloading) {
      const speed = formatSpeed(item.speed);
      if (speed) out.push(ltr(el, speed, 'dl-speed'));
      const eta = item.kind === 'manga' ? null : formatEta(etaSeconds({ done: item.bytes, total: item.total, rate: item.speed, stable: item.stable }));
      if (eta) out.push(el('span', 'dl-eta', `متبقٍ ${eta.replace(/^نحو /, 'نحو ')}`));
    }
    // فاصل هادئ بين الأجزاء
    const joined = [];
    out.forEach((n, i) => {
      if (i && !(n.textContent === 'صفحة')) joined.push(el('span', 'dl-dot', '·'));
      joined.push(n);
    });
    return joined;
  }

  // ───────────── على الجهاز ─────────────

  function deviceView(items) {
    const works = onDeviceWorks(items, { section: view.filter });
    const wrap = el('div', 'dl-device');
    if (!works.length) {
      wrap.append(empty('downloaded', 'لا شيء على الجهاز بعد', ctx.caps.video ? 'ما تنزّله من الحلقات والفصول والأفلام يظهر هنا، ويعمل بلا إنترنت.' : 'الفصول التي تنزّلها تظهر هنا وتُقرأ بلا إنترنت.'));
      return wrap;
    }
    const total = works.reduce((s, w) => s + w.bytes, 0);
    const head = el('p', 'dl-device-head');
    head.append(el('span', null, `${works.length} ${works.length === 1 ? 'عمل' : works.length === 2 ? 'عملان' : works.length <= 10 ? 'أعمال' : 'عملًا'}`));
    if (total > 0) head.append(el('span', 'dl-dot', '·'), ltr(el, formatBytes(total)));
    const grid = el('div', 'grid dl-grid');
    for (const w of works) grid.append(workCard(w));
    wrap.append(head, grid);
    return wrap;
  }

  function workCard(w) {
    const a = el('article', 'work-card dl-card');
    a.tabIndex = 0;
    a.setAttribute('role', 'link');
    a.setAttribute('aria-label', `${w.work.title} — ${countText(w.kind, w.count)} على الجهاز`);
    const frame = el('div', 'work-card-frame');
    const p = el('div', 'poster');
    if (w.work.color) p.style.background = `color-mix(in srgb, ${w.work.color} 40%, var(--surface-2))`;
    const badge = el('span', 'poster-badge dl-local-badge');
    badge.innerHTML = glyph('downloaded', { size: 12 });
    badge.setAttribute('aria-hidden', 'true');
    frame.append(p, badge);
    const img = el('img');
    img.alt = '';
    img.decoding = 'async';
    void artUrl(ctx.store, w.ref, 'cover').then((u) => {
      const src = u ?? (navigator.onLine !== false ? w.work.cover : null);
      if (!src) return;
      img.src = src;
      p.append(img);
    });
    const t = el('div', 'work-title', w.work.title);
    t.dir = 'auto';
    const m = el('div', 'work-meta', countText(w.kind, w.count));
    a.append(frame, t, m);
    a.onclick = () => openWork(w.ref);
    a.onkeydown = (e) => { if (e.key === 'Enter') openWork(w.ref); };
    return a;
  }

  function empty(icon, title, hint) {
    const box = el('div', 'dl-empty');
    box.innerHTML = `<span class="dl-empty-icon">${glyph(icon, { size: 30 })}</span>`;
    box.append(el('b', null, title), el('p', null, hint));
    return box;
  }

  // ───────────── صفحة العمل المحلي ─────────────

  async function openWork(ref) {
    await ready();
    view.work = ref;
    showPage('downloadWork');
    subscribe();
    renderWork(ref);
  }

  async function renderWork(ref) {
    const box = q('downloadWorkBody');
    if (!box) return;
    const data = localWork(ctx.manager.list(), ref);
    if (!data.ready.length && !data.pending.length) {
      // حُذف آخر عنصر: العمل لم يعد على الجهاز
      view.work = null;
      deps.goBack?.();
      return;
    }
    const w = data.work;
    const page = el('div', 'dl-work');
    page.dataset.section = data.section ?? '';
    if (w.color) page.style.setProperty('--work-color', w.color);
    const hero = el('div', 'dl-hero');
    const banner = el('div', 'dl-hero-art');
    const shade = el('span', 'dl-hero-shade');
    const back = el('button', 'icon-btn dl-hero-back');
    back.type = 'button';
    back.setAttribute('aria-label', 'رجوع');
    back.innerHTML = glyph('back');
    back.onclick = () => deps.goBack?.();
    hero.append(banner, shade, back);
    const head = el('div', 'dl-work-head');
    const cover = el('span', 'dl-work-cover');
    const info = el('div', 'dl-work-info');
    const logo = el('div', 'dl-work-logo');
    const title = el('h1', 'dl-work-title', w.title);
    title.dir = 'auto';
    const facts = el('p', 'dl-work-facts');
    facts.append(el('span', null, `${countText(data.kind, data.ready.length)} على الجهاز`));
    if (data.bytes > 0) facts.append(el('span', 'dl-dot', '·'), ltr(el, formatBytes(data.bytes)));
    info.append(logo, title, facts);
    head.append(cover, info);
    void Promise.all([artUrl(ctx.store, ref, 'banner'), artUrl(ctx.store, ref, 'cover'), artUrl(ctx.store, ref, 'logo')]).then(([b, c, l]) => {
      const online = navigator.onLine !== false;
      const bannerSrc = b ?? c ?? (online ? w.banner ?? w.cover : null);
      if (bannerSrc) banner.style.backgroundImage = `url("${bannerSrc}")`;
      const coverSrc = c ?? (online ? w.cover : null);
      if (coverSrc) {
        const img = el('img');
        img.alt = '';
        img.src = coverSrc;
        cover.append(img);
      }
      const logoSrc = l ?? null;
      if (logoSrc) {
        const img = el('img');
        img.alt = w.title;
        img.src = logoSrc;
        logo.append(img);
        title.classList.add('has-logo');
      }
    });

    const actions = el('div', 'dl-work-actions');
    const first = data.ready[0];
    if (first) {
      const verb = data.kind === 'manga' ? 'اقرأ' : 'شغّل';
      const primary = el('button', 'btn btn-primary dl-play');
      primary.type = 'button';
      primary.innerHTML = `${glyph(data.kind === 'manga' ? 'book' : 'play', { size: 18, filled: data.kind !== 'manga' })}<span>${data.kind === 'movie' ? 'شغّل الفيلم' : `${verb} ${unitLabel(first)}`}</span>`;
      primary.onclick = () => playItem(first, data);
      actions.append(primary);
    }
    if (deps.openOnline && navigator.onLine !== false) {
      const online = el('button', 'btn dl-online');
      online.type = 'button';
      online.innerHTML = `${glyph('compass', { size: 18 })}<span>صفحة العمل</span>`;
      online.onclick = () => deps.openOnline({ ref, section: data.section, title: w.title, cover: w.cover });
      actions.append(online);
    }
    const more = el('button', 'icon-btn dl-work-more');
    more.type = 'button';
    more.setAttribute('aria-label', 'حذف كل تنزيلات العمل');
    more.innerHTML = glyph('trash', { size: 20 });
    more.onclick = () => confirmDelete(data.ready, { title: `حذف ${w.title} من الجهاز`, all: true, ref });
    actions.append(more);

    page.append(hero, head, actions);
    if (data.pending.length) {
      const p = el('button', 'dl-pending-link');
      p.type = 'button';
      p.innerHTML = `<span class="dl-pulse" aria-hidden="true"></span><span>${data.pending.length === 1 ? 'عنصر واحد' : `${data.pending.length} عناصر`} في «جاري التحميل»</span>${glyph('chevron', { size: 16 })}`;
      p.onclick = () => open('queue');
      page.append(p);
    }
    if (data.kind !== 'movie') {
      const listBox = el('section', 'dl-units');
      if (data.seasons.length > 1) {
        const seasonTabs = el('div', 'segmented library-tabs dl-season-tabs');
        const current = view.season?.[ref] ?? data.seasons[0].season;
        for (const s of data.seasons) {
          const b = el('button', `library-tab${s.season === current ? ' active' : ''}`, s.season ? `الموسم ${s.season}` : 'إضافات');
          b.type = 'button';
          b.append(el('b', null, String(s.items.length)));
          b.onclick = () => {
            view.season = { ...(view.season ?? {}), [ref]: s.season };
            renderWork(ref);
          };
          seasonTabs.append(b);
        }
        listBox.append(seasonTabs);
        const s = data.seasons.find((x) => x.season === current) ?? data.seasons[0];
        listBox.append(unitList(s.items, data));
      } else {
        listBox.append(el('h2', 'dl-units-title', data.kind === 'manga' ? 'الفصول المحفوظة' : 'الحلقات المحفوظة'), unitList(data.ready, data));
      }
      page.append(listBox);
    }
    const scroller = q('downloadWork');
    const keep = scroller?.scrollTop ?? 0;
    box.replaceChildren(page);
    if (scroller) scroller.scrollTop = keep;
  }

  function unitList(items, data) {
    const list = el('div', 'dl-unit-list');
    for (const item of items) {
      const b = el('div', 'dl-unit-row');
      b.tabIndex = 0;
      b.setAttribute('role', 'button');
      const num = el('span', 'dl-unit-num', numberLabel(item.unit.number) ?? '•');
      num.dir = 'ltr';
      const text = el('div', 'dl-unit-text');
      const name = el('b', null, item.unit.title && item.kind !== 'manga' ? item.unit.title : unitLabel(item));
      name.dir = 'auto';
      const sub = el('span');
      const bits = [item.kind === 'manga' && item.unit.title ? item.unit.title : null, item.source?.quality ? `${item.source.quality}p` : null].filter(Boolean);
      if (bits.length) sub.append(el('span', null, bits.join(' · ')));
      const size = formatBytes(item.storage?.bytes ?? item.bytes);
      if (size) {
        if (bits.length) sub.append(el('span', 'dl-dot', '·'));
        sub.append(ltr(el, size));
      }
      text.append(name, sub);
      const go = el('span', 'dl-unit-go');
      go.innerHTML = glyph(item.kind === 'manga' ? 'book' : 'play', { size: 18, filled: item.kind !== 'manga' });
      const opts = el('button', 'icon-btn dl-unit-more');
      opts.type = 'button';
      opts.setAttribute('aria-label', `خيارات ${unitLabel(item)}`);
      opts.innerHTML = glyph('more', { size: 20 });
      opts.onclick = (e) => {
        e.stopPropagation();
        openUnitMenu(item);
      };
      b.append(num, text, go, opts);
      b.onclick = () => playItem(item, data);
      b.onkeydown = (e) => { if (e.key === 'Enter') playItem(item, data); };
      list.append(b);
    }
    return list;
  }

  function openUnitMenu(item) {
    openSheet((body) => {
      const h = el('h3', null, `${item.work.title} — ${unitLabel(item)}`);
      h.dir = 'auto';
      body.append(h);
      const info = sheetButton('info', 'التفاصيل', () => { closeSheet(); openInfo(item.id); });
      const del = sheetButton('trash', 'حذف من الجهاز', () => { closeSheet(); confirmDelete([item], { title: `حذف ${unitLabel(item)}` }); }, true);
      body.append(info, del);
    }, { tone: item.section });
  }

  function sheetButton(icon, label, run, danger = false) {
    const b = el('button', `sheet-item${danger ? ' sheet-item--danger' : ''}`);
    b.type = 'button';
    b.innerHTML = glyph(icon);
    b.append(el('span', null, label));
    b.onclick = run;
    return b;
  }

  /** تشغيل/قراءة المحفوظ: الملف المحلي وحده، بلا طلب سيرفر. */
  async function playItem(item, data) {
    if (item.kind === 'manga') {
      const items = data.ready.filter((i) => i.kind === 'manga');
      const engine = createLocalMangaEngine(ctx.store, items);
      const rows = localRows(items);
      const row = rows[items.indexOf(item)];
      deps.openReader?.({ seriesRef: item.work.ref, title: item.work.title, work: { id: item.work.ref, title: item.work.title, coverImage: { large: item.work.cover } }, rows, row, engine, sourceLocked: true, offline: true });
      return;
    }
    const native = ctx.caps.video ? (await import('../lib/downloads/index.js')).nativeDownloads() : null;
    if (!native?.play) return toast('التشغيل المحلي يعمل في تطبيق Android وويندوز');
    try {
      await native.play({
        id: item.id,
        title: item.work.title,
        section: item.section,
        animeId: String(item.work.ref).split(':').slice(1).join(':'),
        episode: item.unit.number ?? 1,
        format: item.kind === 'movie' ? 'MOVIE' : null,
      });
    } catch (e) {
      toast(`تعذّر التشغيل: ${e?.message ?? e}`);
    }
  }

  // ───────────── الحذف (بتأكيد) والإلغاء ─────────────

  function confirmDelete(items, { title, all = false, ref = null }) {
    const bytes = items.reduce((s, i) => s + (Number(i.storage?.bytes ?? i.bytes) || 0), 0);
    const kind = items[0]?.kind;
    openSheet((body) => {
      body.classList.add('dl-confirm');
      const h = el('h3', null, title);
      h.dir = 'auto';
      const p = el('p', 'dl-confirm-text');
      p.append(el('span', null, `يُحذف ${countText(kind, items.length)} من هذا الجهاز`));
      const size = formatBytes(bytes);
      if (size) p.append(el('span', null, ' ويُحرَّر '), ltr(el, size));
      p.append(el('span', null, '. حسابك ومكتبتك وتقدّمك لا يتأثرون.'));
      const row = el('div', 'dl-confirm-actions');
      const cancel = el('button', 'btn', 'إبقاء');
      cancel.type = 'button';
      cancel.onclick = () => closeSheet();
      const del = el('button', 'btn btn-danger', 'حذف');
      del.type = 'button';
      del.onclick = async () => {
        del.disabled = true;
        const freed = await ctx.manager.remove(items.map((i) => i.id));
        if (all && ref) await dropWorkArt(ctx.store, ref);
        else if (ref == null && items[0] && !ctx.manager.list().some((i) => i.work.ref === items[0].work.ref)) await dropWorkArt(ctx.store, items[0].work.ref);
        closeSheet();
        const f = formatBytes(freed);
        toast(f ? `حُذف وتحرّر ${f}` : 'حُذف من الجهاز');
      };
      row.append(cancel, del);
      body.append(h, p, row);
    }, { tone: items[0]?.section });
  }

  function confirmCancel(item) {
    openSheet((body) => {
      body.classList.add('dl-confirm');
      body.append(el('h3', null, `إلغاء تنزيل ${unitLabel(item)}`));
      const p = el('p', 'dl-confirm-text', item.bytes > 0 || item.pages > 0 ? 'يُحذف ما نُزّل منه حتى الآن ويخرج من الطابور. للإبقاء عليه استعمل «إيقاف مؤقت».' : 'يخرج من الطابور.');
      const row = el('div', 'dl-confirm-actions');
      const keep = el('button', 'btn', 'تراجع');
      keep.type = 'button';
      keep.onclick = () => closeSheet();
      const go = el('button', 'btn btn-danger', 'إلغاء التنزيل');
      go.type = 'button';
      go.onclick = async () => {
        go.disabled = true;
        await ctx.manager.cancel(item.id);
        closeSheet();
        toast('أُلغي التنزيل');
      };
      row.append(keep, go);
      body.append(p, row);
    }, { tone: item.section });
  }

  // ───────────── ⓘ التفاصيل ─────────────

  function openInfo(id) {
    const item = ctx.manager.get(id);
    if (!item) return;
    openSheet((body) => {
      body.classList.add('dl-info-sheet');
      const h = el('h3', null, item.work.title);
      h.dir = 'auto';
      const state = el('p', 'dl-info-state', `${unitLabel(item)} · ${STATE_LABEL[item.state] ?? item.state}`);
      body.append(h, state);
      const yes = (v) => (v === true ? 'نعم' : v === false ? 'لا' : null);
      const media = item.media ?? {};
      const groups = [
        ['المحتوى', [
          ['العمل', item.work.title],
          [item.kind === 'manga' ? 'الفصل' : item.kind === 'movie' ? null : 'الحلقة', item.kind === 'movie' ? null : numberLabel(item.unit.number)],
          ['الموسم', item.unit.season > 0 && item.section === 'cinema' ? String(item.unit.season) : null],
          ['الجودة', item.source?.quality ? `${item.source.quality}p` : null],
          ['الصيغة', media.container ?? (item.kind === 'manga' ? 'صور' : null)],
          ['الحجم الإجمالي', item.total > 0 ? formatBytes(item.total) : null, true],
          [item.kind === 'manga' ? 'الصفحات' : 'المُنزَّل', item.kind === 'manga' ? (item.pagesTotal ? `${item.pages ?? 0}/${item.pagesTotal}` : null) : formatBytes(item.bytes), true],
        ]],
        ['المصدر', [
          ['المصدر', item.source?.sourceName ?? item.source?.sourceId ?? null],
          ['الاختيار', item.source?.mode === 'manual' ? 'يدوي' : 'ذكي'],
          ['السيرفر', item.source?.routeCode ?? item.source?.server ?? null],
          ['نوع الاتصال', { http: 'HTTP', hls: 'HLS', dash: 'DASH', torrent: 'Torrent', pages: 'صفحات' }[item.transport] ?? null],
          ['يدعم الاستئناف', yes(item.resumable)],
          ['السرعة الحالية', item.state === STATES.downloading ? formatSpeed(item.speed) : null, true],
        ]],
        ['الوسائط', item.kind === 'manga' ? [] : [
          ['الترميز', media.codec ?? null, true],
          ['مسارات الصوت', media.audio?.length ? media.audio.map((a) => (typeof a === 'string' ? a : `${a.lang}${a.saved === false ? ' (لم يُحفظ)' : ''}`)).join('، ') : null],
          ['الترجمات', media.subtitles?.length ? media.subtitles.map((s) => (typeof s === 'string' ? s : `${s.lang}${s.saved === false ? ' (لم تُحفظ)' : ''}`)).join('، ') : null],
        ]],
        ['التخزين', [
          ['المكان', item.storage?.location ?? (item.kind === 'manga' ? 'مخزن التطبيق على هذا الجهاز' : null)],
          ['الحجم على الجهاز', item.storage?.bytes ? formatBytes(item.storage.bytes) : null, true],
          ['التحقق من السلامة', item.state === STATES.ready ? (item.storage?.verified ? 'سليم ومكتمل' : 'لم يُتحقق') : item.state === STATES.verifying ? 'جارٍ' : null],
          ['بدأ', item.startedAt ? dateText(item.startedAt) : null],
          ['اكتمل', item.finishedAt && item.state === STATES.ready ? dateText(item.finishedAt) : null],
        ]],
      ];
      for (const [name, rows] of groups) {
        const shown = rows.filter(([k, v]) => k && v != null && v !== '');
        if (!shown.length) continue;
        const sec = el('section', 'dl-info-group');
        sec.append(el('h4', null, name));
        const dl = el('dl');
        for (const [k, v, isLtr] of shown) {
          const dd = el('dd');
          if (isLtr) dd.append(ltr(el, v));
          else {
            dd.textContent = v;
            dd.dir = 'auto';
          }
          dl.append(el('dt', null, k), dd);
        }
        sec.append(dl);
        body.append(sec);
      }
      if (item.error?.message && item.state !== STATES.ready) {
        const why = el('p', 'dl-info-error');
        why.append(el('b', null, ERROR_LABEL[item.error.code] ?? ERROR_LABEL.UNKNOWN), el('span', null, item.error.message));
        body.append(why);
      }
      const acts = el('div', 'dl-confirm-actions');
      if (item.state !== STATES.ready) {
        const cancel = el('button', 'btn btn-danger-ghost', 'إلغاء التنزيل');
        cancel.type = 'button';
        cancel.onclick = () => { closeSheet(); confirmCancel(item); };
        acts.append(cancel);
        if (item.state === STATES.failed || item.state === STATES.noSpace) {
          const retry = el('button', 'btn btn-primary', 'إعادة المحاولة');
          retry.type = 'button';
          retry.onclick = () => { ctx.manager.retry(item.id); closeSheet(); };
          acts.append(retry);
        }
      } else {
        const del = el('button', 'btn btn-danger-ghost', 'حذف من الجهاز');
        del.type = 'button';
        del.onclick = () => { closeSheet(); confirmDelete([item], { title: `حذف ${unitLabel(item)}` }); };
        acts.append(del);
      }
      body.append(acts);
    }, { tone: item.section });
  }

  const dateText = (ms) => new Date(ms).toLocaleString('ar', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  // ───────────── الإعدادات ─────────────

  async function openSettings() {
    const c = await ready();
    const s = c.manager.settings();
    const native = c.caps.video ? (await import('../lib/downloads/index.js')).nativeDownloads() : null;
    openSheet((body) => {
      body.classList.add('dl-settings');
      body.append(el('h3', null, 'إعدادات التحميل'));
      const par = el('div', 'dl-setting');
      const parHead = el('div', 'dl-setting-head');
      parHead.append(el('b', null, 'التحميل المتوازي'), el('span', null, 'كم عنصرًا يُنزَّل في الوقت نفسه. البقية تنتظر وتبدأ تلقائيًا.'));
      const seg = el('div', 'dl-seg');
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', 'التحميل المتوازي');
      for (const n of PARALLEL_CHOICES) {
        const b = el('button', `dl-seg-btn${s.parallel === n ? ' is-on' : ''}`, String(n));
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(s.parallel === n));
        b.onclick = () => {
          c.manager.setParallel(n);
          for (const x of seg.children) {
            const on = x === b;
            x.classList.toggle('is-on', on);
            x.setAttribute('aria-checked', String(on));
          }
        };
        seg.append(b);
      }
      par.append(parHead, seg);
      const wifi = toggleRow('Wi-Fi فقط', 'لا يُنزَّل شيء على بيانات الجوال. ما في الطابور ينتظر الشبكة.', s.wifiOnly, (on) => c.manager.setWifiOnly(on));
      const storage = el('div', 'dl-setting dl-storage');
      storage.append(el('div', 'dl-setting-head'));
      body.append(par, wifi, storage);
      void storageLine(c, native).then((nodes) => storage.firstChild.append(...nodes));
    });
  }

  function toggleRow(title, hint, on, change) {
    const row = el('label', 'dl-setting dl-toggle');
    const head = el('div', 'dl-setting-head');
    head.append(el('b', null, title), el('span', null, hint));
    const input = el('input');
    input.type = 'checkbox';
    input.checked = on;
    input.setAttribute('role', 'switch');
    input.onchange = () => change(input.checked);
    const knob = el('span', 'dl-switch');
    row.append(head, input, knob);
    return row;
  }

  async function storageLine(c, native) {
    const used = c.manager.list().filter((i) => i.state === STATES.ready).reduce((s, i) => s + (Number(i.storage?.bytes ?? i.bytes) || 0), 0);
    let free = null;
    let where = c.caps.video ? null : 'مخزن التطبيق على هذا الجهاز';
    try {
      if (native?.capabilities) {
        const cap = await native.capabilities();
        free = cap.freeBytes;
        where = cap.location ?? where;
      } else if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        free = est.quota && est.usage != null ? est.quota - est.usage : null;
      }
    } catch {
      /* المساحة معلومة إضافية */
    }
    const out = [el('b', null, 'التخزين')];
    const line = el('span');
    line.append(el('span', null, 'التنزيلات '), ltr(el, formatBytes(used) ?? '0 B'));
    if (free != null && free >= 0) line.append(el('span', null, ' · متاح '), ltr(el, formatBytes(free)));
    out.push(line);
    if (where) {
      const w = el('span', 'dl-where', where);
      w.dir = 'auto';
      out.push(w);
    }
    if (c.store.kind === 'indexeddb' && !c.store.persistent && !c.caps.video) out.push(el('span', 'dl-where', 'المتصفح لم يمنح تخزينًا دائمًا؛ قد يُخليه عند ضيق المساحة.'));
    return out;
  }

  // ───────────── ورقة بدء التنزيل ─────────────

  /**
   * @param {{
   *   section: 'anime'|'manga'|'cinema', kind: 'episode'|'movie'|'manga',
   *   work: { ref: string, title: string, cover?: string, banner?: string, logo?: string, color?: string },
   *   units: { key: string, number: number, season?: number, title?: string }[],
   *   seasons?: { n: number, label: string }[], season?: number,
   *   current?: string,
   *   sources?: () => Promise<{ id: string, name: string, note?: string }[]>,
   *   build: (units: object[], choice: { mode: 'smart'|'manual', sourceId: string|null, sourceName?: string|null, quality: number|null }) => Promise<object[]>,
   * }} spec
   */
  async function openDownloadSheet(spec) {
    const c = await ready();
    const video = spec.kind !== 'manga';
    if (video && !c.caps.video) return toast('تنزيل الحلقات والأفلام متاح في تطبيق Android وويندوز');
    if (!video && !c.caps.manga) return toast('التنزيل غير متاح في هذا المتصفح');
    const units = spec.units ?? [];
    const onDevice = new Set(c.manager.list().filter((i) => i.work.ref === spec.work.ref && i.state === STATES.ready).map((i) => String(i.unit.key)));
    const queued = new Set(c.manager.list().filter((i) => i.work.ref === spec.work.ref && i.state !== STATES.ready).map((i) => String(i.unit.key)));
    const pick = {
      scope: spec.kind === 'movie' ? 'all' : 'one',
      text: '',
      season: spec.season ?? spec.seasons?.[0]?.n ?? null,
      mode: 'smart',
      sourceId: null,
      sourceName: null,
      quality: null,
      wifiOnly: c.manager.settings().wifiOnly,
    };
    const currentUnit = units.find((u) => String(u.key) === String(spec.current)) ?? units[0];
    const chosen = () => {
      if (spec.kind === 'movie') return units.slice(0, 1);
      if (pick.scope === 'one') return currentUnit ? [currentUnit] : [];
      if (pick.scope === 'season') return pickUnits(units, { type: 'season', season: pick.season });
      if (pick.scope === 'all') return units.slice();
      const ranges = parseNumberList(pick.text);
      if (!ranges) return [];
      return units.filter((u) => matchesNumberList(ranges, u.number) && (pick.season == null || !spec.seasons?.length || Number(u.season) === Number(pick.season)));
    };
    openSheet((body) => {
      body.classList.add('dl-start');
      // الرأس: غلاف العمل واسمه
      const head = el('div', 'dl-start-head');
      const cover = el('span', 'dl-start-cover');
      if (spec.work.cover) {
        const img = el('img');
        img.alt = '';
        img.src = spec.work.cover;
        cover.append(img);
      }
      const ht = el('div');
      const t = el('h3', null, spec.work.title);
      t.dir = 'auto';
      ht.append(el('span', 'dl-start-kicker', 'تحميل إلى الجهاز'), t);
      head.append(cover, ht);
      body.append(head);

      // النطاق
      if (spec.kind !== 'movie' && units.length) {
        const group = el('section', 'dl-start-group');
        group.append(el('h4', null, 'النطاق'));
        const chips = el('div', 'dl-chips');
        const options = [
          ['one', currentUnit ? (spec.kind === 'manga' ? `الفصل ${numberLabel(currentUnit.number)}` : `الحلقة ${numberLabel(currentUnit.number)}`) : null],
          ['range', spec.kind === 'manga' ? 'فصول محددة' : 'حلقات محددة'],
          ...(spec.seasons?.length ? [['season', 'الموسم كاملًا']] : []),
          ['all', spec.kind === 'manga' ? `كل الفصول (${units.length})` : spec.seasons?.length ? 'كل المواسم' : `كل الحلقات (${units.length})`],
        ].filter(([, l]) => l);
        for (const [k, label] of options) {
          const b = el('button', `dl-chip${pick.scope === k ? ' is-on' : ''}`, label);
          b.type = 'button';
          b.setAttribute('aria-pressed', String(pick.scope === k));
          b.onclick = () => {
            pick.scope = k;
            for (const x of chips.children) {
              x.classList.toggle('is-on', x === b);
              x.setAttribute('aria-pressed', String(x === b));
            }
            rangeBox.hidden = k !== 'range';
            seasonBox.hidden = !(spec.seasons?.length > 1 && (k === 'season' || k === 'range'));
            if (k === 'range') input.focus();
            refresh();
          };
          chips.append(b);
        }
        const seasonBox = el('div', 'dl-chips dl-season-pick');
        seasonBox.hidden = true;
        for (const s of spec.seasons ?? []) {
          const b = el('button', `dl-chip dl-chip--small${pick.season === s.n ? ' is-on' : ''}`, s.label);
          b.type = 'button';
          b.onclick = () => {
            pick.season = s.n;
            for (const x of seasonBox.children) x.classList.toggle('is-on', x === b);
            refresh();
          };
          seasonBox.append(b);
        }
        const rangeBox = el('div', 'dl-range');
        rangeBox.hidden = true;
        const input = el('input', 'search-input');
        input.inputMode = 'numeric';
        input.placeholder = spec.kind === 'manga' ? 'مثال: 1-12 أو 1، 4، 7' : 'مثال: 1-12 أو 3، 5';
        input.setAttribute('aria-label', 'الأرقام المطلوبة');
        input.oninput = () => {
          pick.text = input.value;
          refresh();
        };
        rangeBox.append(input);
        group.append(chips, seasonBox, rangeBox);
        body.append(group);
      }

      // المصدر
      const srcGroup = el('section', 'dl-start-group');
      srcGroup.append(el('h4', null, 'المصدر'));
      const modeSeg = el('div', 'dl-seg dl-seg--wide');
      const sourceList = el('div', 'dl-sources');
      sourceList.hidden = true;
      const modeHint = el('p', 'dl-hint', 'يفحص المصادر الجاهزة ويختار الأوضح والأكمل والأثبت، مع دعم الاستئناف.');
      for (const [k, label] of [['smart', 'تحميل ذكي'], ['manual', 'اختيار يدوي']]) {
        const b = el('button', `dl-seg-btn${pick.mode === k ? ' is-on' : ''}`, label);
        b.type = 'button';
        b.onclick = () => {
          pick.mode = k;
          for (const x of modeSeg.children) x.classList.toggle('is-on', x === b);
          sourceList.hidden = k !== 'manual';
          modeHint.textContent = k === 'smart' ? 'يفحص المصادر الجاهزة ويختار الأوضح والأكمل والأثبت، مع دعم الاستئناف.' : 'يلتزم بالمصدر الذي تختاره، ولا ينتقل لغيره دون إذنك.';
          if (k === 'manual' && !sourceList.childElementCount) void loadSources();
          refresh();
        };
        modeSeg.append(b);
      }
      async function loadSources() {
        sourceList.replaceChildren(el('p', 'dl-hint', 'نقرأ المصادر المتاحة…'));
        let list = [];
        try {
          list = (await spec.sources?.()) ?? [];
        } catch {
          list = [];
        }
        if (!body.isConnected) return;
        if (!list.length) {
          sourceList.replaceChildren(el('p', 'dl-hint', 'لم نجد مصادر لهذا العمل الآن. التحميل الذكي يبحث وقت التنزيل.'));
          return;
        }
        sourceList.replaceChildren(...list.map((s) => {
          const b = el('button', `dl-source${pick.sourceId === s.id ? ' is-on' : ''}`);
          b.type = 'button';
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', String(pick.sourceId === s.id));
          const name = el('b', null, s.name);
          name.dir = 'auto';
          b.append(el('span', 'dl-radio'), name);
          if (s.note) b.append(el('span', 'dl-source-note', s.note));
          b.onclick = () => {
            pick.sourceId = s.id;
            pick.sourceName = s.name;
            for (const x of sourceList.children) {
              const on = x === b;
              x.classList.toggle('is-on', on);
              x.setAttribute('aria-checked', String(on));
            }
            refresh();
          };
          return b;
        }));
      }
      srcGroup.append(modeSeg, modeHint, sourceList);
      body.append(srcGroup);

      // الجودة (فيديو)
      if (video) {
        const qGroup = el('section', 'dl-start-group');
        qGroup.append(el('h4', null, 'الجودة'));
        const chips = el('div', 'dl-chips');
        for (const [v, label] of QUALITY_CHOICES) {
          const b = el('button', `dl-chip${pick.quality === v ? ' is-on' : ''}`, label);
          b.type = 'button';
          b.onclick = () => {
            pick.quality = v;
            for (const x of chips.children) x.classList.toggle('is-on', x === b);
          };
          chips.append(b);
        }
        qGroup.append(chips, el('p', 'dl-hint', 'الصوت والترجمات المدمجة تُحفظ كما هي، والترجمات الخارجية بجانب الملف.'));
        body.append(qGroup);
      }

      // التخزين
      const store = el('section', 'dl-start-group dl-start-storage');
      const wifi = toggleRow('Wi-Fi فقط', 'على بيانات الجوال ينتظر حتى تتصل بـWi-Fi.', pick.wifiOnly, (on) => { pick.wifiOnly = on; });
      const space = el('p', 'dl-hint');
      store.append(wifi, space);
      body.append(store);
      void storageFree(c).then((free) => {
        space.replaceChildren(el('span', null, 'الحجم يُعرف عند بدء التنزيل'));
        if (free != null) space.append(el('span', 'dl-dot', '·'), el('span', null, 'المتاح '), ltr(el, formatBytes(free)));
      });

      // زر البدء
      const foot = el('div', 'dl-start-foot');
      const go = el('button', 'btn btn-primary dl-start-go');
      go.type = 'button';
      const status = el('p', 'dl-start-status');
      foot.append(status, go);
      body.append(foot);

      function refresh() {
        const list = chosen();
        const fresh = list.filter((u) => !onDevice.has(String(u.key)) && !queued.has(String(u.key)));
        const already = list.length - fresh.length;
        const noun = spec.kind === 'movie' ? 'الفيلم' : countText(spec.kind === 'manga' ? 'manga' : 'episode', fresh.length);
        go.innerHTML = `${glyph('downloads', { size: 18 })}<span>${fresh.length ? `نزّل ${noun}` : 'لا جديد للتنزيل'}</span>`;
        go.disabled = !fresh.length || (pick.mode === 'manual' && !pick.sourceId);
        status.textContent = already ? `${already === 1 ? 'واحد منها' : `${already} منها`} على الجهاز أو في الطابور` : pick.mode === 'manual' && !pick.sourceId ? 'اختر مصدرًا' : '';
      }
      go.onclick = async () => {
        const list = chosen().filter((u) => !onDevice.has(String(u.key)) && !queued.has(String(u.key)));
        if (!list.length) return;
        go.disabled = true;
        go.classList.add('is-busy');
        try {
          if (pick.wifiOnly !== c.manager.settings().wifiOnly) c.manager.setWifiOnly(pick.wifiOnly);
          const specs = await spec.build(list, { mode: pick.mode, sourceId: pick.sourceId, sourceName: pick.sourceName, quality: pick.quality });
          const { added } = await c.manager.enqueue(specs);
          void saveWorkArt(c.store, spec.work);
          closeSheet();
          paintEntry(c.manager.summary());
          toast(added.length ? (added.length === 1 ? 'بدأ التنزيل — تابعه في «التحميلات»' : `${added.length} في طابور التحميل`) : 'موجود مسبقًا');
        } catch (e) {
          go.disabled = false;
          go.classList.remove('is-busy');
          status.textContent = `تعذّر البدء: ${e?.message ?? e}`;
        }
      };
      refresh();
    }, { tone: spec.section });
  }

  async function storageFree(c) {
    try {
      const native = c.caps.video ? (await import('../lib/downloads/index.js')).nativeDownloads() : null;
      if (native?.capabilities) return (await native.capabilities()).freeBytes ?? null;
      const est = await navigator.storage?.estimate?.();
      return est?.quota && est.usage != null ? est.quota - est.usage : null;
    } catch {
      return null;
    }
  }

  // حالة المدخل عند الإقلاع (بلا فتح الصفحة)
  void ready().then((c) => {
    paintEntry(c.manager.summary());
    c.manager.subscribe((e) => {
      if (e.type === 'change' || e.type === 'list' || e.type === 'removed') paintEntry(c.manager.summary());
      if (e.type === 'completed' && deps.currentPage?.() !== 'downloads') toast(`على الجهاز: ${e.item.work.title} — ${unitLabel(e.item)}`);
    });
  }).catch(() => {});

  return {
    open,
    leave,
    openWork,
    openDownloadSheet,
    openSettings,
    isActive: (id) => ACTIVE_STATES.has(ctx?.manager.get(id)?.state),
    /** كم عنصرًا من هذا العمل على الجهاز (0 قبل أن يُقرأ البيان). */
    count: (ref) => (ctx ? ctx.manager.list().filter((i) => i.work.ref === ref && i.state === STATES.ready).length : 0),
    supports: (kind) => (ctx ? (kind === 'manga' ? ctx.caps.manga : ctx.caps.video) : null),
  };
}
