/**
 * الأصدقاء — مدخل الاجتماع.
 *
 * ثلاث طبقات، بلا صناديق فوق بعض:
 *
 *   1. الشريط: وجوه أصدقائك وحالهم الآن (نقطة حيّة لمن هو متصل، غلاف صغير
 *      لمن يقرأ أو يشاهد). الوجه يفتح ملفه، والغلاف يفتح بطاقة العمل.
 *   2. المجلس: صفّ واحد بوجوه أعضائه وآخر ما وصل فيه وعدد ما لم تره.
 *      المجلس نفسه صفحة أخرى؛ هذا بابه فقط.
 *   3. آخر ما صار: سطور خفيفة لا بطاقات — من خلّص ماذا، ومن رشّح ماذا —
 *      لقسمك الحالي (المانجا ترى المانجا، والأنمي يرى الأنمي). ضغطة مطوّلة
 *      على سطر: تفاعل، «إخفاء لدي»، و«حذف للجميع» لما هو لك.
 *
 * كل ما هنا من المزامنة والحضور. لا بيانات مصطنعة.
 */

import { glyph } from './icons.js';
import { displayTitle, refForTitle } from './work-ref.js';
import { REACTIONS } from './majlis.js';
import { gsap } from '../vendor/gsap.esm.js';

const LONG_PRESS_MS = 420;
const HIDDEN_KEY = (userId) => `vantara.feed.hidden.${userId}`;

const MANGA_FILTERS = [
  ['all', 'الكل'],
  ['reading', 'قراءة'],
  ['recs', 'ترشيحات'],
  ['frames', 'فريمات'],
];
const ANIME_FILTERS = [
  ['all', 'الكل'],
  ['recs', 'ترشيحات ولحظات'],
];

