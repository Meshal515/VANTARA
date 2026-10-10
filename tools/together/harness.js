import { createTogether, readerBridge } from '/v35/together.js';
const p = new URLSearchParams(location.search);
const token = p.get('token'), me = p.get('me');
const people = JSON.parse(p.get('people'));
const enqueued = [];
const sync = { authorizationHeader: `Bearer ${token}`, user: { userId: me }, enqueue: (k, payload) => enqueued.push({ k, payload }) };
document.body.innerHTML = `
<div class="v35" id="app" style="min-height:100vh;background:var(--bg);color:var(--text-1);padding:0">
  <header id="top" style="position:sticky;top:0;display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(0,0,0,.6)">
    <b style="flex:1" id="title">القارئ (محاكاة)</b><span class="rd-together" id="strip" hidden></span>
  </header>
  <div id="page" style="font-size:42px;text-align:center;padding:40px 0">—</div>
  <div style="display:flex;gap:8px;justify-content:center"><button id="prev" class="btn">السابقة</button><button id="next" class="btn btn-primary">التالية</button><button id="invite" class="btn">اقرأ مع أصدقائك</button></div>
  <div id="chat" style="padding:16px"></div>
</div>
<div class="v35" id="sheet" style="display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.5);align-items:flex-end"><div id="sheetBody" style="width:100%;max-height:85vh;overflow:auto;padding:16px;background:var(--bg-raised);border-radius:20px 20px 0 0"></div></div>
<div id="toast" style="z-index:1001;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:8px 14px;border-radius:99px;display:none"></div>`;
document.documentElement.classList.add('v35');
const $ = (id) => document.getElementById(id);
const toasts = [];
let cleanup = null;
const ui = {
  openSheet(build) { const b = $('sheetBody'); b.replaceChildren(); b.className = ''; $('sheet').style.display = 'flex'; cleanup = build(b) ?? null; },
  closeSheet() { $('sheet').style.display = 'none'; cleanup?.(); cleanup = null; },
  toast(t) { toasts.push(t); const n = $('toast'); n.textContent = t; n.style.display = 'block'; clearTimeout(n._t); n._t = setTimeout(() => (n.style.display = 'none'), 2500); },
};
$('sheet').onclick = (e) => { if (e.target.id === 'sheet') ui.closeSheet(); };
const avatarNode = (person, size) => { const s = document.createElement('span'); s.className = 'avatar-letter'; s.textContent = [...String(person.displayName || '؟')][0]; s.style.cssText = `width:${size}px;height:${size}px;border-radius:99px;flex:none;display:inline-grid;place-items:center;background:hsl(${(person.displayName||'').length*67%360},45%,40%);color:#fff;font-weight:700`; return s; };
const reader = { chapter: 110, index: 0, pages: 40 };
let bridge = null;
const paint = () => ($('page').textContent = `الفصل ${reader.chapter} · صفحة ${reader.index + 1}`);
const hub = createTogether({
  sync, baseUrl: () => 'http://127.0.0.1:8787', friends: () => people.filter((x) => x.userId !== me), avatarNode, ...ui,
  openMedia: (media, session) => attach(session),
});
function attach(session) {
  if (bridge) return;
  bridge = readerBridge(session, { seriesRef: 'ext:solo', onFollow: ({ chapter, index }) => { reader.chapter = chapter; reader.index = index; paint(); bridge.page({ ...reader }); } });
  $('strip').hidden = false; hub.mountStrip($('strip'));
  const init = bridge.initial(); if (init) { reader.chapter = init.chapter; reader.index = init.index; }
  paint(); bridge.page({ ...reader, label: `الفصل ${reader.chapter}`, source: p.get('source') });
}
const move = (d) => { reader.index = Math.max(0, reader.index + d); paint(); bridge?.page({ ...reader, label: `الفصل ${reader.chapter}`, source: p.get('source') }); };
$('next').onclick = () => move(1); $('prev').onclick = () => move(-1);
$('invite').onclick = () => hub.openInvite({ kind: 'manga', key: 'manga:ext:solo#110', label: 'سولو ليفلينج — الفصل 110', seriesRef: 'ext:solo', title: 'سولو ليفلينج', chapter: 110 }, { onStarted: attach });
if (p.get('card')) $('chat').append(hub.card(JSON.parse(p.get('card'))));
paint();
window.tg = { hub, enqueued, toasts, reader, move, get bridge() { return bridge; } };
