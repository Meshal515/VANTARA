/**
 * الملف الشخصي — لك ولأصدقائك.
 *
 * شخصيٌّ أولًا والأرقام ثانيًا: البانر الحريري بلون صورتك (أو صورة بانرك)،
 * الصورة فوقه، الاسم والحالة والنبذة. ثم سطرٌ هادئ بثلاثة أرقام، يُفتح
 * بلمسة على تعريفها ووقت القراءة. ثم «أفضل 5»، وما يقرؤه الآن، وسجلّ قراءته.
 *
 * الأرقام من الخادم (`/v1/stats`) وتعريفاتها منفصلة عمدًا:
 *   - الأعمال المتابعة: ما في مكتبته الآن (العدد وحده؛ المكتبة خاصة).
 *   - الفصول الفريدة: الفصل يُحسب أول مرة يُقرأ فيها كاملًا فقط.
 *   - القراءات: كل قراءة كاملة، والإعادة منها.
 * «كاملًا» = ٩٠٪ من الفصل ووقتٌ فعلي، والخادم يتحقق — فتح فصلٍ عشرين مرة
 * لا يزيد شيئًا.
 */

import { glyph, iconButton } from './icons.js';
import { countLabel } from './plural.js';
import { createSilk, silkPaletteForSrc } from '../lib/silk.js';
import { DEFAULT_SILK, hexToRgb01 } from '../lib/silk-palette.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => (Number(n) || 0).toLocaleString('en-US');

