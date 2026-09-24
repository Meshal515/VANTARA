/**
 * الملف الشخصي — لك ولأصدقائك.
 *
 * صفحة شخص لا لوحة أرقام. البانر الحريري يأخذ ألوانه من صورتك (ويتبعها
 * إطارًا بإطار إن كانت متحركة)، والصورة تجلس على حافته بحلقة من نفس اللون.
 * ثم الاسم والحالة والنبذة، وما يقرؤه الآن إن كان يقرأ، ثم الأرقام الثلاثة
 * في بطاقة واحدة تُفتح بلمسة على تعريفها.
 *
 * «أفضل 5» تُعرض كاملة بلا تمرير: الأول بطاقة كبيرة وحده، والأربعة بعده
 * صفٌّ واحد. ثم سجلّ القراءة، و«أقرأ لاحقًا» لصاحب الملف وحده.
 *
 * الأرقام من الخادم (`/v1/stats`) وتعريفاتها منفصلة عمدًا:
 *   - الأعمال المتابعة: ما في مكتبته الآن (العدد وحده؛ المكتبة خاصة).
 *   - الفصول الفريدة: الفصل يُحسب أول مرة يُقرأ فيها كاملًا فقط.
 *   - القراءات: كل قراءة كاملة، والإعادة منها.
 * «مقروء» = خُمس الفصل ووقتٌ فعلي، والخادم يتحقق — فتح فصلٍ عشرين مرة
 * لا يزيد شيئًا.
 */

import { glyph, iconButton } from './icons.js';
import { countLabel } from './plural.js';
import { createSilk, followImage, silkPaletteForSrc } from '../lib/silk.js';
import { DEFAULT_SILK, hexToRgb01, rgb01ToHex } from '../lib/silk-palette.js';
import { withIdentity } from '../lib/identity.js';
import { displayTitle, refForTitle } from './work-ref.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => (Number(n) || 0).toLocaleString('en-US');
const LOG_PREVIEW = 5;

