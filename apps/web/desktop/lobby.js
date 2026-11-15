import { renderLobby, pendingInvitees } from '../lib/together/lobby.js';
import { aniZipArt, episodeLine, mediaKind, resolveArt } from '../lib/together/art.js';

/** Same room renderer as the web/APK design; MPV stays prepared behind it. */
export function createDesktopLobby({ host, engine, session, chooseServer, leave, visibility, resolveArtImpl = resolveArt }) {
  let latest = null, closed = false, revision = 0, artKey = null, art = null, lastState = null, lastMedia = null;
  const doc = host.ownerDocument;
  const hub = () => engine.roomHub?.({ session });
  async function update(event) {
    if (closed) return;
    latest = event;
    host.hidden = !event.visible;
    visibility(Boolean(event.visible));
    if (!event.visible) { clearInterval(host._countdown); return; }
    const token = ++revision;
    const state = await engine.playerState?.({ session }).catch(() => null);
    if (closed || token !== revision || !latest?.visible) return;
    const roomHub = hub();
    const media = { ...(state?.media ?? {}), ...(roomHub?.session?.media ?? {}), ...(event.media ?? {}) };
    // قرار فن واحد لكل حلقة (CLAUDE.md، ووميض مثبت في tools/together/lobby-flicker.cjs): الغرفة لا تُرسم حتى يُحسم الفن
    // (resolveArt، بحد 1.2 ث ثم المتاح)، ثم لا يتبدل. المفتاح من حلقة الغرفة نفسها لا من نداء playerState الذي قد يفشل
    // (كان فشل نداء واحد يعيد الغلاف ثم البنر: وميض متكرر).
    const episode = media.episode ?? state?.episode;
    const key = `${media.seriesRef}|${episode}`;
    if (key !== artKey) {
      artKey = key; art = null;
      const initial = { banner: media.backdrop ?? media.banner ?? media.cover ?? state?.poster ?? null, episodeImage: media.episodeImage ?? null, logo: media.logo ?? null,
        title: media.title ?? state?.title ?? 'VANTARA', episodeTitle: media.episodeTitle ?? null };
      const decide = value => {
        if (closed || artKey !== key || art) return;
        art = { ...initial, ...(value ?? {}), banner: value?.banner ?? initial.banner, episodeImage: value?.episodeImage ?? initial.episodeImage, title: value?.title || initial.title };
        if (latest?.visible) paint(lastState, lastMedia);
      };
      void resolveArtImpl({ ...media, episode }).then(decide, () => decide(null));
      setTimeout(() => decide(null), 1200);
    }
    lastState = state; lastMedia = media;
    if (art) paint(state, media);
  }
  // renderLobby يمسح الغرفة ويبنيها من جديد، والمشغّل يناديها كل 500ms: كان البنر يُعاد تحميله والاسم يظهر ثم
  // يُستبدل بالشعار كل نصف ثانية (الشعار «يتحرك ويتكرر» في بلاغ المالك)، والزر تحت الفأرة يُستبدل فلا يُضغط بثبات.
  // تُرسم الغرفة فقط حين يتغير ما يُرى فيها؛ العدّ التنازلي يحدّث نفسه داخل renderLobby.
  let painted = null, side = null;
  // «الحلقات» للمضيف: لوحة جانبية بصور الحلقات وعناوينها، والاختيار ينقل الغرفة كلها (engine.changeEpisode ← أمر load)
  function closeEpisodes() { side?.remove(); side = null; }
  function openEpisodes(state, media) {
    closeEpisodes();
    const total = Math.min(2000, Number(state?.total) || 0), current = Number(state?.episode ?? media.episode) || 1;
    if (total < 2 || !host.parentNode) return;
    const wrap = doc.createElement('div'); wrap.className = 'pl-side-wrap';
    const scrim = doc.createElement('div'); scrim.className = 'pl-side-scrim'; scrim.onclick = closeEpisodes;
    const panel = doc.createElement('aside'); panel.className = 'pl-side'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'الحلقات');
    const head = doc.createElement('div'); head.className = 'pl-side-head';
    const t = doc.createElement('div'); t.className = 'pl-side-title';
    const h = doc.createElement('strong'); h.textContent = 'الحلقات';
    const sub = doc.createElement('small'); sub.textContent = 'اختيارك ينقل الغرفة كلها';
    t.append(h, sub);
    const x = doc.createElement('button'); x.type = 'button'; x.className = 'pl-side-close'; x.setAttribute('aria-label', 'إغلاق'); x.textContent = '×'; x.onclick = closeEpisodes;
    head.append(t, x);
    const list = doc.createElement('div'); list.className = 'pl-side-list';
    const rows = [];
    for (let n = 1; n <= total; n++) {
      const row = doc.createElement('button'); row.type = 'button'; row.className = `pl-ep${n === current ? ' is-on' : ''}`;
      const img = doc.createElement('span'); img.className = 'pl-ep-img';
      const txt = doc.createElement('span'); txt.className = 'pl-ep-text';
      const b = doc.createElement('b'); b.textContent = `الحلقة ${n}`;
      const small = doc.createElement('small'); small.dir = 'auto';
      txt.append(b, small);
      if (n === current) { const now = doc.createElement('em'); now.textContent = 'الآن'; txt.prepend(now); }
      row.append(img, txt);
      row.onclick = () => { closeEpisodes(); if (n !== current) void Promise.resolve(engine.changeEpisode?.({ session, episode: n })).catch(() => {}); };
      rows.push([row, img, small]);
      list.append(row);
    }
    panel.append(head, list);
    wrap.append(scrim, panel);
    host.parentNode.append(wrap);
    side = wrap;
    rows[current - 1]?.[0].scrollIntoView?.({ block: 'center' });
    // صور الحلقات وعناوينها من ani.zip (نفس مصدر فن الغرفة، مخزّن)
    const anilist = media?.kind === 'anime' ? Number(/^anime:(\d+)/.exec(media.seriesRef ?? '')?.[1]) : 0;
    if (anilist > 0) void aniZipArt(anilist).then(z => {
      if (side !== wrap) return;
      rows.forEach(([, img, small], i) => {
        const e = z?.episodes?.[String(i + 1)];
        if (e?.title) small.textContent = e.title;
        if (e?.image) { const im = doc.createElement('img'); im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; im.src = e.image; im.onerror = () => im.remove(); img.append(im); }
      });
    }).catch(() => {});
  }
  function paint(state, media) {
    if (closed || !latest?.visible) return;
    const roomHub = hub(), event = latest;
    const person = id => roomHub?.person?.(id) ?? { userId: id, displayName: 'صديق' };
    const roster = (event.roster ?? []).map(r => ({ ...r, avatarKey: r.avatarKey || person(r.userId).avatarKey || null }));
    const model = { ...event, roster, art, offset: event.videoOffsetMs ?? event.offset ?? 0,
      pending: pendingInvitees(event.invited, roster, event.me, person),
      kindText: mediaKind(media), episodeText: episodeLine(media, state?.episode ?? media.episode),
      server: state?.server ? { code: state.server.sourceName ?? state.server.code, quality: state.server.quality ? `${state.server.quality}p` : null } : null,
      accent: media.kind === 'anime' ? '#3b82f6' : '#c1121f',
    };
    // الموضع والزمن وانحراف كل عضو تتغير مع كل تقرير ولا تُرى في الغرفة: لا تُعيد الرسم
    const VOLATILE = new Set(['pos', 'at', 'driftMs', 'driftP95', 'seenAt', 'lastSeen', 'rtt', 'now']);
    const signature = JSON.stringify(model, (k, v) => (typeof v === 'function' || VOLATILE.has(k) ? undefined : v));
    if (signature === painted && host.childElementCount) return;
    painted = signature;
    renderLobby(host, model, { avatar: (p, size) => {
      if (roomHub?.avatar) return roomHub.avatar(p, size);
      const fallback = doc.createElement('span'); fallback.textContent = [...(p.displayName ?? 'صديق')][0]; return fallback;
    }, start: event.start, resume: event.resume, changeServer: chooseServer, leave,
    episodes: event.host && Number(state?.total) > 1 && typeof engine.changeEpisode === 'function' ? () => openEpisodes(state, media) : null,
    setOffset: ms => event.setVideoOffset?.(Math.max(-120000, Math.min(120000, ms))) });
  }
  return { update, destroy() { closed = true; revision++; clearInterval(host._countdown); closeEpisodes(); host.remove(); } };
}

