/**
 * المجلس — أصدقاؤك وما يصير بينكم.
 *
 * ثلاث طبقات من الأقرب إلى الأبعد:
 *
 *   1. الحاضرون: وجوه كبيرة، والحلقة تقول الحالة بلا كلام — بنفسجية لمن
 *      يقرأ، نقطة خضراء لمن هو متصل.
 *   2. «يقرأون الآن»: من يقرأ هذه اللحظة وماذا.
 *   3. ما صار: الفريمات والترشيحات بين الأصدقاء، وخطوط قراءة مختصرة.
 *      لا رسائل خاصة: ما يُرسَل لشخص يراه الجميع إلا من أخفاه المرسل عنه —
 *      والإخفاء يُطبَّق في الخادم، فلا يصل هنا أصلًا.
 *
 * كل ما هنا من المزامنة والحضور. لا بيانات مصطنعة.
 */

import { glyph } from './icons.js';
import { countLabel } from './plural.js';

/** نفس القائمة المغلقة في الخادم (`MAJLIS_REACTIONS`). */
export const REACTIONS = ['❤️', '🔥', '😂', '😮', '😢', '👏'];
const LONG_PRESS_MS = 420;

const FILTERS = [
  ['all', 'الكل'],
  ['frames', 'فريمات'],
  ['recs', 'ترشيحات'],
  ['reading', 'قراءة'],
];

const VERB_COPY = {
  CHAPTER_DONE: (p) => (p?.chapter != null ? `خلّص الفصل ${p.chapter}` : 'خلّص فصلًا'),
  LIBRARY_ADD: () => 'أضاف إلى مكتبته',
  FAVORITED: () => 'أضاف إلى المفضلة',
  RATED_WORK: (p) => (p?.score ? `قيّم ${Math.round(p.score / 2)} من 5` : 'قيّم'),
  COMMENTED: () => 'علّق على',
};
const VERB_ICON = { CHAPTER_DONE: 'check', LIBRARY_ADD: 'library', FAVORITED: 'heart', RATED_WORK: 'star', COMMENTED: 'edit' };

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const parse = (text, fallback) => {
  try {
    return JSON.parse(text ?? '') ?? fallback;
  } catch {
    return fallback;
  }
};

/**
 * @param {{
 *   sync: any,
 *   host: HTMLElement,
 *   presence: () => Promise<any[]>,
 *   avatarNode: (person: object, size: number) => HTMLElement,
 *   mountImage: (container: HTMLElement, work: object) => Promise<unknown>,
 *   workFromRef: (ref: string, title?: string, cover?: string) => object,
 *   openWork: (work: object) => void,
 *   openFrame: (id: string) => void,
 *   openProfile: (userId: string) => void,
 *   openShare: () => void,
 *   preview: (work: object, opts?: { chapter?: { label: string, number: number|null } }) => void,
 *   pageImage?: ((sourceId: string, page: object) => Promise<string>) | null,
 * }} ctx
 */
