/**
 * الأصدقاء — مدخل الاجتماع.
 *
 * ثلاث طبقات تفصلها المسافة ووزن الخط، لا الصناديق:
 *
 *   1. الأصدقاء: وجوههم وحالهم الآن. من يقرأ/يشاهد يظهر تحت الشريط بسطر
 *      فيه العمل نفسه (بطاقة العمل بلمسة) — أو «العمل مخفي» إن أخفاه.
 *   2. المجلس: صفّ محادثة واحد (صورته، اسمه، آخر رسالة، غير المقروء). المجلس
 *      نفسه شاشة أخرى؛ هذا بابه.
 *   3. آخر ما صار: سطور لقسمك الحالي (المانجا ترى المانجا، والأنمي الأنمي)،
 *      والمحادثة لكل الأقسام. ضغطة مطوّلة: إخفاء لدي، وحذف للجميع لما هو لك
 *      (أو لكل شيء إن كنت المالك) — والخادم هو الحكم.
 *
 * «نشاط القراءة ← إخفاء لدي» (الإعدادات) يُطبَّق هنا: مصفاتك أنت، لا تمسّ غيرك.
 */

import { glyph } from './icons.js';
import { displayTitle, refForTitle } from './work-ref.js';
import { actionList, dayLabel, el, motion, nameNode, onLongPress, parse, people, presenceState, pressable, roomInitial, shortAgo } from './social-kit.js';

const VERB_COPY = {
  CHAPTER_DONE: (p) => (p?.chapter != null ? `خلّص الفصل ${p.chapter} من` : 'خلّص فصلًا من'),
  EPISODE_DONE: (p) => (p?.episode != null ? `أنهى الحلقة ${p.episode} من` : 'أنهى حلقة من'),
  LIBRARY_ADD: () => 'أضاف لمكتبته',
  FAVORITED: () => 'أضاف للمفضلة',
  RATED_WORK: (p) => (p?.score ? `قيّم ${Math.round(p.score / 2)} من 5` : 'قيّم'),
  COMMENTED: () => 'علّق على',
};
const COMPLETION = new Set(['CHAPTER_DONE', 'EPISODE_DONE']);
const isAnime = (ref) => typeof ref === 'string' && ref.startsWith('anime:');

/** المصافي لكل قسم: المحادثة في الكل، والقراءة/المشاهدة لقسمها. */
export function feedFilters(anime, readingHidden = false) {
  return [
    ['all', 'الكل'],
    ['chat', 'الشات'],
    ['recs', 'الترشيحات'],
    ...(readingHidden ? [] : [['reading', anime ? 'المشاهدة' : 'القراءة']]),
  ];
}

/**
 * أحداث «آخر ما صار» لقسم واحد: بلا المحذوف للجميع، وبلا ما أخفيته لديك،
 * وبلا إنهاءات غيرك إن أخفيت «نشاط القراءة» لديك.
 */
export function feedEvents(sync, { anime, filter, me, readingHidden = false, limit = 80 }) {
  const hidden = new Set(sync.rows('majlis_hidden', (h) => h.user_id === me).map((h) => h.target));
  const out = [];
  for (const m of sync.rows('majlis_messages', (x) => !x.deleted && (x.kind === 'text' || x.kind === 'voice'))) out.push({ kind: 'msg', id: m.id, at: m.created_at, actor: m.sender_id, row: m });
  if (!anime) for (const f of sync.rows('frames', (x) => !x.removed)) out.push({ kind: 'frame', id: f.id, at: f.created_at, actor: f.from_id, row: f });
  for (const r of sync.rows('recommendations', (x) => !x.removed && isAnime(x.series_ref) === anime)) out.push({ kind: 'rec', id: r.id, at: r.created_at, actor: r.from_id, row: r });
  for (const a of sync.rows('activity', (x) => !x.removed && x.verb in VERB_COPY && isAnime(x.series_ref) === anime)) {
    if (readingHidden && COMPLETION.has(a.verb) && a.actor_id !== me) continue;
    out.push({ kind: 'activity', id: a.id, at: a.created_at, actor: a.actor_id, row: a });
  }
  const bucket = { msg: 'chat', frame: 'chat', rec: 'recs', activity: 'reading' };
  return out
    .filter((e) => !hidden.has(`${e.kind}:${e.id}`))
    .filter((e) => filter === 'all' || bucket[e.kind] === filter)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, limit);
}

