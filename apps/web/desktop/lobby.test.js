import { parseHTML } from 'linkedom';
import { expect, it } from 'vitest';
import { createDesktopLobby } from './lobby.js';

// بلاغ المالك (14 نوفمبر): شعار الغرفة «يتحرك ويتكرر». المشغّل ينادي الغرفة كل 500ms، وكانت تُبنى من الصفر في كل
// مرة (البنر يعاد تحميله والاسم يظهر ثم يُستبدل بالشعار). تُرسم الآن فقط حين يتغير ما يُرى فيها.
it('the watch-together room is not rebuilt on every 500 ms tick, only when what it shows changes', async () => {
  const { document } = parseHTML('<html><body><div id="h"></div></body></html>');
  const host = document.getElementById('h');
  // renderLobby يبني بـdocument وImage العامّين كما في المتصفح
  globalThis.document = document; globalThis.Image = function Image() { return document.createElement('img'); };
  const engine = { playerState: async () => ({ media: { kind: 'anime', title: 'Frieren', seriesRef: 'anime:1', episode: 3 }, episode: 3 }), roomHub: () => null };
  const lobby = createDesktopLobby({ host, engine, session: 's', chooseServer() {}, leave() {}, visibility() {}, resolveArtImpl: async () => ({ title: 'Frieren' }) });
  const base = { visible: true, prepared: false, host: true, connection: 'live', me: 'a', invited: ['b'], roster: [{ userId: 'a', state: 'preparing', pos: 0, at: 1 }] };
  await lobby.update(base);
  // الفن يُحسم أولًا ثم تُرسم الغرفة مرة واحدة (لا غلاف ثم بنر، ولا اسم ثم شعار)
  await new Promise((r) => setTimeout(r, 0));
  const first = host.firstElementChild;
  expect(first).not.toBeNull();
  // تقرير جديد: الموضع والزمن تغيرا فقط ⇒ نفس العناصر
  await lobby.update({ ...base, roster: [{ userId: 'a', state: 'preparing', pos: 500, at: 501 }] });
  expect(host.firstElementChild).toBe(first);
  const bar = host.querySelector('.pl-bar');
  // تغيّر ما يُرى (العضو صار جاهزًا) ⇒ الشريط يُرسم من جديد، والبنر والشعار نفسهما (لا إعادة تحميل ولا وميض)
  await lobby.update({ ...base, roster: [{ userId: 'a', state: 'ready', pos: 500, at: 502 }] });
  expect(host.querySelector('.pl-bar')).not.toBe(bar);
  expect(host.firstElementChild).toBe(first);
  // الشعار يمتلئ بقدر التجهيز ويكتمل عند الجاهزية (أول إطار)
  await lobby.update({ ...base, progress: 0.4, roster: [{ userId: 'a', state: 'ready' }] });
  expect(host.querySelector('.pl-mark .pl-fill').style.clipPath).toBe('inset(0 60% 0 0)');
  await lobby.update({ ...base, prepared: true, progress: 0.4, roster: [{ userId: 'a', state: 'ready' }] });
  expect(host.querySelector('.pl-mark .pl-fill').style.clipPath).toBe('inset(0 0% 0 0)');
  lobby.destroy();
  delete globalThis.document; delete globalThis.Image;
});

// وميض الغرفة (مثبت بـtools/together/lobby-flicker.cjs): كانت تُرسم بالغلاف ثم تُبدّل للبنر عند وصول ani.zip، وفشل نداء
// playerState واحد يعيدها للغلاف. الآن لا تُرسم قبل حسم الفن، ونداء فاشل لا يغيّر شيئًا.
it('room art is decided once: nothing is painted before the art settles, and a failed playerState call does not repaint it', async () => {
  const { document } = parseHTML('<html><body><div id="h"></div></body></html>');
  const host = document.getElementById('h');
  globalThis.document = document; globalThis.Image = function Image() { return document.createElement('img'); };
  let fail = false, settle;
  const engine = { playerState: async () => { if (fail) throw new Error('ipc'); return { media: { kind: 'anime', title: 'Bleach', seriesRef: 'anime:269', episode: 1, cover: 'cover.jpg' }, episode: 1 }; }, roomHub: () => null };
  const lobby = createDesktopLobby({ host, engine, session: 's', chooseServer() {}, leave() {}, visibility() {}, resolveArtImpl: () => new Promise((r) => { settle = r; }) });
  const base = { visible: true, prepared: false, host: true, connection: 'live', me: 'a', roster: [{ userId: 'a', state: 'preparing' }] };
  await lobby.update(base);
  expect(host.childElementCount).toBe(0); // لا غلاف مؤقت
  settle({ banner: 'fanart.jpg', episodeImage: 'ep1.jpg', title: 'Bleach' });
  await new Promise((r) => setTimeout(r, 0));
  const img = host.querySelector('.pl-bg img');
  expect(img.getAttribute('src')).toBe('fanart.jpg');
  expect(host.querySelector('.pl-start-thumb').getAttribute('src')).toBe('ep1.jpg');
  fail = true;
  await lobby.update({ ...base, roster: [{ userId: 'a', state: 'ready' }] });
  expect(host.querySelector('.pl-bg img')).toBe(img); // نفس الصورة، لا رجوع للغلاف
  lobby.destroy();
  delete globalThis.document; delete globalThis.Image;
});

it('«الحلقات» للمضيف: لوحة جانبية، الحالية مميّزة، والاختيار ينقل الغرفة كلها عبر changeEpisode', async () => {
  const { document } = parseHTML('<html><body><main><div id="h"></div></main></body></html>');
  const host = document.getElementById('h');
  globalThis.document = document; globalThis.Image = function Image() { return document.createElement('img'); };
  const changes = [];
  const engine = { playerState: async () => ({ media: { kind: 'cinema', title: 'X', seriesRef: 'cinema:tt1:1', episode: 2 }, episode: 2, total: 8 }), roomHub: () => null, changeEpisode: async (a) => { changes.push(a); } };
  const lobby = createDesktopLobby({ host, engine, session: 's', chooseServer() {}, leave() {}, visibility() {}, resolveArtImpl: async () => ({ title: 'X' }) });
  await lobby.update({ visible: true, prepared: true, host: true, connection: 'live', me: 'a', roster: [{ userId: 'a', state: 'ready', host: true }] });
  await new Promise((r) => setTimeout(r, 0));
  host.querySelector('.pl-episodes').click();
  const rows = document.querySelectorAll('.pl-side .pl-ep');
  expect(rows.length).toBe(8);
  expect(rows[1].classList.contains('is-on')).toBe(true);
  rows[4].click();
  expect(changes).toEqual([{ session: 's', episode: 5 }]);
  expect(document.querySelector('.pl-side')).toBeNull();
  lobby.destroy();
  delete globalThis.document; delete globalThis.Image;
});
