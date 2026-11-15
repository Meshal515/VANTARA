/**
 * المكتبة الموحدة: تصميم رابع مستقل يظهر مع «توحيد المحتوى» بدل مكتبات الأقسام الثلاث.
 * البيانات من library-model.js (الجداول المشتركة نفسها) فكل تغيير يظهر في الوضعين فورًا، والرجوع
 * عن التوحيد يعيد المكتبات الثلاث كما هي بلا ترحيل.
 *
 * الشكل: بلا حاويات. فلتر النوع نصًّا، ثم تبويبات المكتبة بعدّادها، ثم «آخر المشاهدات» أغلفةً كبيرة
 * بتقدّم كل نوع بلغته (الفصل/الحلقة/الموسم)، ثم شبكة أغلفة 2:3 بمقاس محجوز (لا إزاحة تخطيط).
 * لا ألوان للأنواع: النوع كلمة هادئة فوق العنوان.
 */

import { EMPTY_COPY, LIBRARY_FILTERS, LIBRARY_TABS, shelfCounts } from './library-model.js';

const KIND_WORD = Object.freeze({ manga: 'مانجا', anime: 'أنمي', cinema: 'سينما' });

/** التقدّم بلغة النوع، من صف «آخر المشاهدات» وحده (لا سجل يُخترع). */
export function progressLabel(item) {
  const v = item?.view;
  if (!v) return '';
  const label = String(v.chapter_label ?? '').trim();
  const n = v.chapter_number;
  if (item.section === 'manga') {
    if (/^\d+(\.\d+)?$/.test(label)) return `الفصل ${label}`;
    return label || (n != null ? `الفصل ${n}` : '');
  }
  return label || (n != null ? `الحلقة ${n}` : '');
}

/** «قبل ساعة» بلا ثوانٍ ولا تواريخ طويلة. */
export function agoShort(at, now = Date.now()) {
  if (!at) return '';
  const m = Math.max(0, Math.round((now - at) / 60000));
  if (m < 60) return m <= 1 ? 'الآن' : `قبل ${m} د`;
  const h = Math.round(m / 60);
  if (h < 24) return `قبل ${h} س`;
  const d = Math.round(h / 24);
  return d === 1 ? 'أمس' : d < 30 ? `قبل ${d} يوم` : new Date(at).toLocaleDateString('ar', { day: 'numeric', month: 'short', numberingSystem: 'latn' });
}

/**
 * @param {{ el: Function, glyph: Function, shelves: () => ReturnType<import('./library-model.js').libraryShelves>,
 *   open: (item: object) => void, discover: () => void, storage?: Storage, now?: () => number }} ctx
 */