/** Invitation entry: no MPV process, no automatic source pick, no duplicate room socket. */
export function openDesktopRoomEntry({ document: doc, together, media, chooseServer }) {
  const root = doc.createElement('section'); root.className = 'desktop-player pwa-player v35 desktop-room-entry';
  root.dataset.tone = media.kind === 'cinema' ? 'cinema' : 'anime';
  const host = doc.createElement('div'); host.className = 'pp-lobby'; root.append(host); doc.body.append(root);
  let disposed = false; const offs = [];
  const destroy = () => { if (disposed) return; disposed = true; offs.forEach(off=>off()); view.destroy(); root.remove(); };
  const room = together.session.room;
  const facade = { roomHub:()=>together.hub,playerState:async()=>({ media, title:media.title, poster:media.cover,episode:media.episode }) };
  const view = createDesktopLobby({ host, engine:facade,session:together.session.code,
    visibility(){}, leave:()=>{together.hub.leave();destroy();},chooseServer:()=>{destroy();chooseServer();} });
  const paint = () => {
    if (disposed) return;
    void view.update({ visible:true, selectingSource:true, prepared:false, host:room.isHost, connection:room.status,
      me:room.me, invited:room.info?.invited??together.session.invited,roster:room.roster,media,videoOffsetMs:0 });
  };
  for (const name of ['roster','welcome','connection','room']) offs.push(room.on(name,paint));
  if(together.hub.onChange)offs.push(together.hub.onChange(current=>{if(current!==together.session)destroy();}));
  paint();return {destroy,get active(){return !disposed;},leave(){together.hub.leave();destroy();}};
}