export function createMajlis(ctx) {
  const { sync, host } = ctx;
  const me = () => sync.user?.userId;
  let filter = 'all';
  let presence = [];
  let timer = null;

  const profile = (userId) => sync.rows('profiles', (p) => p.user_id === userId)[0];
  const nameOf = (userId) =>
    userId === me() ? 'أنت' : profile(userId)?.display_name || sync.rows('accounts', (a) => a.user_id === userId)[0]?.username || 'صديق';
  const personOf = (userId) => ({ userId, displayName: nameOf(userId), avatarKey: profile(userId)?.avatar_key ?? null });
  const members = () =>
    sync
      .rows('accounts', () => true)
      .map((a) => a.user_id)
      .sort((a, b) => (a === me() ? -1 : b === me() ? 1 : nameOf(a).localeCompare(nameOf(b), 'ar')));
  const presenceOf = (userId) => presence.find((p) => p.userId === userId) ?? null;
  const workOf = (ref, title, cover) => {
    const row = ref ? sync.rows('works', (w) => w.series_ref === ref)[0] : null;
    return ctx.workFromRef(ref ?? `ext:${String(title ?? '').toLowerCase()}`, row?.title ?? title, row?.cover_url ?? cover);
  };

  // ── التفاعلات ──
  // ضغطة مطوّلة على أي رسالة تُظهر شريط الرموز فوقها. واختيارك يظهر تحتها
  // بوجوه من تفاعلوا. تفاعلك يُعرض فورًا، والخادم يُثبته.

  const pendingReaction = new Map();
  const reactKey = (kind, id) => `${kind}/${id}`;
  function reactionsOf(kind, id) {
    const rows = sync.rows('majlis_reactions', (r) => r.target_kind === kind && r.target_id === id && r.user_id !== me());
    const mine = pendingReaction.has(reactKey(kind, id))
      ? pendingReaction.get(reactKey(kind, id))
      : sync.rows('majlis_reactions', (r) => r.target_kind === kind && r.target_id === id && r.user_id === me())[0]?.emoji ?? null;
    const all = [...rows.filter((r) => r.emoji).map((r) => ({ userId: r.user_id, emoji: r.emoji }))];
    if (mine) all.push({ userId: me(), emoji: mine });
    return { all, mine };
  }
  function react(kind, id, emoji) {
    const { mine } = reactionsOf(kind, id);
    const next = mine === emoji ? null : emoji;
    pendingReaction.set(reactKey(kind, id), next);
    sync.enqueue('majlis.react', { targetKind: kind, targetId: id, emoji: next });
    navigator.vibrate?.(8);
    render();
  }
  function reactionChips(kind, id) {
    const { all, mine } = reactionsOf(kind, id);
    if (!all.length) return null;
    const byEmoji = new Map();
    for (const r of all) byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r.userId]);
    const row = el('div', 'mj-reactions');
    for (const [emoji, users] of byEmoji) {
      const chip = el('button', `mj-reaction${emoji === mine ? ' mj-reaction--mine' : ''}`);
      chip.type = 'button';
      chip.append(el('span', 'mj-reaction-emoji', emoji));
      const faces = el('span', 'mj-reaction-faces');
      for (const u of users.slice(0, 3)) faces.append(ctx.avatarNode(personOf(u), 18));
      chip.append(faces);
      if (users.length > 3) chip.append(el('span', 'mj-reaction-more', `+${users.length - 3}`));
      chip.setAttribute('aria-label', `${emoji} من ${users.map(nameOf).join('، ')}`);
      chip.onclick = (e) => {
        e.stopPropagation();
        react(kind, id, emoji);
      };
      row.append(chip);
    }
    return row;
  }

  let bar = null;
  function closeBar() {
    if (!bar) return false;
    bar.remove();
    bar = null;
    return true;
  }
  function openBar(anchor, kind, id) {
    closeBar();
    const { mine } = reactionsOf(kind, id);
    bar = el('div', 'mj-bar');
    bar.setAttribute('role', 'menu');
    bar.setAttribute('aria-label', 'تفاعل');
    REACTIONS.forEach((emoji, i) => {
      const b = el('button', `mj-bar-item${emoji === mine ? ' mj-bar-item--on' : ''}`, emoji);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.style.animationDelay = `${i * 22}ms`;
      b.onclick = (e) => {
        e.stopPropagation();
        closeBar();
        react(kind, id, emoji);
      };
      bar.append(b);
    });
    document.body.append(bar);
    const r = anchor.getBoundingClientRect();
    const w = bar.offsetWidth;
    const top = Math.max(12, r.top - bar.offsetHeight - 8);
    const left = Math.min(window.innerWidth - w - 12, Math.max(12, r.left + r.width / 2 - w / 2));
    bar.style.top = `${top}px`;
    bar.style.left = `${left}px`;
    anchor.classList.add('mj-pressed');
    setTimeout(() => anchor.classList.remove('mj-pressed'), 260);
    navigator.vibrate?.(12);
    const away = (e) => {
      if (bar && !bar.contains(e.target)) {
        closeBar();
        document.removeEventListener('pointerdown', away, true);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  }
  /**
   * الضغطة المطوّلة تفتح الشريط وتلغي اللمسة العادية بعدها، فلا يفتح العمل
   * تحت إصبعك. والتمرير (حركة أكثر من 8 نقاط) يلغيها.
   */
  function bindReact(node, kind, id) {
    let timer = null;
    let start = null;
    node.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => {
        timer = null;
        node.dataset.longPressed = '1';
        openBar(node, kind, id);
      }, LONG_PRESS_MS);
    });
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
    };
    node.addEventListener('pointermove', (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel();
    });
    node.addEventListener('pointerup', cancel);
    node.addEventListener('pointercancel', cancel);
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      cancel();
      openBar(node, kind, id);
    });
    node.addEventListener(
      'click',
      (e) => {
        if (node.dataset.longPressed) {
          delete node.dataset.longPressed;
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true,
    );
  }

  // ── الحاضرون ──

  function statusRank(userId) {
    const s = presenceOf(userId)?.status;
    return s === 'READING' ? 0 : s === 'ONLINE' ? 1 : s === 'IDLE' ? 2 : 3;
  }
  function memberFace(userId) {
    const p = presenceOf(userId);
    const status = p?.status ?? 'OFFLINE';
    const b = el('button', `mj-member mj-member--${status.toLowerCase()}`);
    b.type = 'button';
    const ring = el('span', 'mj-ring');
    ring.append(ctx.avatarNode(personOf(userId), 60));
    if (status === 'READING') {
      const badge = el('span', 'mj-badge');
      badge.innerHTML = glyph('book', { size: 12 });
      ring.append(badge);
    } else if (status === 'ONLINE' || status === 'IDLE') {
      ring.append(el('span', 'mj-dot'));
    }
    b.append(ring, el('span', 'mj-member-name', nameOf(userId)));
    const label = { READING: 'يقرأ الآن', ONLINE: 'متصل', IDLE: 'خامل' }[status] ?? lastSeen(p?.lastSeenAt);
    b.append(el('span', 'mj-member-state', label));
    b.setAttribute('aria-label', `${nameOf(userId)}، ${label}`);
    b.onclick = () => ctx.openProfile(userId);
    return b;
  }
  function lastSeen(at) {
    if (!at) return 'غير متصل';
    const minutes = Math.floor((Date.now() - at) / 60_000);
    if (minutes < 60) return `قبل ${Math.max(1, minutes)} د`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `قبل ${hours} س`;
    return `قبل ${countLabel(Math.floor(hours / 24), 'day')}`;
  }

  // ── يقرأون الآن ──

  function readingNow() {
    return presence.filter((p) => p.status === 'READING' && p.seriesTitle && p.userId !== me());
  }
  function readingCard(p) {
    const work = workOf(p.seriesRef, p.seriesTitle);
    const b = el('button', 'mj-now');
    b.type = 'button';
    const cover = el('span', 'mj-now-cover');
    void ctx.mountImage(cover, work);
    const copy = el('span', 'mj-now-copy');
    const who = el('span', 'mj-now-who');
    who.append(ctx.avatarNode(personOf(p.userId), 22), el('span', null, `${nameOf(p.userId)} يقرأ`));
    const title = el('bdi', 'mj-now-title', p.seriesTitle);
    copy.append(who, title);
    if (p.chapterLabel) copy.append(el('span', 'mj-now-chapter', p.chapterLabel));
    const live = el('span', 'mj-live');
    live.setAttribute('aria-hidden', 'true');
    b.append(cover, copy, live);
    b.onclick = () => ctx.preview(work, p.chapterLabel ? { chapter: { label: p.chapterLabel, number: p.chapterNumber ?? null } } : {});
    return b;
  }

  // ── ما صار ──

  function events() {
    const out = [];
    for (const f of sync.rows('frames', () => true)) {
      out.push({ kind: 'frame', at: f.created_at, actor: f.from_id, row: f });
    }
    for (const r of sync.rows('recommendations', () => true)) {
      out.push({ kind: 'rec', at: r.created_at, actor: r.from_id, row: r });
    }
    for (const a of sync.rows('activity', (x) => x.verb in VERB_COPY)) {
      out.push({ kind: 'act', at: a.created_at, actor: a.actor_id, row: a });
    }
    return out
      .filter((e) => filter === 'all' || (filter === 'frames' && e.kind === 'frame') || (filter === 'recs' && e.kind === 'rec') || (filter === 'reading' && e.kind === 'act'))
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      .slice(0, 120);
  }

  /** «Meshal أرسل فريم إلى D7m» — والطرفان معزولان بلا خلط في الاتجاه. */
  function headline(actor, verb, target) {
    const h = el('div', 'mj-head');
    const face = ctx.avatarNode(personOf(actor), 36);
    face.classList.add('mj-head-face');
    const line = el('p', 'mj-head-line');
    line.append(el('bdi', 'mj-name', nameOf(actor)), document.createTextNode(` ${verb}`));
    if (target) line.append(document.createTextNode(' '), target);
    h.append(face, line);
    return h;
  }
  function targetLabel(toId, broadcast) {
    if (broadcast || !toId) return el('span', 'mj-to', 'للجميع');
    const span = el('span', 'mj-to');
    span.append(document.createTextNode(toId === me() ? 'لك' : 'إلى '));
    if (toId !== me()) span.append(el('bdi', 'mj-name', nameOf(toId)));
    return span;
  }
  function timeLabel(at) {
    const d = new Date(at);
    return d.toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit', numberingSystem: 'latn' });
  }

  function frameCard(e) {
    const f = e.row;
    const pages = parse(f.pages_json, []);
    const card = el('article', 'mj-card mj-card--frame');
    card.append(headline(e.actor, 'أرسل فريم', targetLabel(f.to_id === f.from_id ? null : f.to_id, f.broadcast)));
    if (f.message) {
      const quote = el('p', 'mj-quote', f.message);
      quote.dir = 'auto';
      card.append(quote);
    }
    const open = el('button', 'mj-frame');
    open.type = 'button';
    const shot = el('span', 'mj-frame-shot');
    const work = workOf(null, f.series_title, f.cover_url);
    void ctx.mountImage(shot, work).then(() => showFirstPage(shot, f, pages));
    const count = el('span', 'mj-frame-count');
    count.innerHTML = glyph('camera', { size: 14 });
    count.append(el('span', null, String(pages.length)));
    shot.append(count);
    const copy = el('span', 'mj-frame-copy');
    copy.append(el('bdi', 'mj-frame-title', f.series_title || 'عمل'));
    copy.append(el('span', 'mj-frame-meta', [f.chapter_label, countLabel(pages.length, 'page')].filter(Boolean).join(' · ')));
    const cta = el('span', 'mj-frame-cta');
    cta.innerHTML = `<span>افتح الفريم</span>${glyph('chevron', { size: 18 })}`;
    copy.append(cta);
    open.append(shot, copy);
    open.onclick = () => ctx.openFrame(f.id);
    card.append(open);
    const chips = reactionChips('frame', f.id);
    if (chips) card.append(chips);
    card.append(el('time', 'mj-time', timeLabel(e.at)));
    bindReact(card, 'frame', f.id);
    return card;
  }

  /**
   * أول صفحة أُرسلت، لا غلاف العمل: الفريم لقطة، واللقطة هي ما يُعرض.
   * تُجلب بمحرّك الجهاز (والمحرّك يخزّنها)، والغلاف يبقى إن تعذّرت.
   */
  function showFirstPage(shot, f, pages) {
    if (!ctx.pageImage || !pages.length) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((x) => x.isIntersecting)) return;
      io.disconnect();
      ctx
        .pageImage(f.source_id, pages[0])
        .then((src) => {
          const img = new Image();
          img.alt = '';
          img.onload = () => {
            shot.querySelector(':scope > img')?.remove();
            shot.prepend(img);
            shot.classList.add('mj-frame-shot--page');
          };
          img.src = src;
        })
        .catch(() => {});
    });
    io.observe(shot);
  }

  function recCard(e) {
    const r = e.row;
    const card = el('article', 'mj-card mj-card--rec');
    const chapter = r.chapter_label ? { label: r.chapter_label, number: r.chapter_number ?? null } : null;
    card.append(headline(e.actor, chapter ? `رشّح ${chapter.label}` : 'رشّح عملًا', targetLabel(r.to_id, !r.to_id)));
    const work = workOf(r.series_ref, r.series_title, r.cover_url);
    const b = el('button', 'mj-work');
    b.type = 'button';
    const cover = el('span', 'mj-work-cover');
    void ctx.mountImage(cover, work);
    const copy = el('span', 'mj-work-copy');
    copy.append(el('bdi', 'mj-work-title', r.series_title || work.title?.english || 'عمل'));
    if (chapter) {
      const tag = el('span', 'mj-chapter-tag');
      tag.innerHTML = glyph('book', { size: 14 });
      tag.append(el('span', null, chapter.label));
      copy.append(tag);
    }
    if (r.message) {
      const quote = el('span', 'mj-work-note', r.message);
      quote.dir = 'auto';
      copy.append(quote);
    }
    // إيصالات حقيقية للمرسل وحده: من فتح ترشيحك ومن لم يفتحه
    if (r.from_id === me()) {
      const states = sync.rows('recommendation_recipients', (x) => x.recommendation_id === r.id);
      if (states.length) {
        const receipts = el('span', 'mj-receipts');
        for (const s of states) {
          const opened = s.state && s.state !== 'PENDING';
          const chip = el('span', `mj-receipt${opened ? ' mj-receipt--seen' : ''}`);
          chip.append(ctx.avatarNode(personOf(s.user_id), 18), el('span', null, opened ? 'شافه' : 'وصله'));
          receipts.append(chip);
        }
        copy.append(receipts);
      }
    }
    b.append(cover, copy);
    b.onclick = () => ctx.preview(work, chapter ? { chapter } : {});
    card.append(b);
    const chips = reactionChips('rec', r.id);
    if (chips) card.append(chips);
    card.append(el('time', 'mj-time', timeLabel(e.at)));
    bindReact(card, 'rec', r.id);
    return card;
  }

  function actLine(e) {
    const a = e.row;
    const payload = parse(a.payload, {});
    const work = a.series_ref ? workOf(a.series_ref) : null;
    const b = el('button', 'mj-line');
    b.type = 'button';
    const face = el('span', 'mj-line-face');
    face.append(ctx.avatarNode(personOf(e.actor), 32));
    const icon = el('span', `mj-line-icon mj-line-icon--${a.verb.toLowerCase()}`);
    icon.innerHTML = glyph(VERB_ICON[a.verb] ?? 'activity', { size: 11 });
    face.append(icon);
    const text = el('span', 'mj-line-text');
    text.append(el('bdi', 'mj-name', nameOf(e.actor)), document.createTextNode(` ${VERB_COPY[a.verb](payload)}`));
    const title = work?.title?.english && !String(work.title.english).startsWith('ext:') ? work.title.english : null;
    if (title) {
      text.append(document.createTextNode(' · '));
      text.append(el('bdi', 'mj-line-work', title));
    }
    const end = el('span', 'mj-line-end');
    if (work) {
      const thumb = el('span', 'mj-line-cover');
      void ctx.mountImage(thumb, work);
      end.append(thumb);
    }
    end.append(el('time', 'mj-line-time', timeLabel(e.at)));
    b.append(face, text, end);
    if (work) b.onclick = () => ctx.preview(work);
    const wrap = el('div', 'mj-line-wrap');
    wrap.append(b);
    const chips = reactionChips('activity', a.id);
    if (chips) wrap.append(chips);
    bindReact(wrap, 'activity', a.id);
    return wrap;
  }

  function dayLabel(at) {
    const start = new Date().setHours(0, 0, 0, 0);
    if (at >= start) return 'اليوم';
    if (at >= start - 86_400_000) return 'أمس';
    return new Date(at).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long', numberingSystem: 'latn' });
  }

  // ── الرسم ──

  function render() {
    const parts = [];

    const strip = el('section', 'mj-members');
    strip.setAttribute('aria-label', 'الحاضرون');
    const ids = members().sort((a, b) => (a === me() ? -1 : b === me() ? 1 : statusRank(a) - statusRank(b)));
    strip.append(...ids.map(memberFace));
    parts.push(strip);

    const now = readingNow();
    if (now.length) {
      const sec = el('section', 'mj-section');
      const h = el('h2', 'mj-title');
      h.append(el('span', 'mj-live mj-live--inline'), document.createTextNode('يقرأون الآن'));
      sec.append(h);
      const row = el('div', 'mj-now-row');
      row.append(...now.map(readingCard));
      sec.append(row);
      parts.push(sec);
    }

    const feed = el('section', 'mj-section mj-feed');
    const head = el('div', 'mj-feed-head');
    head.append(el('h2', 'mj-title', 'آخر ما صار'));
    const chips = el('div', 'segmented mj-filters');
    chips.setAttribute('role', 'tablist');
    for (const [k, label] of FILTERS) {
      const c = el('button', `library-tab${k === filter ? ' active' : ''}`, label);
      c.type = 'button';
      c.setAttribute('role', 'tab');
      c.setAttribute('aria-selected', String(k === filter));
      c.onclick = () => {
        filter = k;
        render();
      };
      chips.append(c);
    }
    head.append(chips);
    feed.append(head);

    const list = events();
    if (!list.length) {
      const empty = el('div', 'empty mj-empty');
      const inner = el('div');
      inner.innerHTML = `<div class="empty-art">${glyph('users')}</div>`;
      inner.append(el('h3', null, filter === 'all' ? 'المجلس هادي' : 'ما فيه شي هنا بعد'));
      inner.append(el('p', null, 'رشّح عملًا لأصدقائك، أو أرسل فريمًا من القارئ بزرّ الكاميرا.'));
      const cta = el('button', 'btn btn-secondary');
      cta.type = 'button';
      cta.innerHTML = `${glyph('compass')}<span>اكتشف عملًا ترشّحه</span>`;
      cta.onclick = ctx.openShare;
      inner.append(cta);
      empty.append(inner);
      feed.append(empty);
    } else {
      let day = null;
      let lines = null;
      for (const e of list) {
        const d = dayLabel(e.at ?? 0);
        if (d !== day) {
          day = d;
          lines = null;
          feed.append(el('div', 'mj-day', d));
        }
        if (e.kind === 'act') {
          // خطوط القراءة المتتالية تُجمع في كتلة واحدة هادئة
          if (!lines) {
            lines = el('div', 'mj-lines');
            feed.append(lines);
          }
          lines.append(actLine(e));
        } else {
          lines = null;
          feed.append(e.kind === 'frame' ? frameCard(e) : recCard(e));
        }
      }
    }
    parts.push(feed);
    host.replaceChildren(...parts);
  }

  async function refreshPresence() {
    try {
      presence = (await ctx.presence()) ?? [];
    } catch {
      // الحضور تكميلي: المجلس يُعرض بدونه ولا يقول «خطأ»
    }
    render();
  }

  return {
    show() {
      render();
      void refreshPresence();
      clearInterval(timer);
      timer = setInterval(() => void refreshPresence(), 25_000);
    },
    hide() {
      clearInterval(timer);
      timer = null;
      closeBar();
    },
    closeBar,
    onChange(tables) {
      if (tables.includes('majlis_reactions')) pendingReaction.clear();
      if (tables.some((t) => ['frames', 'recommendations', 'recommendation_recipients', 'activity', 'profiles', 'accounts', 'works', 'majlis_reactions'].includes(t))) render();
    },
  };
}