function duration(ms) {
  const minutes = Math.round((ms ?? 0) / 60_000);
  if (minutes < 1) return 'أقل من دقيقة';
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} س ${rest} د` : `${hours} ساعة`;
}

/** «اليوم»، «أمس»، ثم التاريخ: السجل يُقرأ بالأيام لا بالساعات. */
function dayLabel(at) {
  const d = new Date(at);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (days <= 0) return 'اليوم';
  if (days === 1) return 'أمس';
  if (days < 7) return `قبل ${countLabel(days, 'day')}`;
  return d.toLocaleDateString('ar', { day: 'numeric', month: 'short', numberingSystem: 'latn' });
}

/** صورة تُقرأ بكسلاتها بلا أن تختفي: أصلنا وخادم الوسائط يرسلان CORS، وغيرهما لا يُضمن. */
function readable(src) {
  try {
    const u = new URL(src, location.href);
    return u.origin === location.origin || u.pathname.startsWith('/v1/media/');
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   sync: any,
 *   host: HTMLElement,
 *   presence: () => Promise<any[]>,
 *   avatarNode: (person: object, size: number) => HTMLElement,
 *   mountImage: (c: HTMLElement, work: object) => Promise<unknown>,
 *   workFromRef: (ref: string, title?: string, cover?: string) => object,
 *   openWork: (work: object) => void,
 *   openSheet: (build: (body: HTMLElement) => void) => void,
 *   back: () => void,
 *   edit: () => void,
 *   libraryWorks: (filter: string) => object[],
 * }} ctx
 */
export function createProfile(ctx) {
  const { sync, host } = ctx;
  const me = () => sync.user?.userId;
  let silk = null;
  let stopFollow = null;
  let token = 0;
  let shelfTimer = null;
  let shownShelves = '';
  const shelfSig = (userId) =>
    JSON.stringify([
      sync.rows('library', (r) => r.user_id === userId && !r.removed).map((r) => r.series_ref).sort(),
      sync.rows('collections', (r) => r.user_id === userId && r.member).map((r) => `${r.kind}/${r.series_ref}`).sort(),
      sync.rows('completions', (r) => r.user_id === userId && r.member).map((r) => r.series_ref).sort(),
      sync
        .rows('work_views', (r) => r.user_id === userId && !r.removed)
        .sort((a, b) => b.viewed_at - a.viewed_at)
        .slice(0, 8)
        .map((r) => `${r.series_ref}/${r.chapter_number}`),
    ]);

  let shown = null;
  let shownSig = '';
  const signature = (userId) => {
    const p = profileOf(userId);
    return JSON.stringify([p?.display_name, p?.bio, p?.avatar_key, p?.banner_key]);
  };
  /** ما حفظته للتوّ ولم تُرجعه المزامنة بعد: الملف يُظهره فورًا بدل القديم. */
  let local = null;
  const COLUMN = { displayName: 'display_name', bio: 'bio', avatarKey: 'avatar_key', bannerKey: 'banner_key' };
  const serverProfileOf = (userId) => sync.rows('profiles', (p) => p.user_id === userId)[0] ?? null;
  const usernameOf = (userId) => sync.rows('accounts', (a) => a.user_id === userId)[0]?.username ?? '';
  const profileOf = (userId) => {
    const row = serverProfileOf(userId);
    if (!local || userId !== me()) return row;
    // المحلي فوق الأصل ثم الهوية الأساسية من جديد: حذف صورتك يُرجع صورتك الأساسية
    const merged = { ...(row ?? { user_id: userId }) };
    if (merged.default_avatar) merged.avatar_key = null;
    delete merged.default_avatar;
    for (const [key, value] of Object.entries(local)) merged[COLUMN[key]] = value;
    return withIdentity(merged, usernameOf(userId));
  };
  const workOf = (ref, title) => {
    const row =
      sync.rows('works', (w) => w.series_ref === ref)[0] ??
      (title ? sync.rows('works', (w) => String(w.title).toLowerCase() === String(title).toLowerCase())[0] : null);
    return ctx.workFromRef(row?.series_ref ?? ref, row?.title ?? title, row?.cover_url);
  };
  const titleOf = (w) => (w ? displayTitle(w.id, w.title?.english, typeof w.title === 'string' ? w.title : null) : '');
  const knownTitle = (w) => Boolean(titleOf(w));

  function presenceLine(p) {
    if (!p) return { text: 'غير متصل', tone: 'off' };
    // «يقرأ الآن» تقولها بطاقة القراءة تحت، بعنوانها وفصلها
    if (p.status === 'READING') return { text: 'متصل الآن', tone: 'on' };
    if (p.status === 'ONLINE') return { text: 'متصل الآن', tone: 'on' };
    if (p.status === 'IDLE') return { text: 'خامل', tone: 'idle' };
    if (!p.lastSeenAt) return { text: 'غير متصل', tone: 'off' };
    const m = Math.floor((Date.now() - p.lastSeenAt) / 60_000);
    if (m < 60) return { text: `آخر ظهور قبل ${Math.max(1, m)} دقيقة`, tone: 'off' };
    const h = Math.floor(m / 60);
    if (h < 24) return { text: `آخر ظهور قبل ${h} ساعة`, tone: 'off' };
    return { text: `آخر ظهور قبل ${countLabel(Math.floor(h / 24), 'day')}`, tone: 'off' };
  }

  /** سجلّ القراءة: عملٌ لكل صف، بآخر فصل قُرئ منه. */
  function readingLog(userId) {
    const byWork = new Map();
    for (const r of sync.rows('chapter_reads', (x) => x.user_id === userId && x.read_count > 0)) {
      const cur = byWork.get(r.series_ref);
      if (!cur) byWork.set(r.series_ref, { ref: r.series_ref, at: r.last_read_at, chapter: r.chapter_number, count: 1 });
      else {
        cur.count += 1;
        if (r.last_read_at > cur.at) {
          cur.at = r.last_read_at;
          cur.chapter = r.chapter_number;
        }
      }
    }
    return [...byWork.values()].sort((a, b) => b.at - a.at);
  }

  function openStatsSheet(stats, name, own) {
    ctx.openSheet((body) => {
      body.append(el('h3', null, own ? 'قراءتك بالأرقام' : `قراءة ${name} بالأرقام`));
      const rows = [
        ['library', 'الأعمال المتابعة', fmt(stats.followedWorks), 'ما في المكتبة الآن.'],
        ['book', 'الفصول الفريدة', fmt(stats.uniqueChapters), 'كل فصل يُحسب مرة واحدة، أول ما تقرؤه.'],
        ['refresh', 'إجمالي القراءات', fmt(stats.totalReads), `منها ${fmt(stats.rereads)} إعادة قراءة.`],
        ['clock', 'وقت القراءة اليوم', duration(stats.usage?.todayMs), null],
        ['history', 'هذا الأسبوع', duration(stats.usage?.weekMs), null],
        ['activity', 'منذ البداية', duration(stats.usage?.totalMs), null],
      ];
      const list = el('div', 'settings-list');
      list.style.marginTop = '12px';
      for (const [icon, label, value, hint] of rows) {
        const r = el('div', 'setting');
        r.innerHTML = glyph(icon);
        const t = el('div');
        t.append(el('strong', null, label));
        if (hint) t.append(el('small', null, hint));
        r.append(t, el('span', 'value pf-stat-value', value));
        list.append(r);
      }
      body.append(list);
      const note = el('p', null, 'الفصل يُحسب مقروءًا حين تقرأ خُمسه مع وقت قراءة فعلي. فتح الفصل وحده لا يُحسب.');
      note.style.marginTop = '12px';
      body.append(note);
    });
  }

  function section(title, content, { meta } = {}) {
    const s = el('section', 'pf-section');
    const h = el('div', 'section-head');
    h.append(el('h2', null, title));
    if (meta) h.append(el('span', 'pf-meta', meta));
    s.append(h, content);
    return s;
  }

  // ───────────────────────── الرأس ─────────────────────────

  /** اللون الشخصي: أفتح طبقة في الحرير. يلوّن حلقة الصورة ولمعة الرأس لا غير. */
  function tint(palette) {
    if (palette?.[3]) host.style.setProperty('--pf-tint', rgb01ToHex(palette[3]));
    if (palette?.[2]) host.style.setProperty('--pf-tint-deep', rgb01ToHex(palette[2]));
  }

  function avatar(profile, name) {
    const face = el('div', 'pf-face');
    const src = profile?.avatar_key;
    if (src) {
      const img = el('img', 'pf-face-img');
      img.alt = '';
      img.decoding = 'async';
      if (readable(src)) img.crossOrigin = 'anonymous';
      img.onerror = () => img.replaceWith(el('span', 'pf-face-img pf-initial', [...name][0] ?? '؟'));
      img.src = src;
      face.append(img);
    } else {
      face.append(el('span', 'pf-face-img pf-initial', [...name][0] ?? '؟'));
    }
    return face;
  }

  async function paintBanner(banner, profile, faceImg) {
    stopFollow?.();
    stopFollow = null;
    silk?.destroy();
    silk = null;
    banner.replaceChildren();
    const avatarSrc = profile?.avatar_key;
    if (profile?.banner_key) {
      const img = el('img', 'pf-banner-img');
      img.alt = '';
      img.src = profile.banner_key;
      img.onerror = () => img.remove();
      banner.append(img);
    } else {
      const canvas = el('canvas', 'pf-silk');
      banner.append(canvas);
      silk = createSilk(canvas, DEFAULT_SILK.map(hexToRgb01));
    }
    banner.append(el('div', 'pf-shade'));
    const palette = avatarSrc ? await silkPaletteForSrc(avatarSrc) : null;
    if (palette) {
      silk?.setPalette(palette);
      tint(palette);
    }
    // صورة متحركة: الحرير والحلقة يتبعانها إطارًا بإطار
    if (faceImg?.crossOrigin && faceImg.isConnected) {
      stopFollow = followImage(faceImg, (p) => {
        silk?.setPalette(p);
        tint(p);
      });
    }
  }

  function nowCard(p, own) {
    const work = workOf(p.seriesRef ?? refForTitle(p.seriesTitle) ?? 'ext:عمل', p.seriesTitle);
    const card = el('button', 'pf-now');
    card.type = 'button';
    const cover = el('span', 'pf-now-cover');
    void ctx.mountImage(cover, work);
    const copy = el('span', 'pf-now-copy');
    const label = el('span', 'pf-now-label');
    label.append(el('i', 'pf-pulse'), document.createTextNode(own ? 'تقرأ الآن' : 'يقرأ الآن'));
    copy.append(label, el('bdi', 'pf-now-title', p.seriesTitle));
    if (p.chapterLabel) copy.append(el('span', 'pf-now-chapter', p.chapterLabel));
    card.append(cover, copy);
    card.insertAdjacentHTML('beforeend', glyph('chevron', { cls: 'icon pf-chev' }));
    card.onclick = () => ctx.openWork(work);
    return card;
  }

  function statCell(value, label) {
    const d = el('span', 'pf-stat');
    d.append(el('strong', null, value), el('span', null, label));
    return d;
  }
  function statsCard(numbers) {
    const card = el('button', 'pf-stats');
    card.type = 'button';
    card.setAttribute('aria-label', 'تفاصيل القراءة');
    const v = (k) => (numbers ? fmt(numbers[k]) : '—');
    card.append(
      statCell(v('followedWorks'), 'أعمال متابَعة'),
      statCell(v('uniqueChapters'), 'فصول فريدة'),
      statCell(v('totalReads'), 'قراءات'),
    );
    card.classList.toggle('pf-stats--loading', !numbers);
    return card;
  }

  // ───────────────────────── أفضل 5 ─────────────────────────

  function poster(work, cls) {
    const c = el('span', `poster ${cls}`);
    void ctx.mountImage(c, work);
    return c;
  }
  function topFive(items, name, own) {
    const wrap = el('div', 'pf-top5');
    const [first, ...rest] = items;
    const lead = el('button', 'pf-first');
    lead.type = 'button';
    const frame = el('span', 'pf-first-frame');
    // نفس شارة الأربعة بعده، بالذهبي: الترتيب يُقرأ من الغلاف لا من دائرة بجانب العنوان
    frame.append(poster(first, 'pf-first-poster'), el('span', 'pf-rank pf-rank--gold', '1'));
    const copy = el('span', 'pf-first-copy');
    copy.append(el('bdi', 'pf-first-title', titleOf(first)), el('span', 'pf-first-meta', own ? 'الأول عندك' : `الأول عند ${name}`));
    lead.append(frame, copy);
    lead.onclick = () => ctx.openWork(first);
    wrap.append(lead);
    if (rest.length) {
      const grid = el('div', 'pf-rest');
      rest.forEach((w, i) => {
        const b = el('button', 'pf-card');
        b.type = 'button';
        const f = el('span', 'pf-card-frame');
        f.append(poster(w, ''), el('span', 'pf-rank', String(i + 2)));
        b.append(f, el('bdi', 'pf-card-title', titleOf(w)));
        b.onclick = () => ctx.openWork(w);
        grid.append(b);
      });
      wrap.append(grid);
    }
    return wrap;
  }
  /**
   * أفضل 5 في ملفك أنت: الخانات الخمس كما هي (الفارغة تقول كيف تُملأ)، وعلى
   * كل عمل زرّ إزالة ظاهر. التغيير يظهر حالًا ومن نفس الصفوف التي تقرؤها
   * صفحة العمل.
   */
  function ownTopFive(slots) {
    const wrap = el('div', 'pf-top5 pf-top5--own');
    const grid = el('div', 'pf-slots');
    slots.forEach((w, i) => {
      const cell = el('div', `pf-slot${w ? '' : ' pf-slot--empty'}`);
      const frame = el('span', 'pf-card-frame');
      if (w) frame.append(poster(w, ''));
      frame.append(el('span', `pf-rank${i === 0 ? ' pf-rank--gold' : ''}`, String(i + 1)));
      if (w) {
        const open = el('button', 'pf-slot-open');
        open.type = 'button';
        open.append(frame, el('bdi', 'pf-card-title', titleOf(w)));
        open.onclick = () => ctx.openWork(w);
        const remove = el('button', 'pf-slot-remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', `أزل ${titleOf(w)} من أفضل 5`);
        remove.innerHTML = glyph('close', { size: 14 });
        remove.onclick = (e) => {
          e.stopPropagation();
          ctx.removeFromTop(String(w.id));
          cell.classList.add('pf-slot--gone');
        };
        cell.append(open, remove);
      } else {
        frame.append(el('span', 'pf-slot-plus', '+'));
        cell.append(frame, el('span', 'pf-card-title pf-slot-hint', 'فارغة'));
        cell.onclick = () => ctx.toast?.('من صفحة أي عمل: ⋮ ← «أضف إلى أفضل 5» واختر الرقم');
      }
      grid.append(cell);
    });
    wrap.append(grid);
    return wrap;
  }
  function topSkeleton() {
    const wrap = el('div', 'pf-top5 pf-top5--loading');
    const lead = el('div', 'pf-first');
    lead.append(el('span', 'pf-first-frame pf-skel'));
    const grid = el('div', 'pf-rest');
    grid.append(...Array.from({ length: 4 }, () => el('span', 'pf-card-frame pf-skel')));
    wrap.append(lead, grid);
    return wrap;
  }

  // ───────────────────────── السجل ─────────────────────────

  function logList(log) {
    const list = el('div', 'pf-log');
    const row = (item) => {
      const work = workOf(item.ref);
      const r = el('button', 'pf-log-row');
      r.type = 'button';
      const cover = el('span', 'pf-log-cover');
      void ctx.mountImage(cover, work);
      const copy = el('span', 'pf-log-copy');
      copy.append(el('bdi', 'pf-log-title', knownTitle(work) ? titleOf(work) : 'عمل'));
      copy.append(el('span', 'pf-log-meta', [item.chapter != null ? `الفصل ${item.chapter}` : null, countLabel(item.count, 'chapter')].filter(Boolean).join(' · ')));
      r.append(cover, copy, el('span', 'pf-log-when', dayLabel(item.at)));
      r.onclick = () => ctx.openWork(work);
      return r;
    };
    list.append(...log.slice(0, LOG_PREVIEW).map(row));
    if (log.length > LOG_PREVIEW) {
      const more = el('button', 'pf-log-more');
      more.type = 'button';
      more.textContent = `اعرض السجل كامل · ${countLabel(log.length, 'work')}`;
      more.onclick = () => {
        more.remove();
        list.append(...log.slice(LOG_PREVIEW, 40).map(row));
      };
      list.append(more);
    }
    return list;
  }

  // ───────────────────────── الرفوف ─────────────────────────

  /**
   * رفٌّ من مكتبة صاحب الملف: «reading» مكتبته، والبقية قوائمه. الأحدث مشاهدةً
   * أولًا، ومع كل عمل آخر فصل فتحه.
   */
  function shelfOf(userId, kind) {
    const refs =
      kind === 'reading'
        ? sync.rows('library', (r) => r.user_id === userId && !r.removed).map((r) => r.series_ref)
        : kind === 'completed'
          ? sync.rows('completions', (r) => r.user_id === userId && r.member).map((r) => r.series_ref)
          : sync.rows('collections', (r) => r.user_id === userId && r.kind === kind && r.member).map((r) => r.series_ref);
    const viewAt = (ref) => sync.rows('work_views', (v) => v.user_id === userId && v.series_ref === ref)[0];
    return [...new Set(refs)]
      .map((ref) => ({ ref, view: viewAt(ref) }))
      .sort((a, b) => (b.view?.viewed_at ?? 0) - (a.view?.viewed_at ?? 0))
      .map(({ ref, view }) => ({ work: workOf(ref, view?.series_title), view }));
  }
  function strip(items, { chapters = false } = {}) {
    const row = el('div', 'card-strip pf-strip');
    for (const { work, view } of items.slice(0, 20)) {
      const b = el('button', 'pf-card');
      b.type = 'button';
      const f = el('span', 'pf-card-frame');
      f.append(poster(work, ''));
      b.append(f, el('bdi', 'pf-card-title', titleOf(work)));
      if (chapters && (view?.chapter_label || view?.chapter_number != null)) {
        b.append(el('span', 'pf-card-meta', view.chapter_label || `الفصل ${view.chapter_number}`));
      }
      b.onclick = () => ctx.openWork(work);
      row.append(b);
    }
    return row;
  }

  // ───────────────────────── الصفحة ─────────────────────────

  async function show(userId) {
    const my = ++token;
    shown = userId;
    shownSig = signature(userId);
    shownShelves = shelfSig(userId);
    const own = userId === me();
    const profile = profileOf(userId);
    const name = profile?.display_name || usernameOf(userId) || 'صديق';
    host.replaceChildren();
    host.style.removeProperty('--pf-tint');
    host.style.removeProperty('--pf-tint-deep');

    const top = el('div', 'pf-top');
    top.innerHTML = iconButton('back', 'رجوع', { act: 'profileBack', cls: 'icon-btn pf-glass' });
    top.querySelector('[data-act="profileBack"]').onclick = ctx.back;

    const banner = el('div', 'pf-banner');
    const id = el('section', 'pf-id');
    const row = el('div', 'pf-idrow');
    const face = avatar(profile, name);
    const dot = el('span', 'pf-dot');
    face.append(dot);
    row.append(face);
    if (own) {
      const edit = el('button', 'btn btn-secondary pf-edit');
      edit.type = 'button';
      edit.innerHTML = `${glyph('edit', { size: 18 })}<span>تعديل الملف</span>`;
      edit.onclick = ctx.edit;
      row.append(edit);
    }
    const nameEl = el('h1', 'pf-name', name);
    nameEl.dir = 'auto';
    const sub = el('div', 'pf-sub');
    const handle = usernameOf(userId);
    if (handle) {
      const h = el('span', 'pf-handle', `@${handle}`);
      sub.append(h);
    }
    const live = el('span', 'pf-live');
    sub.append(live);
    id.append(row, nameEl, sub);
    if (profile?.bio) {
      const bio = el('p', 'pf-bio', profile.bio);
      bio.dir = 'auto';
      id.append(bio);
    } else if (own) {
      const add = el('button', 'pf-bio-add');
      add.type = 'button';
      add.innerHTML = `${glyph('plus', { size: 16 })}<span>أضف نبذة قصيرة عنك</span>`;
      add.onclick = ctx.edit;
      id.append(add);
    }
    const nowHost = el('div', 'pf-now-host');
    let stats = statsCard(null);
    id.append(nowHost, stats);
    host.append(top, banner, id);

    void paintBanner(banner, profile, face.querySelector('img'));

    // ما يُعرض فورًا من المرآة؛ الحضور والأرقام وأفضل 5 تصل بعدها
    const body = el('div', 'pf-body');
    host.append(body);
    let topHost = topSkeleton();
    body.append(section('أفضل 5', topHost, { meta: own ? null : `اختيارات ${name}` }));

    // مكتبة صاحب الملف كما هي عنده: نفس الصفوف التي تقرؤها مكتبته وسجلّه، لا نسخة
    const shelf = (kind) => shelfOf(userId, kind);
    const reading = shelf('reading');
    if (reading.length) body.append(section('يقرأ الآن', strip(reading, { chapters: true }), { meta: countLabel(reading.length, 'work') }));
    const views = sync.rows('work_views', (r) => r.user_id === userId && !r.removed);
    if (views.length) {
      const hist = el('div');
      ctx.historyList(hist, { userId, own, limit: 5 });
      const sec = section('آخر المشاهدات', hist, { meta: countLabel(views.length, 'work') });
      if (views.length > 5) {
        const more = el('button', 'pf-log-more', own ? 'اعرض السجل كامل' : `اعرض كل مشاهدات ${name}`);
        more.type = 'button';
        more.onclick = () => (own ? ctx.openHistory() : (more.remove(), ctx.historyList(hist, { userId, own, limit: 60 })));
        sec.append(more);
      }
      body.append(sec);
    }
    const later = shelf('read_later');
    if (later.length) body.append(section('أقرأ لاحقًا', strip(later), { meta: countLabel(later.length, 'work') }));
    const done = shelf('completed');
    if (done.length) body.append(section('المكتمل', strip(done), { meta: countLabel(done.length, 'work') }));
    const log = readingLog(userId);
    if (log.length) body.append(section(own ? 'سجلّ قراءتك' : 'سجلّ القراءة', logList(log)));

    const [presence, numbers, top5] = await Promise.all([
      ctx.presence().catch(() => []),
      sync.stats(userId),
      sync.topWorks(userId),
    ]);
    if (my !== token) return;

    const p = (presence ?? []).find((x) => x.userId === userId) ?? (own ? { status: 'ONLINE' } : null);
    const line = presenceLine(p);
    live.textContent = line.text;
    live.className = `pf-live pf-live--${line.tone}`;
    dot.className = `pf-dot pf-dot--${String(p?.status ?? 'offline').toLowerCase()}`;
    if (p?.status === 'READING' && p.seriesTitle) nowHost.append(nowCard(p, own));

    if (numbers) {
      const next = statsCard(numbers);
      next.onclick = () => openStatsSheet(numbers, name, own);
      stats.replaceWith(next);
      stats = next;
    } else {
      stats.remove();
    }

    const items = top5.slice(0, 5).map((t) => ctx.workFromRef(t.seriesRef, t.title, t.coverUrl));
    if (own && ctx.topSlots) {
      // ملفك: من صفوفك أنت لا من الخادم، فالإزالة والتبديل يظهران حالًا
      const next = ownTopFive(ctx.topSlots());
      topHost.replaceWith(next);
      topHost = next;
    } else if (items.length) {
      const next = topFive(items, name, own);
      topHost.replaceWith(next);
      topHost = next;
    } else if (own) {
      const empty = el('div', 'pf-empty');
      empty.innerHTML = glyph('star', { size: 22 });
      empty.append(el('span', null, 'اختر أفضل خمسة أعمال عندك من قائمة ⋮ في صفحة أي عمل، وتطلع هنا لأصدقائك.'));
      topHost.replaceWith(empty);
    } else {
      topHost.closest('.pf-section')?.remove();
    }
  }

  return {
    show,
    /** نسخة الملف التي يبدأ منها المحرّر، بما لم يُزامَن بعد. */
    editable() {
      const p = profileOf(me());
      return {
        displayName: p?.display_name || usernameOf(me()) || '',
        bio: p?.bio ?? null,
        // الصورة الأساسية ليست «صورتك»: المحرّر يعرضها ولا يحذفها
        avatarKey: p?.default_avatar ? null : (p?.avatar_key ?? null),
        defaultAvatar: p?.default_avatar ? p.avatar_key : null,
        bannerKey: p?.banner_key ?? null,
      };
    },
    applyLocal(fields) {
      local = { ...(local ?? {}), ...fields };
      if (shown === me()) void show(me());
    },
    onChange(tables) {
      // رفوف ملفٍ مفتوح تتبع مكتبة صاحبه وسجلّه لحظة تتغير
      // (فقط حين تغيّرت رفوف صاحب الملف نفسه: قراءة صديقٍ آخر لا تعيد رسم ملفك)
      if (shown && !host.closest('[hidden]') && tables.some((t) => ['library', 'collections', 'completions', 'work_views'].includes(t)) && shelfSig(shown) !== shownShelves) {
        clearTimeout(shelfTimer);
        shelfTimer = setTimeout(() => shown && void show(shown), 400);
      }
      if (!tables.includes('profiles')) return;
      // تُمسح النسخة المحلية حين يطابقها الخادم، لا قبلها: سحبٌ سبق الإرسال لا يُرجع القديم
      if (local) {
        const row = serverProfileOf(me());
        const value = (k) => (k === 'avatarKey' && row?.default_avatar ? null : (row?.[COLUMN[k]] ?? null));
        if (row && Object.entries(local).every(([k, v]) => value(k) === (v ?? null))) local = null;
      }
      // يُعاد الرسم حين يتغيّر ما يُرى فقط: وصول ما حفظته للتوّ من الخادم لا
      // يعيد بناء الصفحة (ولا يعيد فكّ صورة متحركة من أولها)
      if (shown && !host.closest('[hidden]') && signature(shown) !== shownSig) void show(shown);
    },
    hide() {
      token += 1;
      stopFollow?.();
      stopFollow = null;
      silk?.destroy();
      silk = null;
    },
  };
}
