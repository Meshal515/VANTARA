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
import { parseRelease } from '../addons/release-info.js';
import { isTorrentRoute } from '../lib/route-family.js';

const SECTION_LABEL = { all: 'الكل', anime: 'أنمي', manga: 'مانجا', cinema: 'سينما' };

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
    // الشريط يُبنى فارغًا: يُملأ الآن لا عند أول تقدّم (كان زر «إيقاف الكل» يظهر بيضويًا فارغًا)
    paintSummary();
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
    // لا loading=lazy مع إخفاء: المتصفح لا يحمّل صورة كسولة مخفية أبدًا (كان الغلاف لا يظهر في الصف)
    img.onload = () => img.classList.add('is-loaded');
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
    const key = `${item.state}|${item.bytes}|${item.total}|${item.pages}|${Math.round(item.speed / 1024)}|${item.error?.code ?? ''}|${item.error?.message ?? ''}|${item.stage ?? ''}`;
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

  /**
   * المسارات بأسمائها: «العربية · OpenSubtitles» لا «ar، ar، ar». المتكرر يُجمع بعدده («العربية · Subsource ×3»).
   */
  function trackList(list, unsaved) {
    if (!list?.length) return null;
    let names;
    try { names = new Intl.DisplayNames(['ar'], { type: 'language' }); } catch { names = null; }
    const lang = (code) => {
      const c = String(code ?? '').trim();
      const tag = { ara: 'ar', arabic: 'ar', eng: 'en', english: 'en' }[c.toLowerCase()] ?? c;
      try { return (tag && /^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(tag) && names?.of(tag)) || c || 'غير محددة'; } catch { return c || 'غير محددة'; }
    };
    const counts = new Map();
    for (const t of list) {
      const x = typeof t === 'string' ? { lang: t } : t;
      const text = `${lang(x.lang)}${x.label ? ` · ${x.label}` : ''}${x.saved === false ? ` (${unsaved})` : ''}`;
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
    return [...counts].map(([text, n]) => (n > 1 ? `${text} ×${n}` : text)).join('، ');
  }

  /** السبب التقني مقروءًا: رموز HTTP بمعناها، ولا تكرار لما قاله العنوان. */
  function failureDetail(error, label) {
    const raw = String(error?.message ?? '').trim();
    if (!raw || raw === label) return null;
    // رسائل المتصفح العامة («Failed to fetch») لا تضيف لـ«انقطع الاتصال» شيئًا
    if (/^(?:TypeError:\s*)?(?:Failed to fetch|NetworkError\b|Load failed|network error|aborted)/i.test(raw)) return null;
    const http = /HTTP (\d{3})/.exec(raw)?.[1];
    const meaning = { 400: 'طلب مرفوض من الخادم', 401: 'الخادم يطلب تسجيل دخول', 403: 'الخادم منع الوصول (حماية أو رابط منتهي)', 404: 'الملف غير موجود عند المصدر', 405: 'الخادم لا يقبل هذا النوع من الطلبات', 410: 'الرابط حُذف أو انتهى', 429: 'كثرة طلبات — الخادم يطلب التمهّل', 451: 'المحتوى محجوب قانونيًا في هذه المنطقة' }[http];
    const text = meaning && !raw.includes(meaning) ? `${meaning} (HTTP ${http})` : raw;
    return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  }

  function metaLine(item, ratio) {
    const out = [];
    if (item.state === STATES.failed || item.state === STATES.noSpace) {
      const label = item.state === STATES.noSpace ? STATE_LABEL.no_space : ERROR_LABEL[item.error?.code] ?? ERROR_LABEL.UNKNOWN;
      out.push(el('span', 'dl-state is-bad', label));
      // السبب الفعلي تحت العنوان («الملف غير موجود عند المصدر (HTTP 404)»)، لا «المصدر رفض الطلب» وحده
      const why = failureDetail(item.error, label);
      if (why) {
        const d = el('span', 'dl-why', why);
        d.dir = 'auto';
        out.push(el('span', 'dl-break'), d);
      }
      return out;
    }
    if (item.state !== STATES.downloading) out.push(el('span', `dl-state${item.state === STATES.reconnecting ? ' is-warn' : ''}`, STATE_LABEL[item.state] ?? item.state));
    // «يجهّز المصدر» لا يبقى صامتًا: كم سيرفرًا جاهزًا وكم يُفحص، أو أنه يفحص الملف
    if (item.state === STATES.resolving && item.stage) {
      const st = el('span', 'dl-stage', item.stage);
      st.dir = 'auto';
      out.push(st);
    }
    if (item.state === STATES.reconnecting && item.error?.message) {
      const why = failureDetail(item.error, null);
      if (why) out.push(el('span', 'dl-break'), Object.assign(el('span', 'dl-why', why), { dir: 'auto' }));
    }
    if (item.kind === 'manga') {
      if (item.pagesTotal) out.push(ltr(el, `${item.pages ?? 0}/${item.pagesTotal}`), el('span', null, 'صفحة'));
    } else if (item.bytes > 0 || item.total > 0) out.push(ltr(el, formatProgressBytes(item.bytes, item.total)));
    if (ratio != null && item.state === STATES.downloading) out.push(ltr(el, `${Math.floor(ratio * 100)}%`, 'dl-pct'));
    if (item.state === STATES.downloading) {
      // سطر ثانٍ للسرعة والوقت: لا نقطة فاصلة معلّقة في أول السطر حين يلتف
      out.push(el('span', 'dl-break'));
      const speed = formatSpeed(item.speed);
      if (speed) out.push(ltr(el, speed, 'dl-speed'));
      if (item.torrent) out.push(el('span', null, `${item.torrent.peers} ${item.torrent.peers === 1 ? 'مشارك' : 'مشاركين'}`));
      const eta = item.kind === 'manga' ? null : formatEta(etaSeconds({ done: item.bytes, total: item.total, rate: item.speed, stable: item.stable }));
      if (eta) out.push(el('span', 'dl-eta', `متبقٍ ${eta.replace(/^نحو /, 'نحو ')}`));
    }
    // فاصل هادئ بين الأجزاء
    const joined = [];
    out.forEach((n, i) => {
      const prev = out[i - 1];
      if (i && n.textContent !== 'صفحة' && !n.classList.contains('dl-break') && !prev?.classList.contains('dl-break')) joined.push(el('span', 'dl-dot', '·'));
      joined.push(n);
    });
    if (joined.at(-1)?.classList.contains('dl-break')) joined.pop();
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

  /** نسخة محلية من فن العمل بمحرّك مصدره (المانجا)؛ الأنمي والسينما يُجلبان مباشرة. */
  const healedArt = new Set();
  function localArt(work) {
    if (!String(work?.ref ?? '').length || /^(anime|cinema):/.test(work.ref)) return null;
    return async (src, kind) => (kind === 'logo' ? null : (await import('./covers.js')).nativeCover(src, work.coverSource ?? null));
  }

  function workCard(w) {
    const a = el('article', 'work-card dl-card');
    a.tabIndex = 0;
    a.setAttribute('role', 'link');
    a.setAttribute('aria-label', `${w.work.title} — ${countText(w.kind, w.count)} على الجهاز`);
    const frame = el('div', 'work-card-frame');
    const p = el('div', 'poster');
    if (w.work.color) p.style.background = `color-mix(in srgb, ${w.work.color} 40%, var(--surface-2))`;
    frame.append(p);
    const img = el('img');
    img.alt = '';
    img.decoding = 'async';
    void artUrl(ctx.store, w.ref, 'cover').then(async (u) => {
      // تنزيل حُفظ بلا غلاف (أغلفة المانجا قبل الإصلاح): يُستكمل مرة بمحرّك المصدر ثم يُعرض من الجهاز
      if (!u && navigator.onLine !== false && w.work.cover && !healedArt.has(w.ref)) {
        healedArt.add(w.ref);
        if (await saveWorkArt(ctx.store, w.work, { local: localArt(w.work) })) u = await artUrl(ctx.store, w.ref, 'cover');
      }
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

  // ───────────── «على الجهاز» ← صفحة العمل الأصلية ─────────────

  /**
   * العمل المحمّل يُفتح في صفحته الأصلية نفسها (الأنمي/السينما/المانجا) بنمطها وشعارها وغلافها وبنرها،
   * ببياناته المحفوظة عند التنزيل وصوره المحفوظة على الجهاز. الفرق الوحيد: الحلقات/الفصول المعروضة
   * هي المحمّلة وحدها بأرقامها الأصلية، والتشغيل/القراءة من الملف بلا شبكة.
   */
  async function openWork(ref) {
    const c = await ready();
    const data = localWork(c.manager.list(), ref);
    if (!data.ready.length) return toast('لا شيء من هذا العمل على الجهاز');
    const [saved, cover, banner, logo] = await Promise.all([
      c.store.getArt(`${ref}|detail`).catch(() => null),
      artUrl(c.store, ref, 'cover'), artUrl(c.store, ref, 'banner'), artUrl(c.store, ref, 'logo'),
    ]);
    let base = null;
    try { base = saved?.json ? JSON.parse(saved.json) : null; } catch { base = null; }
    const w = data.work;
    const art = { cover: cover ?? w.cover ?? null, banner: banner ?? w.banner ?? null, logo: logo ?? w.logo ?? null };
    const id = String(ref).slice(String(ref).indexOf(':') + 1);
    const itemOf = new Map(data.ready.map((i) => [String(i.unit.key), i]));
    let snapshot;
    let local;
    if (data.section === 'anime') {
      const numbers = new Set(data.ready.map((i) => i.unit.number ?? 1));
      const max = Math.max(...numbers);
      snapshot = { ...(base ?? { id: /^\d+$/.test(id) ? Number(id) : id, title: w.title, format: w.format, color: w.color }),
        poster: art.cover, posterSmall: art.cover, banner: art.banner ?? (base?.banner ?? null) };
      if (!(snapshot.aired >= max)) snapshot.aired = Math.max(Number(snapshot.aired) || 0, max);
      local = {
        ref, numbers,
        art: { ...(art.logo ? { logo: art.logo } : {}), ...(art.banner ? { fanart: art.banner } : {}) },
        play: (n) => playItem(data.ready.find((i) => (i.unit.number ?? 1) === n)),
      };
    } else if (data.section === 'cinema') {
      const keys = new Set(itemOf.keys());
      const movie = data.kind === 'movie';
      const seasons = movie ? [] : (base?.seasons ?? [])
        .map((s) => ({ ...s, episodes: (s.episodes ?? []).filter((e) => keys.has(`s${s.n}e${e.n}`)) }))
        .filter((s) => s.episodes.length);
      // بيانات محفوظة ناقصة (تنزيل قديم): المواسم تُبنى من المحمّل نفسه
      if (!movie && !seasons.length) {
        const bySeason = new Map();
        for (const i of data.ready) {
          const sn = i.unit.season ?? 1;
          if (!bySeason.has(sn)) bySeason.set(sn, []);
          bySeason.get(sn).push({ n: i.unit.number, name: i.unit.title ?? null });
        }
        for (const [n, episodes] of [...bySeason].sort((a, b) => a[0] - b[0])) seasons.push({ n, episodes: episodes.sort((a, b) => a.n - b.n) });
      }
      snapshot = { ...(base ?? { id, type: movie ? 'movie' : 'series', title: w.title, name: w.title, year: w.year }),
        poster: art.cover, background: art.banner ?? art.cover, logo: art.logo, ...(movie ? {} : { seasons }) };
      local = { ref, keys, play: (key) => playItem(itemOf.get(String(key))) };
    } else {
      const items = data.ready.filter((i) => i.kind === 'manga');
      snapshot = { ...(base ?? { id: ref, title: { english: w.title }, genres: [], staff: { edges: [] } }), id: ref,
        coverImage: { ...(base?.coverImage ?? {}), large: art.cover, extraLarge: art.cover, medium: art.cover },
        bannerImage: art.banner ?? art.cover, wideBanner: art.banner ?? null };
      snapshot._work = { ...(snapshot._work ?? {}), key: snapshot._work?.key ?? ref.replace(/^ext:/, ''), title: w.title, thumbnailUrl: art.cover, editions: [] };
      local = { ref, rows: localRows(items), engine: createLocalMangaEngine(ctx.store, items) };
    }
    view.localRef = ref;
    deps.openLocalWork?.({ ref, section: data.section, snapshot, local });
  }

  /** ⋮ ← «تحميل» على صفحة عمل مفتوحة من الجهاز: ما عليه، وحذف ما تريد منه بتأكيد. */
  async function manage(ref) {
    const c = await ready();
    const data = localWork(c.manager.list(), ref);
    openSheet((body) => {
      body.classList.add('dl-manage');
      const h = el('h3', null, data.work.title ?? '');
      h.dir = 'auto';
      const facts = el('p', 'dl-hint');
      facts.append(el('span', null, `${countText(data.kind, data.ready.length)} على الجهاز`));
      if (data.bytes > 0) facts.append(el('span', 'dl-dot', '·'), ltr(el, formatBytes(data.bytes)));
      body.append(h, facts);
      for (const item of data.ready) {
        const row = sheetButton('trash', `حذف ${unitLabel(item)}`, () => { closeSheet(); confirmDelete([item], { title: `حذف ${unitLabel(item)}` }); }, true);
        const size = formatBytes(item.storage?.bytes ?? item.bytes);
        if (size) row.append(ltr(el, size, 'trail dl-size'));
        body.append(row);
      }
      if (data.ready.length > 1) body.append(sheetButton('trash', 'حذف كل ما على الجهاز من هذا العمل', () => { closeSheet(); confirmDelete(data.ready, { title: `حذف ${data.work.title} من الجهاز`, all: true, ref }); }, true));
    }, { tone: data.section });
  }

  function sheetButton(icon, label, run, danger = false) {
    const b = el('button', `sheet-item${danger ? ' sheet-item--danger' : ''}`);
    b.type = 'button';
    b.innerHTML = glyph(icon);
    b.append(el('span', null, label));
    b.onclick = run;
    return b;
  }

  /** تشغيل الحلقة/الفيلم المحفوظ: الملف المحلي وحده، بلا طلب سيرفر. */
  async function playItem(item) {
    if (!item) return toast('هذه الحلقة لم تعد على الجهاز');
    const native = ctx.caps.video ? (await import('../lib/downloads/index.js')).nativeDownloads() : null;
    if (!native?.play) return toast('التشغيل من الجهاز يعمل في تطبيق Android وويندوز');
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
        // الصفحة الأصلية مفتوحة من الجهاز: تُعاد بما بقي، أو يُرجع منها إن لم يبق شيء
        const ref0 = items[0]?.work.ref;
        if (ref0 && view.localRef === ref0 && ['anime', 'cinema', 'detail'].includes(deps.currentPage?.())) {
          if (ctx.manager.list().some((i) => i.work.ref === ref0 && i.state === STATES.ready)) void openWork(ref0);
          else deps.goBack?.();
        }
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
          ['مسارات الصوت', trackList(media.audio, 'لم يُحفظ')],
          ['الترجمات', trackList(media.subtitles, 'لم تُحفظ')],
        ]],
        ['التورنت', item.transport !== 'torrent' ? [] : [
          ['المشاركون المتصلون', item.torrent ? String(item.torrent.peers) : null, true],
          ['القطع المكتملة', item.torrent?.piecesTotal ? `${item.torrent.pieces} / ${item.torrent.piecesTotal}` : null, true],
          ['فحص القطع', 'كل قطعة تُطابَق ببصمتها قبل عدّها'],
          ['الحالة', STATE_LABEL[item.state] ?? item.state],
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
    // الموسم المفتوح وحده: لا «كل المواسم» (للموسم التالي افتح موسمه ونزّله)
    const all = spec.units ?? [];
    const units = spec.season != null && spec.kind !== 'manga' ? all.filter((u) => u.season == null || Number(u.season) === Number(spec.season)) : all;
    const mine = c.manager.list().filter((i) => i.work.ref === spec.work.ref);
    const onDevice = new Set(mine.filter((i) => i.state === STATES.ready).map((i) => String(i.unit.key)));
    const queued = new Set(mine.filter((i) => i.state !== STATES.ready).map((i) => String(i.unit.key)));
    const taken = (u) => onDevice.has(String(u.key)) || queued.has(String(u.key));
    const currentUnit = units.find((u) => String(u.key) === String(spec.current)) ?? units.find((u) => !taken(u)) ?? units[0];
    const pick = { scope: spec.kind === 'movie' ? 'season' : 'one', keys: new Set(currentUnit && !taken(currentUnit) ? [String(currentUnit.key)] : []), mode: 'smart', route: null, sourceId: null, sourceName: null };
    const unitWord = spec.kind === 'manga' ? 'الفصل' : 'الحلقة';
    const chosen = () => {
      if (spec.kind === 'movie') return units.slice(0, 1);
      if (pick.scope === 'one') return currentUnit ? [currentUnit] : [];
      if (pick.scope === 'season') return units.slice();
      return units.filter((u) => pick.keys.has(String(u.key)));
    };

    openSheet((body) => {
      body.classList.add('dl-start');
      const head = el('div', 'dl-start-head');
      const cover = el('span', 'dl-start-cover');
      if (spec.work.cover) { const img = el('img'); img.alt = ''; img.src = spec.work.cover; cover.append(img); }
      const ht = el('div');
      const t = el('h3', null, spec.work.title);
      t.dir = 'auto';
      const seasonName = spec.seasons?.find((x) => Number(x.n) === Number(spec.season))?.label;
      ht.append(t, el('span', 'dl-start-kicker', seasonName ? `تحميل · ${seasonName}` : 'تحميل إلى الجهاز'));
      head.append(cover, ht);
      body.append(head);

      // النطاق: تبويبات بسيطة فوق، والمحتوى تحتها
      const scopeBox = el('div', 'dl-scope');
      if (spec.kind !== 'movie' && units.length) {
        const tabsRow = el('div', 'segmented library-tabs dl-start-tabs');
        const opts = [
          ['one', currentUnit ? `${unitWord} ${numberLabel(currentUnit.number) ?? ''}`.trim() : null],
          ['pick', spec.kind === 'manga' ? 'فصول' : 'حلقات'],
          ['season', spec.kind === 'manga' ? 'كل الفصول' : 'الموسم كامل'],
        ].filter(([, l]) => l);
        for (const [k, label] of opts) {
          const b = el('button', `library-tab${pick.scope === k ? ' active' : ''}`, label);
          b.type = 'button';
          b.onclick = () => {
            pick.scope = k;
            for (const x of tabsRow.children) x.classList.toggle('active', x === b);
            paintScope();
            refresh();
          };
          tabsRow.append(b);
        }
        body.append(tabsRow, scopeBox);
      }
      function paintScope() {
        if (pick.scope !== 'pick') {
          const n = chosen().filter((u) => !taken(u)).length;
          const done = chosen().length - n;
          scopeBox.replaceChildren(el('p', 'dl-hint', pick.scope === 'one'
            ? (currentUnit?.title ? `${currentUnit.title}` : 'التي تتابعها الآن')
            : `${countText(spec.kind === 'manga' ? 'manga' : 'episode', chosen().length)}${done ? ` · ${done} على الجهاز` : ''}`));
          return;
        }
        // شبكة الأرقام: لمسة تختار أو تلغي (الحلقة 10 بلمسة واحدة)، والمحمّل معلّم ولا يُختار
        const grid = el('div', 'dl-grid-nums');
        for (const u of units) {
          const on = pick.keys.has(String(u.key));
          const b = el('button', `dl-num${on ? ' is-on' : ''}${taken(u) ? ' is-saved' : ''}`, numberLabel(u.number) ?? '•');
          b.type = 'button';
          b.dir = 'ltr';
          b.disabled = taken(u);
          b.setAttribute('aria-pressed', String(on));
          b.setAttribute('aria-label', `${unitWord} ${numberLabel(u.number)}${taken(u) ? ' — على الجهاز' : ''}`);
          b.onclick = () => {
            const k = String(u.key);
            if (pick.keys.has(k)) pick.keys.delete(k); else pick.keys.add(k);
            b.classList.toggle('is-on', pick.keys.has(k));
            b.setAttribute('aria-pressed', String(pick.keys.has(k)));
            refresh();
          };
          grid.append(b);
        }
        scopeBox.replaceChildren(grid);
      }
      paintScope();

      // المصدر: ذكي، أو سيرفر تختاره بنفسك (الجودة والمصدر والسرب كما في ورقة السيرفرات)
      body.append(el('h4', 'dl-section', 'المصدر'));
      const modeRow = el('div', 'segmented library-tabs dl-start-tabs');
      const sourceBox = el('div', 'dl-sources');
      const modeHint = el('p', 'dl-hint', 'يختار الأوضح والأكمل والأثبت من الجاهز فعلًا.');
      for (const [k, label] of [['smart', 'تحميل ذكي'], ['manual', video ? 'اختر السيرفر' : 'اختر المصدر']]) {
        const b = el('button', `library-tab${pick.mode === k ? ' active' : ''}`, label);
        b.type = 'button';
        b.onclick = () => {
          pick.mode = k;
          for (const x of modeRow.children) x.classList.toggle('active', x === b);
          modeHint.hidden = k !== 'smart';
          sourceBox.hidden = k !== 'manual';
          if (k === 'manual' && !sourceBox.childElementCount) void loadSources();
          refresh();
        };
        modeRow.append(b);
      }
      sourceBox.hidden = true;
      body.append(modeRow, modeHint, sourceBox);

      const selectRow = (b, data) => {
        pick.route = data.route ?? null;
        pick.sourceId = data.sourceId;
        pick.sourceName = data.name;
        for (const x of sourceBox.querySelectorAll('.dl-source')) x.classList.toggle('is-on', x === b);
        refresh();
      };
      const sourceRow = (data) => {
        const b = el('button', 'dl-source');
        b.type = 'button';
        b.append(el('span', 'dl-radio'));
        const main = el('span', 'dl-source-main');
        const name = el('b', null, data.name);
        name.dir = 'auto';
        main.append(name);
        if (data.sub) main.append(el('small', null, data.sub));
        b.append(main);
        if (data.size) b.append(ltr(el, data.size, 'dl-source-size'));
        if (data.quality) b.append(ltr(el, data.quality, 'dl-source-q'));
        if (data.seeds != null) { const sw = el('span', 'dl-seeds'); sw.innerHTML = glyph('users', { size: 14 }); sw.append(ltr(el, String(data.seeds))); b.append(sw); }
        b.onclick = () => selectRow(b, data);
        return b;
      };
      /** صف سيرفر من مسار محرك التشغيل: التورنت باسم إصداره وحجمه وسربه. */
      const routeRow = (r) => {
        const torrent = isTorrentRoute(r);
        // وصف التورنت بمحلّل ورقة التشغيل نفسه (الحجم والسرب واسم الإصدار) بأي صيغة تكتبها الإضافة
        const info = torrent && r.label ? parseRelease(r.sourceName ?? r.server ?? '', r.label) : null;
        return {
          route: r, sourceId: r.sourceId, name: r.sourceName ?? r.server ?? r.sourceId,
          sub: torrent
            ? (info?.filename ?? 'تورنت')
            : (r.server && r.server !== r.sourceName ? r.server : null),
          quality: r.quality ? (r.quality >= 2000 ? '4K' : `${r.quality}p`) : null,
          seeds: torrent ? Number(info?.seeders) || 0 : null,
          size: torrent ? info?.sizeLabel ?? null : null,
        };
      };
      async function loadSources() {
        const waiting = el('p', 'dl-hint', video ? 'نجهّز سيرفرات الحلقة…' : 'نقرأ المصادر…');
        sourceBox.replaceChildren(waiting);
        let rows = [];
        try {
          if (video && spec.build) {
            // سيرفرات الحلقة الحقيقية من محرك التشغيل نفسه. كل سيرفر يظهر لحظة جاهزيته في آخر القائمة
            // (ما ظهر لا يتحرك)، وسطر «نبحث عن المزيد» تحتها حتى تستقر المصادر.
            const unit = chosen()[0] ?? currentUnit;
            const [first] = await spec.build([unit], { mode: 'smart', sourceId: null, quality: null });
            const { resolveRoutes } = await import('../lib/downloads/video-driver.js');
            const eng = globalThis.__VANTARA_QA_DOWNLOADS__?.engine ?? (await import('../lib/anime-engine.js'));
            const shown = new Map();
            const list = el('div', 'dl-source-list');
            // جلسة الورقة تُغلق حين تُغلق الورقة: كانت تبقى مفتوحة بتذاكر تورنتاتها ومسح سيرفراتها حتى 25 ث
            const stop = new AbortController();
            const onRoutes = (routes) => {
              if (!body.isConnected) return void stop.abort('closed');
              // الجودة أولًا، ثم السرب: المشاركون يصنعون سرعة التورنت (إصدار بمشاركَين بطيء مهما كانت جودته)
              const fresh = routes.filter((r) => r.state === 'READY' && !shown.has(r.id)).map((r) => ({ r, row: routeRow(r) }))
                .sort((x, y) => (y.r.quality ?? 0) - (x.r.quality ?? 0) || (y.row.seeds ?? 0) - (x.row.seeds ?? 0));
              for (const { r, row } of fresh) {
                const b = sourceRow(row);
                shown.set(r.id, b);
                list.append(b);
              }
              const pending = routes.filter((r) => r.state === 'RESOLVING' || r.state === 'CHECKING').length;
              waiting.textContent = shown.size ? `نبحث عن المزيد…${pending ? ` (${pending})` : ''}` : (video ? 'نجهّز سيرفرات الحلقة…' : 'نقرأ المصادر…');
              if (shown.size && !list.isConnected) sourceBox.replaceChildren(list, waiting);
            };
            const out = await resolveRoutes(eng, first.request, { settleMs: 25_000, onRoutes, signal: stop.signal }).catch(() => null);
            if (out?.session) void Promise.resolve(eng.closeSession?.(out.session)).catch(() => {});
            if (!body.isConnected) return;
            if (shown.size) { waiting.remove(); return; }
          } else {
            rows = ((await spec.sources?.()) ?? []).map((x) => ({ sourceId: x.id, name: x.name, sub: x.note ? `${x.note} فصلًا` : null }));
          }
        } catch { rows = []; }
        if (!body.isConnected) return;
        if (sourceBox.querySelector('.dl-source')) { waiting.remove(); return; }
        sourceBox.replaceChildren(...(rows.length ? rows.map(sourceRow) : [el('p', 'dl-hint', 'ما جهز سيرفر الآن. التحميل الذكي يحاول وقت التنزيل.')]));
      }

      const foot = el('div', 'dl-start-foot');
      const status = el('p', 'dl-start-status');
      const go = el('button', 'btn btn-primary dl-start-go');
      go.type = 'button';
      foot.append(status, go);
      body.append(foot);
      void storageFree(c).then((free) => { if (free != null && body.isConnected) status.dataset.free = formatBytes(free); refresh(); });

      function refresh() {
        const list = chosen().filter((u) => !taken(u));
        const noun = spec.kind === 'movie' ? 'الفيلم' : countText(spec.kind === 'manga' ? 'manga' : 'episode', list.length);
        go.innerHTML = `${glyph('downloads', { size: 18 })}<span>${list.length ? `نزّل ${noun}` : 'كله على الجهاز'}</span>`;
        go.disabled = !list.length || (pick.mode === 'manual' && !pick.sourceId);
        const need = pick.mode === 'manual' && !pick.sourceId ? (video ? 'اختر سيرفرًا' : 'اختر مصدرًا') : null;
        status.textContent = need ?? (status.dataset.free ? `المتاح على الجهاز ${status.dataset.free}` : '');
      }
      go.onclick = async () => {
        const list = chosen().filter((u) => !taken(u));
        if (!list.length) return;
        go.disabled = true;
        go.classList.add('is-busy');
        try {
          const specs = await spec.build(list, { mode: pick.mode, sourceId: pick.sourceId, sourceName: pick.sourceName, quality: pick.route?.quality ?? null });
          // سيرفر اختاره المستخدم: يُلتزم به (المصدر والرمز)، لا بديل صامت
          // البصمة هوية الإصدار نفسه (التورنت بـinfoHash): الرمز يتغيّر بين الجلسات فلا يثبّت الاختيار
          if (pick.route) {
            const { routeIdentity } = await import('../lib/downloads/video-driver.js');
            for (const sp of specs) sp.source = { ...sp.source, mode: 'manual', sourceId: pick.route.sourceId, sourceName: pick.sourceName, server: pick.route.server, routeCode: pick.route.code ?? null, fingerprint: routeIdentity(pick.route), label: pick.route.label ?? null, quality: pick.route.quality ?? null };
          }
          const { added } = await c.manager.enqueue(specs);
          void saveWorkArt(c.store, spec.work, { local: localArt(spec.work) });
          if (spec.snapshot) {
            try { await c.store.putArt(`${spec.work.ref}|detail`, { json: JSON.stringify(spec.snapshot, (k, v) => (k === '_chapters' || k === '_editions' || k === '_sources' || k === '_failedSources' ? undefined : v)), at: Date.now() }); } catch { /* الصفحة تُبنى من الأساسيات */ }
          }
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

  /** رجوع إلى الصفحة بلا open (زر الرجوع): الاشتراك والرسم من الحالة الحالية. */
  function resume() {
    if (!ctx) return;
    subscribe();
    render({ keepScroll: true });
  }

  return {
    open,
    leave,
    resume,
    openWork,
    manage,
    openDownloadSheet,
    openSettings,
    isActive: (id) => ACTIVE_STATES.has(ctx?.manager.get(id)?.state),
    /** كم عنصرًا من هذا العمل على الجهاز (0 قبل أن يُقرأ البيان). */
    count: (ref) => (ctx ? ctx.manager.list().filter((i) => i.work.ref === ref && i.state === STATES.ready).length : 0),
    supports: (kind) => (ctx ? (kind === 'manga' ? ctx.caps.manga : ctx.caps.video) : null),
  };
}