function duration(ms) {
  const minutes = Math.round((ms ?? 0) / 60_000);
  if (minutes < 1) return 'أقل من دقيقة';
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} س ${rest} د` : `${hours} ساعة`;
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
  let token = 0;

  let shown = null;
  /** ما حفظته للتوّ ولم تُرجعه المزامنة بعد: الملف يُظهره فورًا بدل القديم. */
  let local = null;
  const COLUMN = { displayName: 'display_name', bio: 'bio', avatarKey: 'avatar_key', bannerKey: 'banner_key' };
  const serverProfileOf = (userId) => sync.rows('profiles', (p) => p.user_id === userId)[0] ?? null;
  const profileOf = (userId) => {
    const row = serverProfileOf(userId);
    if (!local || userId !== me()) return row;
    const merged = { ...(row ?? { user_id: userId }) };
    for (const [key, value] of Object.entries(local)) merged[COLUMN[key]] = value;
    return merged;
  };
  const usernameOf = (userId) => sync.rows('accounts', (a) => a.user_id === userId)[0]?.username ?? '';
  const workOf = (ref) => {
    const row = sync.rows('works', (w) => w.series_ref === ref)[0];
    return ctx.workFromRef(ref, row?.title, row?.cover_url);
  };
  const titleOf = (w) => w?.title?.english || w?.title || '';
  const knownTitle = (w) => titleOf(w) && !String(titleOf(w)).startsWith('ext:');

  function presenceLine(p) {
    if (!p) return { text: 'غير متصل', live: false };
    if (p.status === 'READING' && p.seriesTitle) return { text: `يقرأ ${p.seriesTitle}${p.chapterLabel ? ` · ${p.chapterLabel}` : ''}`, live: true, reading: true };
    if (p.status === 'ONLINE') return { text: 'متصل الآن', live: true };
    if (p.status === 'IDLE') return { text: 'خامل', live: false };
    if (!p.lastSeenAt) return { text: 'غير متصل', live: false };
    const m = Math.floor((Date.now() - p.lastSeenAt) / 60_000);
    if (m < 60) return { text: `آخر ظهور قبل ${Math.max(1, m)} دقيقة`, live: false };
    const h = Math.floor(m / 60);
    if (h < 24) return { text: `آخر ظهور قبل ${h} ساعة`, live: false };
    return { text: `آخر ظهور قبل ${countLabel(Math.floor(h / 24), 'day')}`, live: false };
  }

  /** سجلّ القراءة: عملٌ لكل صف، بآخر فصل قُرئ منه. */
  function readingLog(userId) {
    const byWork = new Map();
    for (const r of sync.rows('chapter_reads', (x) => x.user_id === userId && x.read_count > 0)) {
      const cur = byWork.get(r.series_ref);
      if (!cur || r.last_read_at > cur.at) {
        byWork.set(r.series_ref, { ref: r.series_ref, at: r.last_read_at, chapter: r.chapter_number, count: (cur?.count ?? 0) + 1 });
      } else cur.count += 1;
    }
    return [...byWork.values()].sort((a, b) => b.at - a.at);
  }

  function stat(value, label) {
    const d = el('div', 'pf-stat');
    d.append(el('strong', null, value), el('span', null, label));
    return d;
  }

  function openStatsSheet(stats, name, own) {
    ctx.openSheet((body) => {
      body.append(el('h3', null, own ? 'قراءتك بالأرقام' : `قراءة ${name} بالأرقام`));
      const rows = [
        ['library', 'الأعمال المتابعة', fmt(stats.followedWorks), 'ما في المكتبة الآن.'],
        ['book', 'الفصول الفريدة', fmt(stats.uniqueChapters), 'كل فصل يُحسب مرة واحدة، أول ما يُقرأ كاملًا.'],
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
      const note = el('p', null, 'القراءة الكاملة = ٩٠٪ من الفصل مع وقت قراءة فعلي. فتح الفصل وحده لا يُحسب.');
      note.style.marginTop = '12px';
      body.append(note);
    });
  }

  function mediaCard(work, rank) {
    const a = el('button', 'pf-card');
    a.type = 'button';
    const frame = el('span', 'pf-card-frame');
    const c = el('span', 'poster');
    void ctx.mountImage(c, work);
    frame.append(c);
    // الرقم خارج الغلاف: تحميل الصورة يستبدل ما داخله
    if (rank) frame.append(el('span', 'pf-rank', String(rank)));
    const t = el('bdi', 'work-title', titleOf(work));
    a.append(frame, t);
    a.onclick = () => ctx.openWork(work);
    return a;
  }

  function section(title, content, { meta, action } = {}) {
    const s = el('section', 'pf-section');
    const h = el('div', 'section-head');
    h.append(el('h2', null, title));
    if (action) h.append(action);
    else if (meta) h.append(el('span', 'pf-meta', meta));
    s.append(h, content);
    return s;
  }

  async function paintBanner(banner, profile, avatarSrc) {
    silk?.destroy();
    silk = null;
    banner.replaceChildren();
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
      const palette = avatarSrc ? await silkPaletteForSrc(avatarSrc) : null;
      if (palette) silk?.setPalette(palette);
    }
    banner.append(el('div', 'pf-shade'));
  }

  async function show(userId) {
    const my = ++token;
    shown = userId;
    const own = userId === me();
    const profile = profileOf(userId);
    const name = profile?.display_name || usernameOf(userId) || 'صديق';
    host.replaceChildren();

    const top = el('div', 'pf-top');
    top.innerHTML = iconButton('back', 'رجوع', { act: 'profileBack', cls: 'icon-btn pf-glass' });
    if (own) top.insertAdjacentHTML('beforeend', iconButton('edit', 'عدّل ملفك', { act: 'profileEdit', cls: 'icon-btn pf-glass' }));
    top.querySelector('[data-act="profileBack"]').onclick = ctx.back;
    top.querySelector('[data-act="profileEdit"]')?.addEventListener('click', ctx.edit);

    const banner = el('div', 'pf-banner');
    const id = el('section', 'pf-id');
    const face = el('div', 'pf-face');
    face.append(ctx.avatarNode({ displayName: name, avatarKey: profile?.avatar_key }, 96));
    const dot = el('span', 'pf-dot');
    face.append(dot);
    const nameEl = el('h1', 'pf-name', name);
    nameEl.dir = 'auto';
    const handle = el('div', 'pf-handle', usernameOf(userId) ? `@${usernameOf(userId)}` : '');
    const live = el('div', 'pf-live');
    const bio = el('p', `pf-bio${profile?.bio ? '' : ' pf-bio--empty'}`, profile?.bio || (own ? 'اكتب نبذة قصيرة عنك' : ''));
    bio.dir = 'auto';
    if (!profile?.bio && own) bio.onclick = ctx.edit;
    const stats = el('button', 'pf-stats');
    stats.type = 'button';
    stats.setAttribute('aria-label', 'تفاصيل القراءة');
    stats.append(stat('—', 'أعمال'), el('i'), stat('—', 'فصول فريدة'), el('i'), stat('—', 'قراءة'));
    id.append(face, nameEl, handle, live);
    if (profile?.bio || own) id.append(bio);
    id.append(stats);
    host.append(top, banner, id);

    void paintBanner(banner, profile, profile?.avatar_key);

    // ما يُعرض فورًا من المرآة؛ الحضور والأرقام وأفضل 5 تصل بعدها
    const body = el('div', 'pf-body');
    host.append(body);
    const topHost = el('div', 'card-strip pf-strip');
    topHost.append(...Array.from({ length: 5 }, () => el('div', 'work-card pf-skel')));
    body.append(section('أفضل 5', topHost, { meta: own ? null : `اختيارات ${name}` }));
    const nowHost = el('div');
    body.append(nowHost);

    const log = readingLog(userId);
    if (log.length) {
      const list = el('div', 'pf-log');
      for (const item of log.slice(0, 6)) {
        const work = workOf(item.ref);
        const row = el('button', 'pf-log-row');
        row.type = 'button';
        const cover = el('span', 'pf-log-cover');
        void ctx.mountImage(cover, work);
        const copy = el('span', 'pf-log-copy');
        copy.append(el('bdi', 'pf-log-title', knownTitle(work) ? titleOf(work) : 'عمل'));
        const when = new Date(item.at).toLocaleDateString('ar', { day: 'numeric', month: 'short', numberingSystem: 'latn' });
        copy.append(el('span', 'pf-log-meta', [item.chapter != null ? `آخر فصل ${item.chapter}` : null, countLabel(item.count, 'chapter'), when].filter(Boolean).join(' · ')));
        row.append(cover, copy);
        row.insertAdjacentHTML('beforeend', glyph('chevron', { cls: 'icon pf-chev' }));
        row.onclick = () => ctx.openWork(work);
        list.append(row);
      }
      body.append(section(own ? 'سجلّ قراءتك' : 'سجلّ القراءة', list, { meta: countLabel(log.length, 'work') }));
    }
    if (own) {
      const later = ctx.libraryWorks('later');
      if (later.length) {
        const strip = el('div', 'card-strip pf-strip');
        strip.append(...later.slice(0, 12).map((w) => mediaCard(w)));
        body.append(section('أقرأ لاحقًا', strip, { meta: countLabel(later.length, 'work') }));
      }
    }

    const [presence, numbers, top5] = await Promise.all([
      ctx.presence().catch(() => []),
      sync.stats(userId),
      sync.topWorks(userId),
    ]);
    if (my !== token) return;

    const p = (presence ?? []).find((x) => x.userId === userId) ?? (own ? { status: 'ONLINE' } : null);
    const line = presenceLine(p);
    live.textContent = line.text;
    live.classList.toggle('pf-live--on', line.live);
    live.classList.toggle('pf-live--reading', Boolean(line.reading));
    dot.className = `pf-dot pf-dot--${String(p?.status ?? 'offline').toLowerCase()}`;

    if (numbers) {
      stats.replaceChildren(
        stat(fmt(numbers.followedWorks), 'أعمال'),
        el('i'),
        stat(fmt(numbers.uniqueChapters), 'فصول فريدة'),
        el('i'),
        stat(fmt(numbers.totalReads), 'قراءة'),
      );
      stats.onclick = () => openStatsSheet(numbers, name, own);
    } else {
      stats.hidden = true;
    }

    if (top5.length) {
      topHost.replaceChildren(
        ...top5.slice(0, 5).map((t, i) => mediaCard(ctx.workFromRef(t.seriesRef, t.title, t.coverUrl), i + 1)),
      );
    } else {
      const empty = el('p', 'pf-empty', own ? 'اختر أفضل خمسة أعمال عندك من قائمة ⋮ في صفحة أي عمل.' : `${name} ما اختار أفضل 5 بعد.`);
      topHost.replaceWith(empty);
    }

    if (line.reading && p.seriesTitle) {
      const work = workOf(p.seriesRef ?? `ext:${p.seriesTitle.toLowerCase()}`);
      if (!knownTitle(work)) work.title = { english: p.seriesTitle };
      const card = el('button', 'mj-now pf-now');
      card.type = 'button';
      const cover = el('span', 'mj-now-cover');
      void ctx.mountImage(cover, work);
      const copy = el('span', 'mj-now-copy');
      copy.append(el('span', 'mj-now-who', own ? 'تقرأ الآن' : 'يقرأ الآن'), el('bdi', 'mj-now-title', p.seriesTitle));
      if (p.chapterLabel) copy.append(el('span', 'mj-now-chapter', p.chapterLabel));
      card.append(cover, copy, el('span', 'mj-live'));
      card.onclick = () => ctx.openWork(work);
      nowHost.replaceWith(section(own ? 'الآن' : 'يقرأ الآن', card));
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
        avatarKey: p?.avatar_key ?? null,
        bannerKey: p?.banner_key ?? null,
      };
    },
    applyLocal(fields) {
      local = { ...(local ?? {}), ...fields };
      if (shown === me()) void show(me());
    },
    onChange(tables) {
      if (!tables.includes('profiles')) return;
      // تُمسح النسخة المحلية حين يطابقها الخادم، لا قبلها: سحبٌ سبق الإرسال لا يُرجع القديم
      if (local) {
        const row = serverProfileOf(me());
        if (row && Object.entries(local).every(([k, v]) => (row[COLUMN[k]] ?? null) === (v ?? null))) local = null;
      }
      if (shown && !host.closest('[hidden]')) void show(shown);
    },
    hide() {
      token += 1;
      silk?.destroy();
      silk = null;
    },
  };
}