/**
 * @param {{
 *   sync: any, host: HTMLElement, section: () => string,
 *   presence: () => Promise<any[]>,
 *   avatarNode: (person: object, size: number) => HTMLElement,
 *   mountImage: (container: HTMLElement, work: object) => Promise<unknown>,
 *   workFromRef: (ref: string, title?: string, cover?: string) => object,
 *   preview: (work: object, opts?: object) => void,
 *   openFrame: (id: string) => void, openProfile: (id: string) => void, openRoom: (focus?: string) => void,
 *   markSeen: (kind: string, id: string) => void,
 *   openSheet: Function, closeSheet: Function, toast: (t: string) => void,
 *   visible: () => boolean, mediaUrl: (key: string) => string,
 * }} ctx
 */
export function createFriends(ctx) {
  const { sync, host } = ctx;
  const kit = people(sync);
  const me = kit.me;
  let presence = [];
  let timer = null;
  let filter = 'all';
  let entered = false;
  const seenRows = new Set();

  const anime = () => ctx.section() === 'anime';
  const settings = () => parse(sync.row?.('settings', me())?.data, {});
  const readingHidden = () => settings().feedReading === 'hide';
  const presenceOf = (id) => presence.find((p) => p.userId === id) ?? null;
  const rank = (id) => ({ READING: 0, ONLINE: 1, IDLE: 2 })[presenceOf(id)?.status] ?? 3;
  const workOf = (ref, title, cover) => {
    const id = ref ?? refForTitle(title) ?? 'ext:عمل';
    const known = sync.rows('works', (w) => w.series_ref === id)[0];
    return ctx.workFromRef(id, known?.title ?? title, known?.cover_url ?? cover);
  };
  const titleOfWork = (w, fallback) => displayTitle(w.id, w.title?.english) || fallback || 'عمل';

  // ───────────────────────── الأصدقاء ─────────────────────────

  function face(id) {
    const p = presenceOf(id);
    const st = presenceState(p);
    const b = pressable(el('button', `sx-pal sx-pal--${st.tone}`));
    b.type = 'button';
    const pic = el('span', 'sx-pal-pic');
    pic.append(ctx.avatarNode(kit.personOf(id), 56));
    if (st.tone !== 'off') pic.append(el('span', 'sx-dot'));
    b.append(pic, nameNode(kit, id, { cls: 'sx-pal-name' }));
    b.append(el('span', 'sx-pal-state', st.verb));
    b.setAttribute('aria-label', `${kit.nameOf(id)}${st.verb ? `، ${st.verb}` : ''}`);
    b.onclick = () => ctx.openProfile(id);
    return b;
  }

  /** من يقرأ/يشاهد الآن في قسمك: سطر بالعمل، أو «العمل مخفي». */
  function nowRows() {
    const rows = presence.filter((p) => p.status === 'READING' && p.userId !== me() && presenceState(p).watching === anime());
    if (!rows.length) return null;
    const box = el('div', 'sx-now');
    for (const p of rows) {
      const st = presenceState(p);
      const row = el('button', 'sx-now-row');
      row.type = 'button';
      const text = el('span', 'sx-now-text');
      const who = el('span', 'sx-now-who');
      who.append(nameNode(kit, p.userId), document.createTextNode(` ${st.verb} الآن`));
      text.append(who);
      if (p.workHidden || !p.seriesTitle) {
        const hid = el('span', 'sx-now-title sx-now-title--hidden');
        hid.innerHTML = glyph('lock', { size: 13 });
        hid.append(el('span', null, 'العمل مخفي'));
        text.append(hid);
        row.disabled = true;
        row.append(el('span', 'sx-now-live'), text);
      } else {
        const work = workOf(p.seriesRef, p.seriesTitle);
        const cover = el('span', 'sx-cover sx-cover--sm');
        void ctx.mountImage(cover, work);
        const title = el('bdi', 'sx-now-title', p.seriesTitle);
        text.append(title);
        if (p.chapterLabel) text.append(el('span', 'sx-now-sub', p.chapterLabel));
        row.append(cover, text);
        row.onclick = () => ctx.preview(work, p.chapterLabel ? { chapter: { label: p.chapterLabel, number: p.chapterNumber ?? null } } : {});
        pressable(row, 0.985);
      }
      box.append(row);
    }
    return box;
  }

  // ───────────────────────── باب المجلس ─────────────────────────

  function roomLast() {
    const hidden = new Set(sync.rows('majlis_hidden', (h) => h.user_id === me()).map((h) => h.target));
    const items = [
      ...sync.rows('majlis_messages', (m) => !hidden.has(`msg:${m.id}`)).map((m) => ({
        at: m.created_at,
        who: m.sender_id,
        text: m.deleted ? 'حُذفت رسالة' : m.kind === 'voice' ? 'رسالة صوتية' : m.body,
        voice: m.kind === 'voice' && !m.deleted,
      })),
      ...sync.rows('recommendations', (r) => !r.removed && !hidden.has(`rec:${r.id}`)).map((r) => ({ at: r.created_at, who: r.from_id, text: `رشّح ${r.series_title || 'عملًا'}` })),
      ...sync.rows('frames', (f) => !f.removed && !hidden.has(`frame:${f.id}`)).map((f) => ({ at: f.created_at, who: f.from_id, text: `فريم من ${f.series_title || 'عمل'}` })),
    ];
    return items.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0] ?? null;
  }
  function unread() {
    const readAt = sync.rows('majlis_reads', (r) => r.user_id === me())[0]?.read_at ?? 0;
    const mine = me();
    const after = (x, who) => (x.created_at ?? 0) > readAt && who !== mine;
    return (
      sync.rows('majlis_messages', (m) => !m.deleted && after(m, m.sender_id)).length +
      sync.rows('recommendations', (r) => !r.removed && after(r, r.from_id)).length +
      sync.rows('frames', (f) => !f.removed && after(f, f.from_id)).length
    );
  }
  function door() {
    const meta = sync.rows('majlis_meta', (m) => m.id === 'main')[0];
    const b = pressable(el('button', 'sx-door'), 0.985);
    b.type = 'button';
    const pic = el('span', 'sx-door-pic');
    if (meta?.avatar_key) {
      const img = new Image();
      img.alt = '';
      img.src = ctx.mediaUrl(meta.avatar_key);
      pic.append(img);
    } else {
      pic.classList.add('is-initial');
      pic.textContent = roomInitial(meta?.name);
    }
    const text = el('span', 'sx-door-text');
    const top = el('span', 'sx-door-top');
    top.append(el('b', 'sx-door-name', meta?.name || 'المجلس'));
    const last = roomLast();
    if (last) top.append(el('time', 'sx-door-time', shortAgo(last.at)));
    const line = el('span', 'sx-door-line');
    if (last) {
      line.append(nameNode(kit, last.who, { cls: 'sx-door-who', you: true }), document.createTextNode(': '));
      if (last.voice) line.insertAdjacentHTML('beforeend', glyph('mic', { size: 13 }));
      const t = el('bdi', null, last.text);
      line.append(t);
    } else line.textContent = `${kit.memberIds().length} أعضاء · ابدأ الكلام`;
    const bottom = el('span', 'sx-door-bottom');
    bottom.append(line);
    const n = unread();
    if (n) bottom.append(el('span', 'sx-unread', n > 99 ? '99+' : String(n)));
    text.append(top, bottom);
    b.append(pic, text);
    b.setAttribute('aria-label', `${meta?.name || 'المجلس'}${n ? `، ${n} غير مقروءة` : ''}`);
    b.onclick = () => ctx.openRoom();
    return b;
  }

  // ───────────────────────── آخر ما صار ─────────────────────────

  function feedRow(e) {
    const r = e.row;
    const row = el('div', 'sx-row');
    row.dataset.key = `${e.kind}:${e.id}`;
    const main = el('button', 'sx-row-main');
    main.type = 'button';
    const pic = el('span', 'sx-row-pic');
    pic.append(ctx.avatarNode(kit.personOf(e.actor), 34));
    const text = el('span', 'sx-row-text');
    const line = el('span', 'sx-row-line');
    line.append(nameNode(kit, e.actor, { you: true }), document.createTextNode(' '));
    let work = null;
    let chapter = null;
    let sub = null;
    if (e.kind === 'msg') {
      line.append(document.createTextNode('في المجلس'));
      sub = r.kind === 'voice' ? 'رسالة صوتية' : r.body;
    } else if (e.kind === 'frame') {
      line.append(document.createTextNode('أرسل فريم من'));
      work = workOf(null, r.series_title, r.cover_url);
      chapter = r.chapter_label || null;
    } else if (e.kind === 'rec') {
      const to = !r.to_id ? 'للكل' : r.to_id === me() ? 'لك' : `لـ${kit.nameOf(r.to_id)}`;
      line.append(document.createTextNode(`رشّح ${to}`));
      work = workOf(r.series_ref, r.series_title, r.cover_url);
      chapter = r.chapter_label || null;
      sub = r.message || null;
    } else {
      line.append(document.createTextNode(VERB_COPY[r.verb](parse(r.payload, {}))));
      if (r.series_ref) work = workOf(r.series_ref);
    }
    if (work) {
      const title = el('bdi', 'sx-row-work', titleOfWork(work, r.series_title));
      line.append(document.createTextNode(' '), title);
    }
    text.append(line);
    if (chapter) text.append(el('span', 'sx-row-meta', chapter));
    if (sub) {
      const q = el('span', 'sx-row-quote', sub);
      q.dir = 'auto';
      text.append(q);
    }
    text.append(el('time', 'sx-row-time', shortAgo(e.at)));
    main.append(pic, text);
    if (work) {
      const cover = el('span', 'sx-cover');
      void ctx.mountImage(cover, work);
      main.append(cover);
    }
    main.onclick = () => {
      if (e.kind === 'msg') return ctx.openRoom(`msg:${r.id}`);
      if (e.kind === 'frame') {
        ctx.markSeen('frame', r.id);
        return ctx.openFrame(r.id);
      }
      if (work) {
        if (e.kind === 'rec') ctx.markSeen('rec', r.id);
        ctx.preview(work, chapter ? { chapter: { label: chapter, number: r.chapter_number ?? null } } : {});
      }
    };
    onLongPress(main, () => openRowActions(e, row, work));
    row.append(main);
    return row;
  }

  function openRowActions(e, rowNode, work) {
    const canDelete = e.actor === me() || kit.isOwner(me());
    const target = `${e.kind}:${e.id}`;
    ctx.openSheet((body) => {
      body.append(
        actionList(
          [
            e.kind === 'msg' ? { icon: glyph('members'), label: 'افتح في المجلس', run: () => ctx.openRoom(target) } : null,
            work && e.kind !== 'msg' ? { icon: glyph('book'), label: 'افتح العمل', run: () => ctx.preview(work) } : null,
            {
              icon: glyph('eye'),
              label: 'إخفاء لدي',
              run: () => {
                sync.enqueue('majlis.delete', { target, scope: 'me' });
                collapse(rowNode, 'اختفى من عندك فقط');
              },
            },
            canDelete
              ? {
                  icon: glyph('trash'),
                  label: e.actor === me() ? 'حذف للجميع' : 'حذف للجميع (المالك)',
                  danger: true,
                  run: () => {
                    sync.enqueue('majlis.delete', { target, scope: 'everyone' });
                    collapse(rowNode, 'انحذف عند الكل');
                  },
                }
              : null,
          ],
          ctx.closeSheet,
        ),
      );
    });
  }

  function collapse(node, message) {
    const g = motion();
    const done = () => {
      render();
      ctx.toast(message);
    };
    if (!g) return done();
    g.timeline({ onComplete: done })
      .to(node, { opacity: 0, duration: 0.16, ease: 'power1.in' })
      .to(node, { height: 0, paddingTop: 0, paddingBottom: 0, duration: 0.22, ease: 'power2.inOut' });
  }

  function tabs(onPick) {
    const bar = el('div', 'sx-tabs');
    bar.setAttribute('role', 'tablist');
    const line = el('span', 'sx-tabs-line');
    for (const [k, label] of feedFilters(anime(), readingHidden())) {
      const t = el('button', `sx-tab${k === filter ? ' is-on' : ''}`, label);
      t.type = 'button';
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(k === filter));
      t.onclick = () => {
        if (filter === k) return;
        filter = k;
        for (const x of bar.querySelectorAll('.sx-tab')) {
          x.classList.toggle('is-on', x === t);
          x.setAttribute('aria-selected', String(x === t));
        }
        placeLine(bar, true);
        onPick();
      };
      bar.append(t);
    }
    bar.append(line);
    requestAnimationFrame(() => placeLine(bar, false));
    return bar;
  }
  /** الخط تحت المصفاة المختارة ينزلق إليها. */
  function placeLine(bar, animate) {
    const on = bar.querySelector('.sx-tab.is-on');
    const line = bar.querySelector('.sx-tabs-line');
    if (!on || !line) return;
    const to = { x: on.offsetLeft + 10, width: Math.max(0, on.offsetWidth - 20) };
    const g = motion();
    if (animate && g) g.to(line, { ...to, duration: 0.3, ease: 'power3.out' });
    else Object.assign(line.style, { transform: `translateX(${to.x}px)`, width: `${to.width}px` });
  }

  function feedList() {
    const list = el('div', 'sx-feed');
    const events = feedEvents(sync, { anime: anime(), filter, me: me(), readingHidden: readingHidden() });
    if (!events.length) {
      const empty = el('p', 'sx-empty', filter === 'recs' ? 'أول ترشيح بيظهر هنا' : filter === 'chat' ? 'المجلس هادي. قل شي' : 'لسه ما صار شي هنا');
      list.append(empty);
      return list;
    }
    // رسائل المجلس المتتالية سطرٌ واحد: «آخر ما صار» ملخّص، والمحادثة نفسها في المجلس
    let day = null;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const d = dayLabel(e.at ?? 0);
      if (d !== day) {
        day = d;
        list.append(el('div', 'sx-day', d));
      }
      if (e.kind === 'msg') {
        const run = [e];
        while (events[i + 1]?.kind === 'msg' && dayLabel(events[i + 1].at ?? 0) === d) run.push(events[++i]);
        list.append(run.length > 1 ? chatRun(run) : feedRow(e));
        continue;
      }
      list.append(feedRow(e));
    }
    return list;
  }

  /** عدة رسائل متتالية: من تكلّم، وآخر ما قيل، وكم رسالة. */
  function chatRun(run) {
    const last = run[0];
    const row = el('div', 'sx-row');
    row.dataset.key = `run:${last.id}`;
    const main = el('button', 'sx-row-main');
    main.type = 'button';
    const pics = el('span', 'sx-row-pics');
    const who = [...new Set(run.map((e) => e.actor))];
    for (const id of who.slice(0, 3)) pics.append(ctx.avatarNode(kit.personOf(id), 26));
    const text = el('span', 'sx-row-text');
    const line = el('span', 'sx-row-line');
    who.slice(0, 3).forEach((id, i) => {
      if (i) line.append(document.createTextNode('، '));
      line.append(nameNode(kit, id, { you: true }));
    });
    line.append(document.createTextNode(` في المجلس · ${run.length} رسائل`));
    const q = el('span', 'sx-row-quote', last.row.kind === 'voice' ? 'رسالة صوتية' : last.row.body);
    q.dir = 'auto';
    text.append(line, q, el('time', 'sx-row-time', shortAgo(last.at)));
    main.append(pics, text);
    main.onclick = () => ctx.openRoom(`msg:${last.id}`);
    row.append(main);
    return row;
  }

  // ───────────────────────── الرسم ─────────────────────────

  function heading(text, extra) {
    const h = el('div', 'sx-heading');
    h.append(el('h2', null, text));
    if (extra) h.append(extra);
    return h;
  }

  function render() {
    const keepScroll = host.querySelector('.sx-strip')?.scrollLeft ?? 0;
    const parts = [];
    const ids = kit.friendIds().sort((a, b) => rank(a) - rank(b) || kit.nameOf(a).localeCompare(kit.nameOf(b), 'ar'));

    const friends = el('section', 'sx-section sx-friends');
    const live = ids.filter((id) => rank(id) < 3).length;
    friends.append(heading('الأصدقاء', el('span', 'sx-heading-meta', live ? `${live} الآن` : '')));
    if (ids.length) {
      const strip = el('div', 'sx-strip');
      strip.append(...ids.map(face));
      friends.append(strip);
      const now = nowRows();
      if (now) friends.append(now);
    } else friends.append(el('p', 'sx-empty', 'أصدقاؤك يظهرون هنا أول ما يدخلون'));
    parts.push(friends);

    const room = el('section', 'sx-section sx-room');
    room.append(door());
    parts.push(room);

    const feed = el('section', 'sx-section sx-feed-section');
    if (!feedFilters(anime(), readingHidden()).some(([k]) => k === filter)) filter = 'all';
    let list = feedList();
    const bar = tabs(() => {
      const next = feedList();
      const g = motion();
      if (!g) {
        list.replaceWith(next);
        list = next;
        return;
      }
      g.to(list, {
        opacity: 0,
        duration: 0.12,
        onComplete: () => {
          list.replaceWith(next);
          list = next;
          reveal([...next.children].slice(0, 14), 0);
        },
      });
    });
    feed.append(heading('آخر ما صار'), bar, list);
    parts.push(feed);

    host.replaceChildren(...parts);
    const strip = host.querySelector('.sx-strip');
    if (strip) strip.scrollLeft = keepScroll;

    const rows = [...host.querySelectorAll('.sx-row')];
    if (!entered) {
      entered = true;
      for (const r of rows) seenRows.add(r.dataset.key);
      const g = motion();
      g?.fromTo(host.querySelectorAll('.sx-pal'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.36, ease: 'power2.out', stagger: 0.035, clearProps: 'all' });
      g?.fromTo(host.querySelector('.sx-door'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.36, ease: 'power2.out', delay: 0.08, clearProps: 'all' });
      reveal(rows.slice(0, 14), 0.14);
    } else {
      const fresh = rows.filter((r) => !seenRows.has(r.dataset.key));
      for (const r of rows) seenRows.add(r.dataset.key);
      if (fresh.length) {
        reveal(fresh, 0);
        for (const r of fresh) r.classList.add('sx-row--fresh');
      }
    }
  }
  function reveal(nodes, delay) {
    motion()?.fromTo(nodes, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out', stagger: 0.025, delay, clearProps: 'all' });
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
      entered = false;
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
      const watched = ['frames', 'recommendations', 'activity', 'majlis_messages', 'majlis_hidden', 'majlis_meta', 'majlis_reads', 'profiles', 'accounts', 'works', 'settings'];
      if (tables.some((t) => watched.includes(t))) render();
    },
    render,
  };
}