export function createUnifiedLibrary({ el, glyph, shelves, open, discover, coverInto = null, itemMenu = null, storage = globalThis.localStorage, now = () => Date.now() }) {
  const KEY = 'vantara.unified.library.v1';
  const read = () => { try { return JSON.parse(storage?.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } };
  const saved = read();
  const st = {
    filter: LIBRARY_FILTERS.some(([k]) => k === saved.filter) ? saved.filter : 'all',
    tab: LIBRARY_TABS.some((t) => t.id === saved.tab) ? saved.tab : 'all',
  };
  const save = () => { try { storage?.setItem(KEY, JSON.stringify(st)); } catch { /* تخزين محجوب */ } };

  const cover = (item, cls) => {
    const box = el('span', cls);
    // المانجا بمحمّل صور القشرة (ترويسات المصدر والبدائل والغلاف الموحّد): <img> مجرد كان يبقى فارغًا لبعضها
    if (item.section === 'manga' && coverInto) {
      const holder = el('span', 'ul-imgbox');
      box.append(holder);
      if (coverInto(holder, item)) return box;
      holder.remove();
    }
    if (item.cover) {
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.src = item.cover;
      // الصورة تظهر مرة واحدة حين تكتمل، فوق هيكل بمقاسها نفسه
      img.onload = () => img.classList.add('in');
      if (img.complete && img.naturalWidth) img.classList.add('in');
      box.append(img);
    }
    return box;
  };
  const title = (item, cls = 'ul-title') => {
    const t = el('bdi', cls, item.title || 'عمل');
    t.dir = 'auto';
    return t;
  };

  /** لمسة تفتح العمل، والضغط المطوّل يفتح خياراته (أضف لمكتبتي، أزل من آخر المشاهدات). */
  function hold(node, item) {
    let timer = 0, held = false, x = 0, y = 0;
    const cancel = () => { clearTimeout(timer); timer = 0; };
    node.addEventListener('pointerdown', (e) => {
      held = false; x = e.clientX; y = e.clientY; cancel();
      if (itemMenu) timer = setTimeout(() => { timer = 0; held = true; itemMenu(item); }, 480);
    });
    node.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 8) cancel(); });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(t, cancel);
    node.addEventListener('contextmenu', (e) => { if (itemMenu) e.preventDefault(); });
    node.onclick = (e) => { if (held) { held = false; e.preventDefault(); return; } open(item); };
    return node;
  }

  /** بطاقة «آخر المشاهدات»: غلاف كبير، وتحته النوع والتقدّم، ثم العنوان ومتى. */
  function recentCard(item) {
    const b = hold(el('button', 'ul-recent'), item);
    b.type = 'button';
    const art = cover(item, 'ul-recent-art');
    const go = el('span', 'ul-recent-go');
    go.innerHTML = glyph(item.section === 'manga' ? 'book' : 'play', { size: 15, filled: item.section !== 'manga' });
    art.append(go);
    const line = el('span', 'ul-eyebrow');
    const p = progressLabel(item);
    line.append(el('span', null, KIND_WORD[item.section]));
    if (p) { line.append(el('i')); const s = el('bdi', null, p); line.append(s); }
    b.append(art, line, title(item), el('span', 'ul-when', agoShort(item.view?.viewed_at ?? item.at, now())));
    b.setAttribute('aria-label', `${item.title ?? ''}، ${KIND_WORD[item.section]}${p ? `، ${p}` : ''}`);
    return b;
  }

  /** بطاقة الشبكة: غلاف 2:3 وعنوان سطر، والنوع (والتقدّم إن وُجد) تحته. */
  function gridCard(item) {
    const b = hold(el('button', 'ul-card'), item);
    b.type = 'button';
    const sub = el('span', 'ul-sub');
    const p = progressLabel(item);
    sub.append(el('span', null, KIND_WORD[item.section]));
    if (p) { sub.append(el('i')); sub.append(el('bdi', null, p)); }
    b.append(cover(item, 'ul-art'), title(item), sub);
    return b;
  }

  function empty(tab) {
    const [h, p] = EMPTY_COPY[tab] ?? EMPTY_COPY.all;
    const box = el('div', 'ul-empty');
    const t = el('strong', null, h);
    box.append(t, el('p', null, p));
    if (tab === 'all' || tab === 'following') {
      const cta = el('button', 'ul-cta');
      cta.type = 'button';
      cta.innerHTML = `${glyph('compass', { size: 18 })}<span>اكتشف أعمالًا</span>`;
      cta.onclick = discover;
      box.append(cta);
    }
    return box;
  }

  function render(host) {
    if (!host) return;
    const y = host.ownerDocument?.defaultView?.scrollY ?? 0;
    const pass = (it) => st.filter === 'all' || it.section === st.filter;
    const raw = shelves();
    const data = Object.fromEntries(Object.entries(raw).map(([k, list]) => [k, list.filter(pass)]));
    const counts = shelfCounts(data);
    const page = el('div', 'ul');

    // فلتر النوع: بنمط الرئيسية الموحدة نفسه (نص وخط تحت المختار)
    const types = el('nav', 'uv-tabs ul-types');
    types.setAttribute('role', 'tablist');
    types.setAttribute('aria-label', 'نوع الأعمال');
    for (const [k, l] of LIBRARY_FILTERS) {
      const b = el('button', st.filter === k ? 'on' : '', l);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(st.filter === k));
      b.onclick = () => { st.filter = k; save(); render(host); };
      types.append(b);
    }
    page.append(types);

    // تبويبات المكتبة: الاسم وعدده كما يُعرض حرفيًا
    const tabs = el('div', 'ul-shelves');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'مكتبتي');
    for (const t of LIBRARY_TABS) {
      const b = el('button', `ul-shelf${st.tab === t.id ? ' on' : ''}`);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(st.tab === t.id));
      b.append(el('span', null, t.label));
      if (counts[t.id]) b.append(el('sup', null, String(counts[t.id])));
      b.onclick = () => { st.tab = t.id; save(); render(host); };
      tabs.append(b);
    }
    page.append(tabs);

    const list = data[st.tab] ?? [];
    if (st.tab === 'all' && data.recent.length) {
      // «آخر المشاهدات» مرة واحدة في رأس «الكل» (صف واحد لا يتكرر في الشبكة تحته)
      const sec = el('section', 'ul-sec');
      const head = el('div', 'ul-head');
      head.append(el('h2', null, 'آخر المشاهدات'));
      const more = el('button', 'ul-more');
      more.type = 'button';
      more.innerHTML = `<span>عرض الكل</span>${glyph('chevron', { size: 16 })}`;
      more.onclick = () => { st.tab = 'recent'; save(); render(host); };
      head.append(more);
      // معاينة من أربعة أغلفة بعرض ربع السطر: أصغر من شبكة الأعمال تحتها فلا تطغى عليها (كانت شريطًا بعرض 136px)
      const peek = el('div', 'ul-peek');
      peek.append(...data.recent.slice(0, 4).map(recentCard));
      sec.append(head, peek);
      page.append(sec);
    }
    if (st.tab === 'recent') {
      if (!list.length) page.append(empty('recent'));
      else {
        const grid = el('div', 'ul-recent-grid');
        grid.append(...list.map(recentCard));
        page.append(grid);
      }
    } else if (!list.length) {
      page.append(empty(st.tab));
    } else {
      const sec = el('section', 'ul-sec');
      if (st.tab === 'all' && data.recent.length) {
        const head = el('div', 'ul-head');
        head.append(el('h2', null, 'كل أعمالك'));
        sec.append(head);
      }
      const grid = el('div', 'ul-grid');
      grid.append(...list.map(gridCard));
      sec.append(grid);
      page.append(sec);
    }
    // Keep the stable page host connected across type/shelf changes. The shared
    // bindTabMotion controller resolves the new children on the next frame;
    // replacing the whole .ul element disconnected its captured host.
    const previous = host.querySelector(':scope > .ul');
    if (previous) previous.replaceChildren(...page.children);
    else host.replaceChildren(page);
    // إعادة الرسم (تحديث فوري من المزامنة) لا تقفز بالصفحة
    if (y) host.ownerDocument?.defaultView?.scrollTo({ top: y, behavior: 'instant' });
  }

  return { render, state: st };
}
