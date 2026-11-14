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
  const lobby = createDesktopLobby({ host, engine, session: 's', chooseServer() {}, leave() {}, visibility() {} });
  const base = { visible: true, prepared: false, host: true, connection: 'live', me: 'a', invited: ['b'], roster: [{ userId: 'a', state: 'preparing', pos: 0, at: 1 }] };
  await lobby.update(base);
  const first = host.firstElementChild;
  expect(first).not.toBeNull();
  // تقرير جديد: الموضع والزمن تغيرا فقط ⇒ نفس العناصر
  await lobby.update({ ...base, roster: [{ userId: 'a', state: 'preparing', pos: 500, at: 501 }] });
  expect(host.firstElementChild).toBe(first);
  // تغيّر ما يُرى (العضو صار جاهزًا) ⇒ تُرسم من جديد
  await lobby.update({ ...base, roster: [{ userId: 'a', state: 'ready', pos: 500, at: 502 }] });
  expect(host.firstElementChild).not.toBe(first);
  lobby.destroy();
  delete globalThis.document; delete globalThis.Image;
});