const VERB_COPY = {
  CHAPTER_DONE: (p) => (p?.chapter != null ? `خلّص الفصل ${p.chapter}` : 'خلّص فصلًا'),
  LIBRARY_ADD: () => 'أضاف لمكتبته',
  FAVORITED: () => 'أضاف للمفضلة',
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
const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const motion = () => (reduced() ? null : gsap);

/** «قبل 5 د» قصيرة: تحت الوجه وبجانب السطر لا مكان لجملة. */
export function shortAgo(at, now = Date.now()) {
  if (!at) return '';
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} س`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'أمس';
  if (days < 7) return `${days} ي`;
  return new Date(at).toLocaleDateString('ar', { day: 'numeric', month: 'short', numberingSystem: 'latn' });
}

/**
 * أحداث «آخر ما صار» لقسم واحد، بعد ما حُذف للجميع وما أخفيته لديك.
 * منفصلة عن الرسم لتُختبر وحدها.
 */
export function feedEvents(sync, { anime, filter, hidden = new Set(), limit = 80 }) {
  const isAnime = (ref) => typeof ref === 'string' && ref.startsWith('anime:');
  const onSide = (ref) => isAnime(ref) === anime;
  const out = [];
  if (!anime) {
    for (const f of sync.rows('frames', (x) => !x.removed)) out.push({ kind: 'frame', id: f.id, at: f.created_at, actor: f.from_id, row: f });
  }
  for (const r of sync.rows('recommendations', (x) => !x.removed && onSide(x.series_ref))) out.push({ kind: 'rec', id: r.id, at: r.created_at, actor: r.from_id, row: r });
  for (const a of sync.rows('activity', (x) => !x.removed && x.verb in VERB_COPY && onSide(x.series_ref))) out.push({ kind: 'activity', id: a.id, at: a.created_at, actor: a.actor_id, row: a });
  return out
    .filter((e) => !hidden.has(`${e.kind}:${e.id}`))
    .filter((e) => filter === 'all' || (filter === 'frames' && e.kind === 'frame') || (filter === 'recs' && e.kind === 'rec') || (filter === 'reading' && e.kind === 'activity'))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, limit);
}

/**
 * @param {{
 *   sync: any, host: HTMLElement,
 *   presence: () => Promise<any[]>,
 *   avatarNode: (person: object, size: number) => HTMLElement,
 *   mountImage: (container: HTMLElement, work: object) => Promise<unknown>,
 *   workFromRef: (ref: string, title?: string, cover?: string) => object,
 *   preview: (work: object, opts?: object) => void,
 *   openFrame: (id: string) => void,
 *   openProfile: (userId: string) => void,
 *   openMajlis: () => void,
 *   markSeen: (kind: string, id: string) => void,
 *   openSheet: (build: (body: HTMLElement) => unknown) => void,
 *   closeSheet: () => void,
 *   toast: (text: string) => void,
 *   section: () => 'manga' | 'anime',
 *   visible: () => boolean,
 * }} ctx
 */
export function createFriends(ctx) {
  const { sync, host } = ctx;
  const me = () => sync.user?.userId;
  let presence = [];
  let timer = null;
  let filter = 'all';
  let firstPaint = true;
  const shownRows = new Set();

  const profile = (userId) => sync.rows('profiles', (p) => p.user_id === userId)[0];
  const nameOf = (userId) =>
    userId === me() ? 'أنت' : profile(userId)?.display_name || sync.rows('accounts', (a) => a.user_id === userId)[0]?.username || 'صديق';
  const personOf = (userId) => ({ userId, displayName: nameOf(userId), avatarKey: profile(userId)?.avatar_key ?? null });
  const presenceOf = (userId) => presence.find((p) => p.userId === userId) ?? null;
  const isAnime = (ref) => typeof ref === 'string' && ref.startsWith('anime:');
  const anime = () => ctx.section() === 'anime';
  const watching = (p) => p?.screen === 'ANIME' || isAnime(p?.seriesRef);
  const filters = () => (anime() ? ANIME_FILTERS : MANGA_FILTERS);
  const friendIds = () =>
    sync
      .rows('accounts', () => true)
      .map((a) => a.user_id)
      .filter((id) => id !== me());
  const workOf = (ref, title, cover) => {
    const id = ref ?? refForTitle(title) ?? 'ext:عمل';
    const known = sync.rows('works', (w) => w.series_ref === id)[0];
    return ctx.workFromRef(id, known?.title ?? title, known?.cover_url ?? cover);
  };

  // ── «إخفاء لدي»: على هذا الجهاز، لا يمسّ ما يراه غيرك ──
  const readHidden = () => {
    try {
      return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY(me())) ?? '[]'));
    } catch {
      return new Set();
    }
  };
  function hideForMe(key) {
    const set = readHidden();
    set.add(key);
    try {
      localStorage.setItem(HIDDEN_KEY(me()), JSON.stringify([...set].slice(-500)));
    } catch {
      // تخزين ممتلئ: يختفي الآن فقط
    }
  }

  // ── لمسة ضاغطة: كل ما يُضغط ينكمش قليلًا ويرجع بنابض ──
  function pressable(node) {
    node.addEventListener('pointerdown', () => motion()?.to(node, { scale: 0.965, duration: 0.12, ease: 'power2.out' }));
    const up = () => motion()?.to(node, { scale: 1, duration: 0.45, ease: 'elastic.out(1, 0.5)' });
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('pointerleave', up);
    return node;
  }

  // ───────────────────────── الشريط ─────────────────────────

  function stateOf(userId) {
    const p = presenceOf(userId);
    const status = p?.status ?? 'OFFLINE';
    if (status === 'READING') return { tone: 'live', text: watching(p) ? 'يشاهد' : 'يقرأ', p };
    if (status === 'ONLINE') return { tone: 'on', text: 'متصل', p };
    if (status === 'IDLE') return { tone: 'idle', text: 'خامل', p };
    return { tone: 'off', text: p?.lastSeenAt ? shortAgo(p.lastSeenAt) : '', p };
  }
  const rank = (id) => ({ READING: 0, ONLINE: 1, IDLE: 2 })[presenceOf(id)?.status] ?? 3;

  function friendFace(userId) {
    const { tone, text, p } = stateOf(userId);
    const item = el('div', `fr-pal fr-pal--${tone}`);
    const face = pressable(el('button', 'fr-pal-face'));
    face.type = 'button';
    face.setAttribute('aria-label', `ملف ${nameOf(userId)}${text ? `، ${text}` : ''}`);
    const ring = el('span', 'fr-pal-ring');
    ring.append(ctx.avatarNode(personOf(userId), 62));
    face.append(ring);
    if (tone === 'on' || tone === 'idle') face.append(el('span', 'fr-dot'));
    face.onclick = () => ctx.openProfile(userId);
    item.append(face);
    // يقرأ الآن: غلاف صغير على كتف الوجه، يفتح بطاقة العمل
    if (tone === 'live' && p?.seriesTitle) {
      const work = workOf(p.seriesRef, p.seriesTitle);
      const chip = pressable(el('button', 'fr-pal-work'));
      chip.type = 'button';
      chip.setAttribute('aria-label', `${text} ${p.seriesTitle}`);
      void ctx.mountImage(chip, work);
      chip.onclick = (e) => {
        e.stopPropagation();
        ctx.preview(work, p.chapterLabel ? { chapter: { label: p.chapterLabel, number: p.chapterNumber ?? null } } : {});
      };
      item.append(chip);
    }
    const name = el('bdi', 'fr-pal-name', nameOf(userId));
    item.append(name);
    if (text) item.append(el('span', 'fr-pal-state', text));
    return item;
  }

  /** من يقرأ/يشاهد الآن في قسمك: العمل نفسه بطاقة صغيرة تُفتح. */
  function nowRow() {
    const now = presence.filter((p) => p.status === 'READING' && p.seriesTitle && p.userId !== me() && watching(p) === anime());
    if (!now.length) return null;
    const row = el('div', 'fr-now');
    for (const p of now) {
      const work = workOf(p.seriesRef, p.seriesTitle);
      const b = pressable(el('button', 'fr-now-card'));
      b.type = 'button';
      const cover = el('span', 'fr-now-cover');
      void ctx.mountImage(cover, work);
      const copy = el('span', 'fr-now-copy');
      const who = el('span', 'fr-now-who');
      who.append(el('i', 'fr-live'), el('span', null, `${nameOf(p.userId)} ${watching(p) ? 'يشاهد' : 'يقرأ'}`));
      copy.append(who, el('bdi', 'fr-now-title', p.seriesTitle));
      if (p.chapterLabel) copy.append(el('span', 'fr-now-sub', p.chapterLabel));
      b.append(cover, copy);
      b.onclick = () => ctx.preview(work, p.chapterLabel ? { chapter: { label: p.chapterLabel, number: p.chapterNumber ?? null } } : {});
      row.append(b);
    }
    return row;
  }

  // ───────────────────────── باب المجلس ─────────────────────────

  /** ما لم تره من رسائل المجلس (فريمات وترشيحات لك أو للجميع). */
  function unseen() {
    const mine = me();
    const seen = (kind, id) => sync.rows('majlis_receipts', (r) => r.target_kind === kind && r.target_id === id && r.user_id === mine && r.seen_at).length > 0;
    let n = 0;
    for (const f of sync.rows('frames', (x) => !x.removed && x.from_id !== mine)) if (!seen('frame', f.id)) n++;
    for (const r of sync.rows('recommendations', (x) => !x.removed && x.from_id !== mine)) if (!seen('rec', r.id)) n++;
    return n;
  }
  function lastMessage() {
    const frames = sync.rows('frames', (x) => !x.removed).map((f) => ({ at: f.created_at, who: f.from_id, text: `أرسل فريم من ${f.series_title || 'عمل'}` }));
    const recs = sync
      .rows('recommendations', (x) => !x.removed)
      .map((r) => ({ at: r.created_at, who: r.from_id, text: r.message ? r.message : `رشّح ${r.series_title || 'عملًا'}` }));
    return [...frames, ...recs].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0] ?? null;
  }
  function majlisDoor() {
    const members = [me(), ...friendIds()];
    const online = friendIds().filter((id) => rank(id) < 3).length;
    const door = pressable(el('button', 'fr-door'));
    door.type = 'button';
    const crest = el('span', 'fr-door-crest');
    const faces = el('span', 'fr-door-faces');
    for (const id of friendIds()
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 3)) {
      const f = el('span', 'fr-door-face');
      f.append(ctx.avatarNode(personOf(id), 30));
      faces.append(f);
    }
    faces.dataset.count = String(faces.childElementCount);
    crest.append(faces);
    const copy = el('span', 'fr-door-copy');
    const title = el('span', 'fr-door-title');
    title.append(el('b', null, 'المجلس'), el('span', 'fr-door-count', `${members.length} أعضاء${online ? ` · ${online} متصل` : ''}`));
    copy.append(title);
    const last = lastMessage();
    const line = el('span', 'fr-door-line');
    if (last) {
      line.append(el('bdi', 'fr-door-who', `${nameOf(last.who)}:`), document.createTextNode(' '));
      const t = el('bdi', null, last.text);
      line.append(t);
    } else line.textContent = 'رشّح عملًا أو أرسل فريمًا، ويبدأ الكلام';
    copy.append(line);
    const end = el('span', 'fr-door-end');
    if (last) end.append(el('time', 'fr-door-time', shortAgo(last.at)));
    const count = unseen();
    if (count) end.append(el('span', 'fr-badge', count > 99 ? '99+' : String(count)));
    else end.insertAdjacentHTML('beforeend', `<span class="fr-door-go">${glyph('chevron', { size: 18 })}</span>`);
    door.append(crest, copy, end);
    door.setAttribute('aria-label', `المجلس${count ? `، ${count} جديد` : ''}`);
    door.onclick = () => ctx.openMajlis();
    return door;
  }

  // ───────────────────────── آخر ما صار ─────────────────────────

  function reactionSummary(kind, id) {
    const rows = sync.rows('majlis_reactions', (r) => r.target_kind === kind && r.target_id === id && r.emoji);
    if (!rows.length) return null;
    const counts = new Map();
    for (const r of rows) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    const span = el('span', 'fr-row-reacts');
    for (const [emoji, n] of [...counts].slice(0, 3)) span.append(el('span', null, n > 1 ? `${emoji}${n}` : emoji));
    return span;
  }

  function rowOf(e) {
    const r = e.row;
    const row = el('div', 'fr-row');
    row.dataset.key = `${e.kind}:${e.id}`;
    const face = el('span', 'fr-row-face');
    face.append(ctx.avatarNode(personOf(e.actor), 36));
    const icon = el('span', `fr-row-icon fr-row-icon--${e.kind === 'activity' ? r.verb.toLowerCase() : e.kind}`);
    icon.innerHTML = glyph(e.kind === 'frame' ? 'camera' : e.kind === 'rec' ? 'send' : (VERB_ICON[r.verb] ?? 'activity'), { size: 10 });
    face.append(icon);

    const text = el('span', 'fr-row-text');
    const line = el('span', 'fr-row-line');
    line.append(el('bdi', 'fr-row-name', nameOf(e.actor)), document.createTextNode(' '));
    let work = null;
    let chapter = null;
    if (e.kind === 'activity') {
      line.append(document.createTextNode(VERB_COPY[r.verb](parse(r.payload, {}))));
      if (r.series_ref) work = workOf(r.series_ref);
    } else if (e.kind === 'rec') {
      chapter = r.chapter_label ? { label: r.chapter_label, number: r.chapter_number ?? null } : null;
      const moment = isAnime(r.series_ref) && chapter?.label.includes('·');
      const to = !r.to_id ? 'للكل' : r.to_id === me() ? 'لك' : `لـ${nameOf(r.to_id)}`;
      line.append(document.createTextNode(moment ? `شارك لحظة ${to}` : `رشّح ${to}`));
      work = workOf(r.series_ref, r.series_title, r.cover_url);
    } else {
      line.append(document.createTextNode('أرسل فريم'));
      work = workOf(null, r.series_title, r.cover_url);
    }
    text.append(line);
    const title = work ? displayTitle(work.id, work.title?.english) || r.series_title : null;
    const meta = el('span', 'fr-row-meta');
    if (title) meta.append(el('bdi', 'fr-row-work', title));
    const sub = e.kind === 'frame' ? r.chapter_label : chapter?.label;
    if (sub) meta.append(el('span', 'fr-row-sub', sub));
    if (meta.childNodes.length) text.append(meta);
    if (e.kind === 'rec' && r.message) {
      const q = el('span', 'fr-row-quote', r.message);
      q.dir = 'auto';
      text.append(q);
    }
    const foot = el('span', 'fr-row-foot');
    foot.append(el('time', 'fr-row-time', shortAgo(e.at)));
    const reacts = reactionSummary(e.kind, e.id);
    if (reacts) foot.append(reacts);
    text.append(foot);

    const main = el('button', 'fr-row-main');
    main.type = 'button';
    main.append(face, text);
    if (work) {
      const thumb = el('span', 'fr-row-cover');
      void ctx.mountImage(thumb, work);
      main.append(thumb);
    }
    main.onclick = () => {
      if (main.dataset.longPressed) return void delete main.dataset.longPressed;
      if (e.kind === 'frame') {
        ctx.markSeen('frame', r.id);
        ctx.openFrame(r.id);
      } else if (work) {
        if (e.kind === 'rec') ctx.markSeen('rec', r.id);
        ctx.preview(work, chapter ? { chapter } : {});
      }
    };
    bindLongPress(main, () => openActions(e, row, work, chapter));
    row.append(main);
    return row;
  }

  function bindLongPress(node, onLong) {
    let t = null;
    let start = null;
    node.addEventListener('pointerdown', (ev) => {
      start = { x: ev.clientX, y: ev.clientY };
      motion()?.to(node, { scale: 0.975, duration: 0.35, ease: 'power2.out' });
      t = setTimeout(() => {
        t = null;
        node.dataset.longPressed = '1';
        navigator.vibrate?.(12);
        motion()?.to(node, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.45)' });
        onLong();
      }, LONG_PRESS_MS);
    });
    const cancel = () => {
      clearTimeout(t);
      t = null;
      motion()?.to(node, { scale: 1, duration: 0.4, ease: 'elastic.out(1, 0.5)' });
    };
    node.addEventListener('pointermove', (ev) => {
      if (start && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 8) cancel();
    });
    node.addEventListener('pointerup', cancel);
    node.addEventListener('pointercancel', cancel);
    node.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      cancel();
      node.dataset.longPressed = '1';
      onLong();
    });
  }

  /** ورقة السطر: تفاعل سريع، ثم فتح، إخفاء لدي، وحذف للجميع لما هو لك. */
  function openActions(e, rowNode, work, chapter) {
    const mine = e.actor === me();
    const kind = e.kind;
    ctx.openSheet((body) => {
      body.classList.add('fr-sheet');
      const reacts = el('div', 'fr-sheet-reacts');
      const current = sync.rows('majlis_reactions', (r) => r.target_kind === kind && r.target_id === e.id && r.user_id === me())[0]?.emoji ?? null;
      REACTIONS.forEach((emoji) => {
        const b = el('button', `fr-sheet-react${emoji === current ? ' on' : ''}`, emoji);
        b.type = 'button';
        b.onclick = () => {
          sync.enqueue('majlis.react', { targetKind: kind, targetId: e.id, emoji: emoji === current ? null : emoji });
          navigator.vibrate?.(8);
          ctx.closeSheet();
        };
        reacts.append(b);
      });
      body.append(reacts);
      const list = el('div', 'fr-sheet-list');
      const action = (icon, label, run, danger = false) => {
        const b = el('button', `fr-sheet-item${danger ? ' fr-sheet-item--danger' : ''}`);
        b.type = 'button';
        b.innerHTML = glyph(icon, { size: 20 });
        b.append(el('span', null, label));
        b.onclick = () => {
          ctx.closeSheet();
          run();
        };
        list.append(b);
      };
      if (kind === 'frame') action('camera', 'افتح الفريم', () => ctx.openFrame(e.id));
      else if (work) action('book', 'افتح العمل', () => ctx.preview(work, chapter ? { chapter } : {}));
      action('eye', 'إخفاء لدي', () => {
        hideForMe(`${kind}:${e.id}`);
        collapse(rowNode, () => ctx.toast('اختفى من عندك، وباقي عند غيرك'));
      });
      if (mine) {
        action(
          'trash',
          'حذف للجميع',
          () => {
            sync.enqueue('majlis.unsend', { targetKind: kind, targetId: e.id });
            collapse(rowNode, () => ctx.toast('انحذف عند الكل'));
          },
          true,
        );
      }
      body.append(list);
      const g = motion();
      if (g) {
        g.fromTo(reacts.children, { y: 14, opacity: 0, scale: 0.6 }, { y: 0, opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2)', stagger: 0.035 });
        g.fromTo(list.children, { x: -12, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, ease: 'power3.out', stagger: 0.05, delay: 0.08 });
      }
    });
  }

  function collapse(node, done) {
    const g = motion();
    if (!g) {
      render();
      return done();
    }
    g.timeline({
      onComplete: () => {
        render();
        done();
      },
    })
      .to(node, { x: 40, opacity: 0, duration: 0.22, ease: 'power2.in' })
      .to(node, { height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0, duration: 0.26, ease: 'power3.inOut' });
  }

  function dayLabel(at) {
    const start = new Date().setHours(0, 0, 0, 0);
    if (at >= start) return 'اليوم';
    if (at >= start - 86_400_000) return 'أمس';
    return new Date(at).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long', numberingSystem: 'latn' });
  }

  function filterBar(onPick) {
    const bar = el('div', 'fr-chips');
    bar.setAttribute('role', 'tablist');
    const pill = el('span', 'fr-chip-pill');
    bar.append(pill);
    for (const [k, label] of filters()) {
      const c = el('button', `fr-chip${k === filter ? ' active' : ''}`, label);
      c.type = 'button';
      c.setAttribute('role', 'tab');
      c.setAttribute('aria-selected', String(k === filter));
      c.dataset.key = k;
      c.onclick = () => {
        if (filter === k) return;
        filter = k;
        for (const x of bar.querySelectorAll('.fr-chip')) {
          x.classList.toggle('active', x === c);
          x.setAttribute('aria-selected', String(x === c));
        }
        movePill(bar, true);
        onPick();
      };
      bar.append(c);
    }
    requestAnimationFrame(() => movePill(bar, false));
    return bar;
  }
  /** الحبة المضيئة تنزلق تحت المصفاة المختارة، لا تقفز. */
  function movePill(bar, animate) {
    const active = bar.querySelector('.fr-chip.active');
    const pill = bar.querySelector('.fr-chip-pill');
    if (!active || !pill) return;
    const to = { x: active.offsetLeft, width: active.offsetWidth };
    const g = motion();
    if (animate && g) g.to(pill, { ...to, duration: 0.42, ease: 'expo.out' });
    else Object.assign(pill.style, { transform: `translateX(${to.x}px)`, width: `${to.width}px` });
  }

  function feedList() {
    const list = el('div', 'fr-feed-list');
    const events = feedEvents(sync, { anime: anime(), filter, hidden: readHidden() });
    if (!events.length) {
      const empty = el('div', 'fr-empty');
      empty.innerHTML = `<span class="fr-empty-art">${glyph(filter === 'recs' ? 'send' : filter === 'frames' ? 'camera' : 'activity', { size: 26 })}</span>`;
      empty.append(
        el('b', null, filter === 'recs' ? 'أول ترشيح بيظهر هنا' : filter === 'frames' ? 'ما وصل فريم بعد' : 'لسه ما صار شي هنا'),
        el('span', null, anime() ? 'رشّح أنمي، أو شارك لحظة من المشغّل.' : 'رشّح عملًا، أو أرسل فريمًا من القارئ.'),
      );
      list.append(empty);
      return list;
    }
    let day = null;
    for (const e of events) {
      const d = dayLabel(e.at ?? 0);
      if (d !== day) {
        day = d;
        list.append(el('div', 'fr-day', d));
      }
      list.append(rowOf(e));
    }
    return list;
  }

  // ───────────────────────── الرسم ─────────────────────────

  function section(title, extra) {
    const head = el('div', 'fr-head');
    head.append(el('h2', 'fr-title', title));
    if (extra) head.append(extra);
    return head;
  }

  function render() {
    // إعادة الرسم (حضور كل 15 ثانية، مزامنة) لا ترجع الشريط لأوله تحت إصبعك
    const scrolls = [...host.querySelectorAll('.fr-strip, .fr-now, .fr-chips')].map((n) => [n.className, n.scrollLeft]);
    const parts = [];
    const ids = friendIds().sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b), 'ar'));

    // ١. الشريط
    const top = el('section', 'fr-top');
    if (ids.length) {
      const live = ids.filter((id) => rank(id) < 3).length;
      top.append(section('الأصدقاء', el('span', 'fr-head-meta', live ? `${live} متصل الآن` : `${ids.length}`)));
      const strip = el('div', 'fr-strip');
      strip.append(...ids.map(friendFace));
      top.append(strip);
      const now = nowRow();
      if (now) top.append(now);
    } else {
      const empty = el('div', 'fr-empty fr-empty--top');
      empty.innerHTML = `<span class="fr-empty-art">${glyph('users', { size: 26 })}</span>`;
      empty.append(el('b', null, 'ما وصل أحد بعد'), el('span', null, 'أصدقاؤك يظهرون هنا أول ما يدخلون.'));
      top.append(empty);
    }
    parts.push(top);

    // ٢. باب المجلس
    const door = el('section', 'fr-door-wrap');
    door.append(majlisDoor());
    parts.push(door);

    // ٣. آخر ما صار
    const feed = el('section', 'fr-feed');
    if (!filters().some(([k]) => k === filter)) filter = 'all';
    let list = feedList();
    const bar = filterBar(() => {
      const next = feedList();
      const g = motion();
      if (g) {
        g.to(list, {
          opacity: 0,
          y: 8,
          duration: 0.14,
          ease: 'power2.in',
          onComplete: () => {
            list.replaceWith(next);
            list = next;
            enterRows(next, true);
          },
        });
      } else {
        list.replaceWith(next);
        list = next;
      }
    });
    feed.append(section('آخر ما صار'), bar, list);
    parts.push(feed);

    host.replaceChildren(...parts);
    for (const [cls, left] of scrolls) {
      const n = host.querySelector(`.${cls.split(' ')[0]}`);
      if (n) n.scrollLeft = left;
    }
    if (firstPaint) {
      firstPaint = false;
      entrance();
    } else enterRows(list, false);
  }

  /** أول دخول: الوجوه تطلع واحدًا واحدًا، ثم الباب، ثم السطور. */
  function entrance() {
    const g = motion();
    const rows = [...host.querySelectorAll('.fr-row')];
    for (const r of rows) shownRows.add(r.dataset.key);
    if (!g) return;
    const faces = host.querySelectorAll('.fr-pal');
    g.timeline()
      .fromTo(host.querySelectorAll('.fr-head'), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out', stagger: 0.08, clearProps: 'all' }, 0)
      .fromTo(faces, { opacity: 0, y: 18, scale: 0.82 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'back.out(1.7)', stagger: 0.06, clearProps: 'all' }, 0.05)
      .fromTo(host.querySelectorAll('.fr-now-card'), { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.55, ease: 'expo.out', stagger: 0.06, clearProps: 'all' }, 0.2)
      .fromTo(host.querySelector('.fr-door'), { opacity: 0, y: 22, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'expo.out', clearProps: 'all' }, 0.18)
      .fromTo(rows.slice(0, 12), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.04, clearProps: 'all' }, 0.3);
    const badge = host.querySelector('.fr-badge');
    if (badge) g.fromTo(badge, { scale: 0 }, { scale: 1, duration: 0.6, ease: 'back.out(3)', delay: 0.7, clearProps: 'all' });
  }
  /** سطر جديد وصل والصفحة مفتوحة: ينزلق داخلًا ويتوهّج لحظة. */
  function enterRows(list, all) {
    const g = motion();
    const rows = [...list.querySelectorAll('.fr-row')];
    const fresh = all ? rows.slice(0, 12) : rows.filter((r) => !shownRows.has(r.dataset.key));
    for (const r of rows) shownRows.add(r.dataset.key);
    if (!g || !fresh.length) {
      if (g) g.set(list, { clearProps: 'opacity,transform' });
      return;
    }
    g.set(list, { clearProps: 'opacity,transform' });
    g.fromTo(fresh, { opacity: 0, y: all ? 12 : -10 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out', stagger: 0.035, clearProps: 'all' });
    if (!all) for (const r of fresh) r.classList.add('fr-row--new');
  }

  async function refreshPresence() {
    try {
      presence = (await ctx.presence()) ?? [];
    } catch {
      return;
    }
    if (ctx.visible()) render();
  }

  return {
    show() {
      firstPaint = true;
      render();
      void refreshPresence();
      clearInterval(timer);
      timer = setInterval(() => {
        if (ctx.visible() && !document.hidden) void refreshPresence();
      }, 15_000);
    },
    hide() {
      clearInterval(timer);
      timer = null;
    },
    onChange(tables) {
      if (!ctx.visible()) return;
      if (tables.some((t) => ['frames', 'recommendations', 'activity', 'majlis_receipts', 'majlis_reactions', 'profiles', 'accounts', 'works'].includes(t))) render();
    },
    render,
  };
}
