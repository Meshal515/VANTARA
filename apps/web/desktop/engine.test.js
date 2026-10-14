import { expect, it } from 'vitest';
import { createDesktopEngine } from './engine.js';
import { createDesktopRuntime } from './runtime.js';

function fixture({ startError = null, replayClose = false } = {}) {
  let event;
  const starts = [], stops = [];
  const bridge = { platform: 'windows', requestResource: async () => ({ text: '{}', status: 200 }), startPlayback: async args => { starts.push(args); if (replayClose && starts.length > 1) event({ type: 'playback/closed', session: args.session }); if (startError) throw new Error(startError); return { started: true }; }, stopPlayback: async args => { stops.push(args); }, playbackCommand: async () => {}, onEvent: fn => { event = fn; return () => {}; } };
  let release = 0;
  const stream = { id: 'torrentio|0', status: 'RESOLVED', type: 'torrent', infoHash: 'a'.repeat(40), fileIdx: 0, quality: 1080, headers: {}, sources: [] };
  const source = { episodes: async () => [{ number: 1, season: 2, url: 'tt123:2:1', type: 'series' }], servers: async ep => [{ name: 'Torrentio', url: ep.url }], streams: async () => [stream] };
  const addons = { ready: Promise.resolve(), registry: { snapshot: () => ({ release: () => release++ }), list: () => [] }, sources: { source: () => source, def: () => ({ label: 'Torrentio' }), list: () => [] } };
  const engine = createDesktopEngine({ bridge, getRuntime: () => ({ addons, ready: Promise.resolve() }) });
  return { engine, starts, stops, stream, emit: e => event(e), release: () => release };
}
async function prepared(f) {
  const done = new Promise(resolve => f.engine.addListener('prepared', resolve));
  await f.engine.prepare({ session: 's', copies: [{ sourceId: 'addon|torrentio', id: 'tt123', requestedSeason: 2 }], episode: 1 });
  await done;
}
it('يجهز route دون autoplay ثم يمرر normalized candidate المختار كاملًا', async () => {
  const f = fixture();
  await prepared(f);
  const snap = await f.engine.routes({ session: 's' });
  expect(snap.routes).toMatchObject([{ state: 'READY', runtimeReady: true, sourceName: 'Torrentio', quality: 1080 }]);
  expect(f.starts).toEqual([]);
  const choice = await f.engine.pick({ session: 's', route: snap.routes[0].id });
  expect(await f.engine.best({ session: 's' })).toMatchObject(choice);
  await f.engine.play({ session: 's', candidate: choice.candidate, title: 'عنوان', animeId: 'tt123:2', episode: 1, position: 12500 });
  expect(f.starts[0]).toMatchObject({ session: 's', candidate: { ...f.stream, id: choice.candidate }, position: 12500, title: 'عنوان' });
});
it('يربط تقدم ms بالسياق وينظف الجلسة مرة واحدة ويمنع الأحداث المتأخرة', async () => {
  const f = fixture(), progress = [];
  f.engine.addListener('playback', e => progress.push(e));
  await prepared(f);
  const best = await f.engine.best({ session: 's' });
  await f.engine.play({ session: 's', candidate: best.candidate, animeId: 'tt123:2', episode: 1 });
  f.emit({ type: 'playback/progress', session: 's', position: 15000, duration: 900000 });
  expect(progress[0]).toMatchObject({ animeId: 'tt123:2', episode: 1, position: 15000, duration: 900000 });
  await f.engine.closeSession({ session: 's' });
  f.emit({ type: 'playback/progress', session: 's', position: 20000 });
  await f.engine.closeSession({ session: 's' });
  expect(f.release()).toBe(1);
  expect(f.stops).toEqual([{ session: 's' }]);
  expect(progress).toHaveLength(2);
  expect(progress[1]).toMatchObject({ final: true });
  await expect(f.engine.play({ session: 's', candidate: best.candidate })).rejects.toThrow('الجلسة');
});
it('يعرض خطأ native start في حدث واضح ويعيد الخطأ للمنادي', async () => {
  const f = fixture({ startError: 'تعذر إقلاع المشغل' }), errors = [];
  f.engine.addListener('playerError', e => errors.push(e));
  await prepared(f);
  const best = await f.engine.best({ session: 's' });
  await expect(f.engine.play({ session: 's', candidate: best.candidate })).rejects.toThrow('تعذر إقلاع المشغل');
  expect(errors).toMatchObject([{ session: 's', message: 'تعذر إقلاع المشغل' }]);
  await expect(f.engine.play({ session: 's', candidate: 'unknown' })).rejects.toThrow('الجلسة');
});
it('يبقي تورنت خارج core Android ويستعيد registry من التخزين الدائم', async () => {
  const data = new Map(), urls = [];
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, val) => data.set(key, val), removeItem: key => data.delete(key) };
  const bridge = { requestResource: async args => { urls.push(args); return { status: 200, text: JSON.stringify({ id: 'org.torrentio', name: 'Torrentio', version: '1.0.0', resources: ['stream'], types: ['movie'], catalogs: [] }) }; } };
  const one = createDesktopRuntime({ bridge, storage }); await one.addons.ready;
  await one.addons.registry.install(await one.addons.registry.inspect('https://torrentio.test/token?key=secret'));
  const two = createDesktopRuntime({ bridge, storage }); await two.addons.ready;
  expect(two.registry.list()).toEqual([]);
  expect(two.addons.registry.list()).toMatchObject([{ name: 'Torrentio', enabled: true }]);
  expect(urls[0]).toMatchObject({ url: 'https://torrentio.test/token/manifest.json?key=secret', json: true });
});

it('يبقي الجلسة عند استبدال المشغل بنفس session ولا يقبل إغلاق اللاعب السابق كنهاية الجديدة', async () => {
  const f = fixture({ replayClose: true }), progress = [];
  f.engine.addListener('playback', e => progress.push(e));
  await prepared(f);
  const best = await f.engine.best({ session: 's' });
  await f.engine.play({ session: 's', candidate: best.candidate, position: 1000 });
  await f.engine.play({ session: 's', candidate: best.candidate, position: 2000 });
  f.emit({ type: 'playback/progress', session: 's', position: 3000, duration: 10000 });
  expect((await f.engine.routes({ session: 's' })).routes).toHaveLength(1);
  expect(f.release()).toBe(0);
  expect(progress).toMatchObject([{ position: 3000, final: false }]);
});
