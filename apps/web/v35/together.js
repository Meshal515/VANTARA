/**
 * VANTARA Together — الواجهة: الدعوة بالأفاتارات، بطاقة الشات، الأفاتارات داخل
 * شريط المشغّل/القارئ، لوحة الغرفة، والتنبيهات.
 *
 * لا رموز ولا أرقام يراها أحد: تضغط على أفاتارات من تريد ثم «أرسل»، فتصل بطاقة
 * لمن اخترتهم في المجلس. «دخول» يفتح نفس الحلقة/الفصل عندك من سيرفرك، فإن كانت
 * الغرفة بدأت تدخل على طول عند الثانية الحالية، وإلا «جاري التجهيز» ثم «جاهز».
 *
 * جلسة واحدة نشطة في كل وقت (`session`). المشغّل والقارئ يسألانها: هل أنا في
 * غرفة لهذا المحتوى؟ ويربطان أنفسهما بها.
 */

import { glyph } from './icons.js';
import { createRoom, joinRoom, roomInfo } from '../lib/together/room.js';
import { clockLabel, memberPosition } from '../lib/together/sync.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
};
const button = (cls, html, run, label) => {
  const b = el('button', cls);
  b.type = 'button';
  b.innerHTML = html;
  if (label) b.setAttribute('aria-label', label);
  b.onclick = run;
  return b;
};

/** نوع الغرفة كما يظهر في بطاقة الشات وعنوان اللوحة. */
export function kindLabel(media, mode) {
  const reading = media?.kind === 'manga';
  const verb = reading ? 'قراءة معًا' : 'مشاهدة معًا';
  return `${verb} · ${mode === 'free' ? 'منفصلة' : 'متزامنة'}`;
}

/** حالة شخص بكلمات المستخدم. */
export function stateLabel(state, kind = 'anime') {
  const reading = kind === 'manga';
  switch (state) {
    case 'preparing': return reading ? 'جاري تجهيز الفصل…' : 'جاري تجهيز الحلقة…';
    case 'ready': return 'جاهز';
    case 'playing': return reading ? 'يقرأ' : 'يشاهد';
    case 'paused': return 'متوقف';
    case 'buffering': return 'يحمّل…';
    case 'failed': return 'تعذّر السيرفر';
    default: return '';
  }
}

/** تنبيه قصير لتغيّر حالة غيرك. null = لا يستحق تنبيهًا. */
export function statusToast(msg, kind = 'anime') {
  const name = msg?.name || 'صديق';
  if (msg?.state === 'playing') return kind === 'manga' ? `${name} بدأ القراءة` : `اشتغل الفيديو عند ${name}`;
  if (msg?.state === 'failed') return `تعذّر تشغيل السيرفر عند ${name}${msg.source ? ` (${msg.source})` : ''}`;
  if (msg?.state === 'ready') return `${name} جاهز`;
  return null;
}

/** «صفحة 12 · الفصل 110» أو «12:04» لموقع شخص في اللوحة. */
export function positionLabel(member, media, serverNow) {
  if (member?.pos == null) return '';
  if (media?.kind === 'manga') {
    const chapter = /#([^#]+)$/.exec(member.mediaKey ?? '')?.[1] ?? null;
    return `صفحة ${Math.round(member.pos) + 1}${chapter ? ` · الفصل ${chapter}` : ''}`;
  }
  return clockLabel(memberPosition(member, serverNow));
}

/** 3 أفاتارات ثم «+N». */
export function stripPeople(roster, max = 3) {
  const people = [...roster].sort((a, b) => Number(b.host) - Number(a.host) || a.joinedAt - b.joinedAt);
  return { shown: people.slice(0, max), more: Math.max(0, people.length - max) };
}

/**
 * @param {{
 *   sync: any,
 *   baseUrl: () => string,
 *   friends: () => Array<{userId: string, displayName: string, avatarKey: string|null}>,
 *   avatarNode: (person: any, size: number) => HTMLElement,
 *   openSheet: (build: (body: HTMLElement) => any, opts?: any) => void,
 *   closeSheet: () => void,
 *   toast: (text: string) => void,
 *   openMedia: (media: any, session: any) => void,
 *   joinRoomImpl?: typeof joinRoom,
 *   createRoomImpl?: typeof createRoom,
 *   roomInfoImpl?: typeof roomInfo,
 * }} deps
 */
