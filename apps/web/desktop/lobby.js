import { renderLobby, pendingInvitees } from '../lib/together/lobby.js';
import { episodeLine, mediaKind, resolveArt } from '../lib/together/art.js';

/** Same room renderer as the web/APK design; MPV stays prepared behind it. */
export function createDesktopLobby({ host, engine, session, chooseServer, leave, visibility }) {
  let latest = null, closed = false, revision = 0, artKey = null, art = null;
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
    const initial = { banner: media.banner ?? media.cover ?? state?.poster ?? null, logo: media.logo ?? null,
      title: media.title ?? state?.title ?? 'VANTARA', episodeTitle: media.episodeTitle ?? null };
    const key = `${media.seriesRef}|${state?.episode ?? media.episode}|${initial.banner}|${initial.logo}`;
    if (key !== artKey) {
      artKey = key; art = initial;
      void resolveArt(media).then(value => {
        if (!closed && artKey === key) { art = { ...initial, ...value, banner: value.banner ?? initial.banner, title: value.title || initial.title }; paint(state, media); }
      });
    }
    paint(state, media);
  }
  function paint(state, media) {
    if (closed || !latest?.visible) return;
    const roomHub = hub(), event = latest;
    const person = id => roomHub?.person?.(id) ?? { userId: id, displayName: 'صديق' };
    const roster = (event.roster ?? []).map(r => ({ ...r, avatarKey: r.avatarKey || person(r.userId).avatarKey || null }));
    renderLobby(host, { ...event, roster, art, offset: event.videoOffsetMs ?? event.offset ?? 0,
      pending: pendingInvitees(event.invited, roster, event.me, person),
      kindText: mediaKind(media), episodeText: episodeLine(media, state?.episode ?? media.episode),
      server: state?.server ? { code: state.server.sourceName ?? state.server.code, quality: state.server.quality ? `${state.server.quality}p` : null } : null,
      accent: media.kind === 'anime' ? '#3b82f6' : '#c1121f',
    }, { avatar: (p, size) => {
      if (roomHub?.avatar) return roomHub.avatar(p, size);
      const fallback = doc.createElement('span'); fallback.textContent = [...(p.displayName ?? 'صديق')][0]; return fallback;
    }, start: event.start, resume: event.resume, changeServer: chooseServer, leave,
    setOffset: ms => event.setVideoOffset?.(Math.max(-120000, Math.min(120000, ms))) });
  }
  return { update, destroy() { closed = true; revision++; clearInterval(host._countdown); host.remove(); } };
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