export function createTogether(deps) {
  const join = deps.joinRoomImpl ?? joinRoom;
  const create = deps.createRoomImpl ?? createRoom;
  const info = deps.roomInfoImpl ?? roomInfo;
  const token = () => deps.sync.authorizationHeader?.replace(/^Bearer\s+/i, '') ?? null;
  const listeners = new Set();
  let session = null;
  // القارئ والمشغّل شاشات فوق الواجهة لها أوراقها وتنبيهاتها: ما يُفتح يظهر في الشاشة الظاهرة
  const surfaces = [];
  const ui = () => surfaces.at(-1) ?? deps;

  const emit = () => { for (const fn of listeners) try { fn(session); } catch { /* */ } };
  const personOf = (r) => ({ userId: r.userId, displayName: r.name, avatarKey: r.avatarKey });

  /** كبسولة صغيرة أعلى الشاشة: وجه الشخص ينزلق مع «دحمي دخل»، ثم تختفي وحدها. */
  function pop(person, text, tone = '') {
    if (typeof document === 'undefined' || !document.body) return ui().toast(text);
    const box = el('div', `tg-pop${tone ? ` is-${tone}` : ''}`);
    box.setAttribute('role', 'status');
    if (person) box.append(deps.avatarNode(person, 24));
    box.append(el('span', null, text));
    document.body.append(box);
    requestAnimationFrame(() => box.classList.add('is-in'));
    setTimeout(() => { box.classList.remove('is-in'); setTimeout(() => box.remove(), 320); }, 2400);
  }
  const personByName = (s, name) => {
    const r = s.room.roster.find((x) => x.name === name);
    return r ? personOf(r) : { displayName: name, avatarKey: null };
  };

  function start(code, media, mode) {
    leave();
    const room = join({ baseUrl: deps.baseUrl(), code, getToken: token });
    const s = { code, media, mode, room, strips: new Set(), offs: [] };
    session = s;
    const kind = () => (s.room.timeline?.media ?? s.media)?.kind ?? 'anime';
    s.offs.push(room.on('joined', (m) => pop({ displayName: m.name, avatarKey: m.avatarKey ?? null }, `${m.name} دخل`, 'in')));
    s.offs.push(room.on('left', (m) => pop(personByName(s, m.name), `${m.name} طلع`)));
    s.offs.push(room.on('status', (m) => {
      if (m.userId === room.me) return;
      const text = statusToast(m, kind());
      if (text) pop(personByName(s, m.name), text, m.state === 'failed' ? 'bad' : m.state === 'playing' ? 'ok' : '');
    }));
    s.offs.push(room.on('host', (id) => { if (id === room.me) ui().toast('صرت المضيف'); }));
    s.offs.push(room.on('connection', (c) => {
      if (c === 'full') ui().toast('الغرفة ممتلئة');
      else if (c === 'gone') ui().toast('انتهت الغرفة');
      else if (c === 'uninvited') ui().toast('هالغرفة لأشخاص محددين');
      else if (c === 'replaced') ui().toast('دخلت الغرفة من جهاز ثاني');
      if (['full', 'gone', 'uninvited', 'replaced'].includes(c)) leave();
    }));
    s.offs.push(room.on('room', (r) => { s.mode = r.mode; paintStrips(); }));
    s.offs.push(room.on('roster', paintStrips));
    s.offs.push(room.on('state', ({ state }) => { if (state?.media) s.media = state.media; }));
    emit();
    return s;
  }

  function leave() {
    if (!session) return;
    const s = session;
    session = null;
    for (const off of s.offs) off();
    s.room.close();
    for (const node of s.strips) node.replaceChildren();
    emit();
  }

  // ───────────── الدعوة: اضغط على الأفاتارات ثم «أرسل» ─────────────

  function openInvite(media, { onStarted = null } = {}) {
    const picked = new Set();
    let everyone = false;
    let mode = 'sync';
    ui().openSheet((body) => {
      body.classList.add('tg-sheet');
      const head = el('div', 'tg-head');
      head.append(el('h3', null, media.kind === 'manga' ? 'اقرأ مع أصدقائك' : 'شاهد مع أصدقائك'));
      const what = el('p', null, media.label);
      what.dir = 'auto';
      head.append(what);

      const grid = el('div', 'tg-people');
      const faces = [];
      const everyoneBtn = el('button', 'tg-person');
      everyoneBtn.type = 'button';
      const allFace = el('span', 'avatar-letter tg-all');
      allFace.innerHTML = glyph('users', { size: 24 });
      everyoneBtn.append(allFace, el('span', null, 'الكل'));
      grid.append(everyoneBtn);
      for (const f of deps.friends()) {
        const b = el('button', 'tg-person');
        b.type = 'button';
        b.dataset.user = f.userId;
        b.append(deps.avatarNode(f, 58), el('span', null, f.displayName));
        b.onclick = () => {
          everyone = false;
          picked.has(f.userId) ? picked.delete(f.userId) : picked.add(f.userId);
          paint();
        };
        faces.push(b);
        grid.append(b);
      }
      everyoneBtn.onclick = () => {
        everyone = !everyone;
        picked.clear();
        paint();
      };

      const modes = el('div', 'tg-modes');
      const modeBtn = (value, title, hint) => {
        const b = el('button', 'tg-mode');
        b.type = 'button';
        b.dataset.mode = value;
        b.append(el('b', null, title), el('span', null, hint));
        b.onclick = () => { mode = value; paint(); };
        return b;
      };
      const reading = media.kind === 'manga';
      modes.append(
        modeBtn('sync', 'متزامنة', reading ? 'الكل على صفحة المضيف' : 'الكل مع المضيف: تشغيل وإيقاف وتقديم'),
        modeBtn('free', 'منفصلة', reading ? 'كل واحد بسرعته وتشوف وين وصلوا' : 'كل واحد بوقته وتشوف وين وصلوا'),
      );

      const send = el('button', 'btn btn-primary btn-block tg-send');
      send.type = 'button';
      send.onclick = async () => {
        const invitees = everyone ? '*' : [...picked];
        if (!everyone && !picked.size) return;
        send.disabled = true;
        try {
          const code = await create({ baseUrl: deps.baseUrl(), token: token(), invite: invitees, mode, media });
          deps.sync.enqueue('together.invite', { code, invitees, mode, media });
          ui().closeSheet();
          const n = everyone ? 'الكل' : picked.size === 1 ? deps.friends().find((f) => picked.has(f.userId))?.displayName : `${picked.size} أشخاص`;
          ui().toast(`انرسلت الدعوة لـ${n}`);
          start(code, media, mode);
          if (onStarted) onStarted(session);
          else deps.openMedia(media, session);
        } catch (error) {
          send.disabled = false;
          ui().toast(error?.status === 401 ? 'سجّل دخولك من جديد' : 'ما قدرنا ننشئ الغرفة، جرّب بعد لحظة');
        }
      };

      const paint = () => {
        everyoneBtn.classList.toggle('is-on', everyone);
        for (const b of faces) b.classList.toggle('is-on', everyone || picked.has(b.dataset.user));
        for (const b of modes.children) b.classList.toggle('is-on', b.dataset.mode === mode);
        const count = everyone ? deps.friends().length : picked.size;
        send.disabled = count === 0;
        send.innerHTML = `${glyph('send')}<span>${count ? `أرسل (${everyone ? 'الكل' : count})` : 'اختر من تدعو'}</span>`;
      };
      body.append(head, grid, modes, send);
      if (!deps.friends().length) body.append(el('p', 'tg-empty', 'ما فيه أحد غيرك في التطبيق بعد.'));
      paint();
    });
  }

  // ───────────── بطاقة الدعوة في المجلس ─────────────

  function card(row) {
    const media = (() => { try { return JSON.parse(row.media_json); } catch { return null; } })();
    const reading = media?.kind === 'manga';
    const wrap = el('div', `tg-card tg-card--${media?.kind ?? 'anime'}`);
    // الرأس: نوع الغرفة وحالتها الحية (مباشر / يتجهّزون / انتهت)
    const top = el('div', 'tg-card-top');
    const icon = el('span', 'tg-card-icon');
    icon.innerHTML = reading
      ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.2v5.6l4.6-2.8z" fill="currentColor"/></svg>';
    const kind = el('span', 'tg-card-kind', kindLabel(media, row.mode));
    const live = el('span', 'tg-live', '…');
    top.append(icon, kind, live);
    // غلاف العمل بجانب العنوان
    const body = el('div', 'tg-card-body');
    const cover = el('span', 'tg-card-cover');
    const coverUrl = media?.cover ?? deps.sync.rows?.('works', (w) => w.series_ref === media?.seriesRef)?.[0]?.cover_url ?? null;
    if (coverUrl) {
      const img = new Image();
      img.alt = '';
      img.loading = 'lazy';
      img.src = coverUrl;
      img.onerror = () => cover.classList.add('is-empty');
      cover.append(img);
    } else cover.classList.add('is-empty');
    const title = el('bdi', 'tg-card-title', media?.label ?? 'دعوة');
    const who = el('div', 'tg-card-who');
    const people = el('div', 'tg-card-people');
    const status = el('span', 'tg-card-status');
    who.append(people, status);
    const enter = el('button', 'tg-enter');
    enter.type = 'button';
    enter.innerHTML = `${glyph('play', { size: 16 })}<span>دخول</span>`;
    const mine = row.host_id === deps.sync.user?.userId;
    let alive = null;
    enter.onclick = () => {
      if (alive === false) return;
      // في الغرفة أصلًا: نفس الجلسة، بلا إعادة اتصال
      if (session?.code === row.code) {
        deps.openMedia(session.media, session);
        return;
      }
      const s = start(row.code, media, row.mode);
      deps.openMedia(media, s);
    };
    const text = el('div', 'tg-card-text');
    text.append(title, who);
    body.append(cover, text);
    wrap.append(top, body, enter);
    void info({ baseUrl: deps.baseUrl(), token: token(), code: row.code }).then((r) => {
      alive = r != null;
      if (!r) {
        wrap.classList.add('is-over');
        live.textContent = 'انتهت';
        status.textContent = 'انتهت الغرفة';
        enter.disabled = true;
        enter.querySelector('span').textContent = 'انتهت';
        return;
      }
      const started = Boolean(r.state?.started);
      wrap.classList.toggle('is-live', started && r.people.length > 0);
      live.textContent = !r.people.length ? 'فاضية' : started ? 'مباشر' : 'يتجهّزون';
      const { shown, more } = stripPeople(r.people.map((p) => ({ ...p, joinedAt: 0 })));
      people.replaceChildren(...shown.map((p) => {
        const f = el('span', 'tg-card-face');
        f.append(deps.avatarNode({ displayName: p.name, avatarKey: p.avatarKey }, 28));
        return f;
      }));
      if (more) { const m = el('span', 'tg-card-face tg-more', `+${more}`); m.dir = 'ltr'; people.append(m); }
      const names = r.people.slice(0, 2).map((p) => p.name).join('، ');
      status.textContent = !r.people.length
        ? 'ما فيه أحد داخل الحين'
        : `${names}${r.people.length > 2 ? ` و${r.people.length - 2} غيرهم` : ''} ${started ? (reading ? 'يقرؤون الحين' : 'يشاهدون الحين') : 'يتجهّزون'}`;
      if (session?.code === row.code || (mine && !session)) enter.querySelector('span').textContent = 'ارجع للغرفة';
    }).catch(() => { live.textContent = ''; });
    return wrap;
  }

  // ───────────── الأفاتارات في شريط المشغّل/القارئ ─────────────

  /** يملأ `host` بثلاثة أفاتارات و«+N»؛ يتحدّث وحده. الضغط يفتح لوحة الغرفة. */
  function mountStrip(host) {
    if (!session) return () => {};
    host.classList.add('tg-strip');
    session.strips.add(host);
    host.onclick = () => openPanel();
    paintStrip(host);
    const s = session;
    return () => s.strips.delete(host);
  }

  function paintStrips() {
    if (!session) return;
    for (const host of session.strips) paintStrip(host);
  }

  function paintStrip(host) {
    const roster = session?.room.roster ?? [];
    const { shown, more } = stripPeople(roster);
    const known = new Set([...host.querySelectorAll('[data-user]')].map((n) => n.dataset.user));
    const first = !host.querySelector('[data-user]');
    const nodes = shown.map((r) => {
      const node = el('span', `tg-face${r.state === 'failed' ? ' is-failed' : r.state === 'preparing' || r.state === 'buffering' ? ' is-busy' : ''}`);
      node.dataset.user = r.userId;
      node.append(deps.avatarNode(personOf(r), 26));
      // دخل الحين: ينزلق بنعومة في مكانه
      if (!first && !known.has(r.userId)) node.classList.add('is-new');
      return node;
    });
    if (more) {
      const m = el('span', 'tg-face tg-more', `+${more}`);
      m.dir = 'ltr';
      nodes.push(m);
    }
    const faces = el('span', 'tg-faces');
    faces.append(...nodes);
    const dot = el('i', `tg-dot${roster.some((r) => r.state === 'failed') ? ' is-bad' : ''}`);
    host.replaceChildren(dot, faces);
    host.setAttribute('aria-label', `في الغرفة ${roster.length}`);
    host.setAttribute('role', 'button');
  }

  // ───────────── لوحة الغرفة ─────────────

  function openPanel() {
    if (!session) return;
    const s = session;
    ui().openSheet((body) => {
      body.classList.add('tg-sheet');
      const head = el('div', 'tg-head');
      const media = s.room.timeline?.media ?? s.media;
      const titleRow = el('div', 'tg-head-row');
      titleRow.append(el('h3', null, kindLabel(media, s.room.info?.mode ?? s.mode)));
      const count = el('span', 'tg-live tg-live--on');
      titleRow.append(count);
      head.append(titleRow);
      const what = el('p', null, media?.label ?? '');
      what.dir = 'auto';
      head.append(what);
      const list = el('div', 'tg-list');
      const actions = el('div', 'tg-actions');
      body.append(head, list, actions);
      const paint = () => {
        const now = s.room.clock.serverNow();
        count.textContent = `${s.room.roster.length} في الغرفة`;
        list.replaceChildren(...s.room.roster.map((r) => {
          const row = el('div', 'tg-row');
          const who = el('div', 'tg-row-who');
          const face = el('span', `tg-row-face is-${r.state}`);
          face.append(deps.avatarNode(personOf(r), 40));
          who.append(face);
          const names = el('div', 'tg-row-names');
          names.append(el('b', null, r.userId === s.room.me ? 'أنت' : r.name));
          const line = [stateLabel(r.state, media?.kind), r.source].filter(Boolean).join(' · ');
          names.append(el('span', `tg-row-state is-${r.state}`, line));
          who.append(names);
          const where = el('div', 'tg-row-where');
          where.append(el('span', 'tg-row-pos', positionLabel(r, media, now)));
          if (r.host) where.append(el('span', 'tg-badge', 'المضيف'));
          if (r.sameVersion === false) where.append(el('span', 'tg-badge is-warn', 'نسخة مختلفة'));
          if ((s.room.info?.mode ?? s.mode) === 'sync' && r.driftMs != null && !r.host && media?.kind !== 'manga') {
            where.append(el('span', 'tg-drift', `فرق ${Math.abs(r.driftMs)}ms`));
          }
          row.append(who, where);
          return row;
        }));
        actions.replaceChildren();
        if (s.room.isHost) {
          const mode = s.room.info?.mode ?? s.mode;
          actions.append(button('tg-action', `${glyph('refresh', { size: 18 })}<span>${mode === 'sync' ? 'حوّلها منفصلة' : 'حوّلها متزامنة'}</span>`, () => s.room.setMode(mode === 'sync' ? 'free' : 'sync')));
        }
        actions.append(button('tg-action tg-leave', `${glyph('back', { size: 18 })}<span>اطلع من الغرفة</span>`, () => { ui().closeSheet(); leave(); ui().toast('طلعت من الغرفة'); }));
      };
      paint();
      const offs = [s.room.on('roster', paint), s.room.on('room', paint)];
      const timer = setInterval(paint, 1000);
      return () => { for (const off of offs) off(); clearInterval(timer); };
    });
  }

  return {
    get session() { return session; },
    /** شاشة فوق الواجهة (القارئ) تستلم الأوراق والتنبيهات حتى تُغلق. */
    useSurface(surface) {
      surfaces.push(surface);
      return () => { const i = surfaces.lastIndexOf(surface); if (i >= 0) surfaces.splice(i, 1); };
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    openInvite,
    card,
    mountStrip,
    openPanel,
    leave,
    /** هل الجلسة النشطة لهذا العمل (و/أو هذه الحلقة)؟ */
    matches(seriesRef, episode = null) {
      const m = session?.room.timeline?.media ?? session?.media;
      if (!session || session.media?.seriesRef !== seriesRef) return false;
      if (episode == null) return true;
      const n = Number(/#([^#]+)$/.exec(m?.key ?? '')?.[1] ?? session.media.episode);
      return n === Number(episode);
    },
    /**
     * المشغّل الأصلي يتصل بالغرفة بنفسه (يبقى متصلًا والشاشة مقفلة)، فاتصال الويب
     * يُغلق بهدوء قبله: نفس الحساب باتصالين كان سيطرد أحدهما الآخر.
     */
    handOff(seriesRef) {
      if (!session || session.media?.seriesRef !== seriesRef) return null;
      const cfg = { baseUrl: deps.baseUrl(), code: session.code, token: token(), mode: session.room.info?.mode ?? session.mode, mediaPrefix: seriesRef };
      const s = session;
      session = null;
      for (const off of s.offs) off();
      s.room.close();
      emit();
      return cfg;
    },
    /** يُستدعى من رابط/إشعار «#together=CODE». */
    joinByCode(code, row) {
      if (session?.code === code) return deps.openMedia(session.media, session);
      const media = row ? (() => { try { return JSON.parse(row.media_json); } catch { return null; } })() : null;
      if (!media) return ui().toast('ما لقينا الدعوة، افتحها من المجلس');
      deps.openMedia(media, start(code, media, row.mode));
    },
  };
}

/**
 * جسر القارئ: صفحة المضيف تحرّك الجميع في الوضع المتزامن، وفي المنفصل كلٌّ بسرعته
 * واللوحة تبيّن وين وصل كل واحد. `pos` رقم الصفحة، والفصل في `media.key`.
 */
export function readerBridge(session, { seriesRef, onFollow }) {
  const room = session.room;
  let current = null;
  let sentAt = 0;
  let timer = null;
  let trailing = null;
  let lastAppliedSeq = -1;
  const keyOf = (n) => `manga:${seriesRef}#${n}`;
  const synced = () => (room.info?.mode ?? session.mode) === 'sync';

  function report(state = 'playing') {
    if (!current) return;
    room.report({ pos: current.index, at: room.clock.serverNow(), state, source: current.source ?? null, mediaKey: keyOf(current.chapter), version: { pages: current.pages } });
  }

  const offState = room.on('state', ({ state, by }) => apply(state, by));
  function apply(state, by) {
    if (!state || !synced() || room.isHost || by === room.me) return;
    if (state.seq === lastAppliedSeq) return;
    lastAppliedSeq = state.seq;
    const chapter = /#([^#]+)$/.exec(state.media?.key ?? '')?.[1];
    if (chapter == null) return;
    onFollow({ chapter: Number(chapter), index: Math.max(0, Math.round(state.pos)) });
  }
  const offWelcome = room.on('welcome', (w) => { if (!room.isHost) apply(w.state, null); });

  // القراءة لا غرفة انتظار لها: أول صفحة عند المضيف تبدأ الغرفة
  const ensureStarted = () => {
    if (room.isHost && current && room.timeline && !room.timeline.started) room.command('play', { pos: current.index });
  };
  const offLive = room.on('welcome', () => setTimeout(ensureStarted, 0));

  return {
    /** القارئ وصل صفحة. المضيف في المتزامن يحرّك الغرفة (بعد استقرار 300ms). */
    page({ chapter, label, index, pages, source }) {
      const changedChapter = current?.chapter !== chapter;
      current = { chapter, label, index, pages, source };
      ensureStarted();
      // التقرير كل ثانية على الأكثر، وآخر صفحة تُرسل دائمًا (لا تضيع آخر قلبة)
      clearTimeout(trailing);
      if (Date.now() - sentAt > 1000 || changedChapter) { sentAt = Date.now(); report(); }
      else trailing = setTimeout(() => { sentAt = Date.now(); report(); }, 1000 - (Date.now() - sentAt));
      if (!room.canControl || !synced()) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (changedChapter || room.timeline?.media?.key !== keyOf(chapter)) {
          room.command('load', { media: { key: keyOf(chapter), kind: 'manga', label: label ?? `الفصل ${chapter}` }, pos: index });
          room.command('play', { pos: index });
        } else room.command('seek', { pos: index });
      }, 300);
    },
    /** أين يبدأ القارئ: صفحة المضيف إن كانت الغرفة متزامنة وبدأت، وإلا null (فصل الدعوة). */
    initial() {
      const t = room.timeline;
      if (!t || !synced() || room.isHost || !t.started) return null;
      const chapter = /#([^#]+)$/.exec(t.media?.key ?? '')?.[1];
      if (chapter == null) return null;
      lastAppliedSeq = t.seq;
      return { chapter: Number(chapter), index: Math.max(0, Math.round(t.pos)) };
    },
    preparing() { report('preparing'); },
    failed(source) { if (current) current.source = source; report('failed'); },
    destroy() { clearTimeout(timer); clearTimeout(trailing); offState(); offWelcome(); offLive(); report('paused'); },
  };
}
