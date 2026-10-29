/**
 * ورقة السيرفرات المشتركة: أسماء بشرية بدل الرموز والمعرّفات الداخلية،
 * و«الأفضل لك» يقدّم المباشر ثم التورنت الصحيح السرب.
 */
import { parseHTML } from 'linkedom';
import { expect, it, vi } from 'vitest';
import { addonName, createServerSheet, describe as describeRoute, hostName, releaseGroup, sourceLabel } from './server-sheet.js';

const TORR = 'addon|https://torrentio.strem.fun|com.stremio.torrentio.addon';
const COMET = 'addon|https://comet.elfhosted.com|comet.elfhosted.com';

it('addon ids become addon names, never the raw internal key', () => {
  expect(addonName(TORR)).toBe('Torrentio');
  expect(addonName(COMET)).toBe('Comet');
  expect(addonName('addon|https://mediafusion.elfhosted.com/abc|mediafusion')).toBe('MediaFusion');
  expect(addonName('addon|kitsu')).toBe('Kitsu');
  expect(sourceLabel(TORR, { title: 'Torrentio Lite' })).toBe('Torrentio Lite');
  expect(sourceLabel(TORR, { title: TORR })).toBe('Torrentio');
  expect(sourceLabel('witanime', { names: { witanime: 'WitAnime' } })).toBe('WitAnime');
});

it('hosts and release groups read as people say them', () => {
  expect(hostName('streamwish')).toBe('StreamWish');
  expect(hostName('ok.ru')).toBe('OK.ru');
  expect(hostName('سيرفر فاصل')).toBe('سيرفر فاصل');
  expect(releaseGroup('[SubsPlease] Re Zero - 51 (1080p) [A1B2].mkv')).toBe('SubsPlease');
  expect(releaseGroup('Re.ZERO.S04E01.1080p.CR.WEB-DL.DUAL.AAC2.0.H.264-VARYG')).toBe('VARYG');
});

it('describes a torrent row from what the addon stated', () => {
  const d = describeRoute({ id: 'r6', sourceId: TORR, server: 'Torrentio', code: 'TRR', quality: 1080, variant: 'SUB', state: 'READY', sourceName: 'Torrentio', runtimeReady: true, label: '[SubsPlease] Re Zero - 51 (1080p).mkv\n👤 312 💾 1.4 GB ⚙️ Nyaa\nMulti Subs / 🇸🇦 / 🇬🇧' });
  expect(d).toMatchObject({ torrent: true, q: 1080, name: 'Torrentio', host: 'Nyaa · SubsPlease', tier: 'strong' });
  expect(d.langs.map((l) => l.t)).toEqual(['عربي']);
  const c = describeRoute({ id: 'c', sourceId: COMET, sourceName: 'Comet', quality: 1080, state: 'READY', runtimeReady: true, label: '[Erai-raws] Re Zero 4th Season - 01 [1080p][HEVC].mkv\n💾 720 MB 👤 9 🔎 Nyaa' });
  expect(c.host).toBe('Nyaa · Erai-raws');
  expect(c.info.seeders).toBe(9);
});

it('recommends the fast direct Arabic server, then plays exactly what it shows', () => {
  const { document } = parseHTML('<html><body><main></main></body></html>');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const body = document.querySelector('main');
  const onPick = vi.fn();
  const ui = createServerSheet(body, { el, kicker: 'الحلقة 1', title: 'Re:ZERO', onPick, prefer: null, directLang: 'مترجم عربي', sourceName: (r) => ({ witanime: 'WitAnime', okanime: 'OkAnime' })[r.sourceId] ?? r.sourceId });
  const routes = [
    { id: 't', sourceId: TORR, sourceName: 'Torrentio', quality: 2160, state: 'READY', runtimeReady: true, label: 'X.2160p.WEB-DL\n👤 500 💾 4 GB ⚙️ Nyaa' },
    { id: 'slow', sourceId: 'okanime', server: 'mp4upload', code: 'MPU', quality: 1080, state: 'READY', probeMs: 6000 },
    { id: 'fast', sourceId: 'witanime', server: 'streamwish', code: 'SWH', quality: 1080, state: 'READY', probeMs: 700 },
    { id: 'wait', sourceId: 'witanime', server: 'hgcloud', code: 'HGC', quality: 720, state: 'RESOLVING' },
    { id: 'dead', sourceId: 'witanime', server: 'videa', code: 'VDA', quality: 480, state: 'UNAVAILABLE' },
  ];
  ui.update({ routes, settled: false, status: { text: '…' } });
  // لا بطاقة «الأفضل لك»: كلمة «مقترح» على صفّه وحده، وسببه تحت الزر الواحد
  expect(body.querySelector('.ss-rec')).toBeNull();
  const top = body.querySelectorAll('.ss-row--top');
  expect(top).toHaveLength(1);
  expect(top[0].querySelector('.ss-name').textContent).toBe('WitAnime');
  expect(top[0].querySelector('.ss-host').textContent).toBe('StreamWish');
  expect(top[0].textContent).toContain('مترجم عربي');
  expect(body.querySelector('.an-pick-best').textContent).toContain('شغّل الأفضل');
  expect(body.querySelector('.an-pick-best small').textContent).toBe('1080p · WitAnime · يبدأ فورًا');
  // المباشر قبل التورنت، والأسرع بدءًا أولًا؛ لا رموز ثلاثية في أي صف
  const direct = [...body.querySelectorAll('.ss-group--direct > .an-srv-grid .ss-row')];
  expect(direct.map((b) => b.querySelector('.ss-host').textContent)).toEqual(['StreamWish', 'Mp4Upload']);
  expect(body.textContent).not.toMatch(/\b(?:SWH|MPU|TRR|HGC)\b/);
  expect(body.querySelector('.ss-group--torrent .ss-row .ss-name').textContent).toBe('Torrentio');
  // ما يُجهَّز وما تعذّر مطويّان بعد أول جاهز
  expect(body.querySelector('.cn-srv-wait summary').textContent).toContain('1');
  expect(body.querySelector('.ss-dead summary').textContent).toContain('1');
  body.querySelector('.an-pick-best').onclick();
  expect(onPick).toHaveBeenCalledWith(routes[2]);
  top[0].onclick();
  expect(onPick).toHaveBeenLastCalledWith(routes[2]);
});

const dom = () => {
  const { document } = parseHTML('<html><body><main></main></body></html>');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  return { document, el, body: document.querySelector('main') };
};

it('heads the sheet with the episode: logo over its still, one quiet facts line, code, title and description', () => {
  const { el, body } = dom();
  createServerSheet(body, {
    el, onPick() {},
    media: {
      title: 'Breaking Bad', logo: 'https://images.metahub.space/logo/medium/tt0903747/img',
      backdrop: 'https://episodes.metahub.space/tt0903747/2/3/w780.jpg', backdropFallback: 'https://bg.jpg',
      code: 'S02E03', label: 'الموسم 2 · الحلقة 3', episodeTitle: 'Bit by a Dead Bee',
      description: 'Walt and Jesse cover their tracks.', rating: { value: 7.6, label: 'IMDb' }, date: '2009-03-23', duration: '49 د', resume: 'تكمل من 31:05',
    },
  });
  expect(body.querySelector('.ss-art-img').getAttribute('src')).toContain('w780.jpg');
  expect(body.querySelector('.ss-logo').getAttribute('src')).toContain('/logo/');
  expect(body.querySelector('.ss-brand').className).toContain('ss-brand--logo');
  // الشعار نفسه ينتقل إلى الشريط المضغوط حين تنكمش الصورة
  expect(body.querySelector('.ss-bar-logo')).not.toBeNull();
  const facts = [...body.querySelectorAll('.ss-fact')].map((f) => f.textContent);
  expect(facts[0]).toBe('IMDb7.6');
  expect(facts[1]).toMatch(/2009/);
  expect(facts[2]).toBe('49 د');
  expect(body.querySelector('.ss-ep-code').textContent).toBe('S02E03');
  expect(body.querySelector('.ss-ep-no').textContent).toBe('الموسم 2 · الحلقة 3');
  expect(body.querySelector('.ss-ep-title').textContent).toBe('Bit by a Dead Bee');
  // الوصف الإنجليزي باتجاهه (dir=auto) ومقصوص على ثلاثة أسطر مع «المزيد»
  const desc = body.querySelector('.ss-desc');
  expect(desc.dir).toBe('auto');
  expect(desc.className).toContain('clamped');
  const more = body.querySelector('.ss-more');
  more.onclick();
  expect(desc.className).not.toContain('clamped');
  expect(more.textContent).toBe('أقل');
  expect(body.querySelector('.ss-resume').textContent).toContain('31:05');
  // خلفية بديلة إن تعذّرت لقطة الحلقة، والاسم نصًا إن تعذّر الشعار
  body.querySelector('.ss-art-img').onerror();
  expect(body.querySelector('.ss-art-img').getAttribute('src')).toBe('https://bg.jpg');
  body.querySelector('.ss-logo').onerror();
  expect(body.querySelector('.ss-logo')).toBeNull();
  expect(body.querySelector('.ss-brand').className).not.toContain('ss-brand--logo');
  expect(body.querySelector('.ss-title').textContent).toBe('Breaking Bad');
});

it('a movie without logo or episode shows its name as text and no episode line', () => {
  const { el, body } = dom();
  createServerSheet(body, { el, onPick() {}, kicker: 'فيلم', title: 'Fight Club', media: { label: 'فيلم', date: 1999, rating: { value: 8.8, label: 'IMDb' } } });
  expect(body.querySelector('.ss-logo')).toBeNull();
  expect(body.querySelector('.ss-title').textContent).toBe('Fight Club');
  expect(body.querySelector('.ss-ep')).toBeNull();
  expect([...body.querySelectorAll('.ss-fact')].map((f) => f.textContent)).toEqual(['IMDb8.8', '1999']);
  expect(body.querySelector('.ss-art').className).toContain('ss-art--none');
});

const choose = (body, value) => {
  body.querySelector('.ss-addon-btn').onclick({ stopPropagation() {} });
  [...body.querySelectorAll('.ss-addon-opt')].find((o) => o.dataset.value === value).onclick({ stopPropagation() {} });
};

it('filters by quality, language and source as quiet tabs plus one source menu', () => {
  const { el, body } = dom();
  const onPick = vi.fn();
  const ui = createServerSheet(body, { el, onPick, sourceName: (r) => ({ witanime: 'WitAnime' })[r.sourceId] ?? r.sourceId });
  const routes = [
    { id: 'w', sourceId: 'witanime', server: 'streamwish', quality: 1080, variant: 'SUB', state: 'READY', probeMs: 700 },
    { id: 'd', sourceId: 'witanime', server: 'mp4upload', quality: 720, variant: 'DUB', state: 'READY', probeMs: 900 },
    { id: 't', sourceId: TORR, sourceName: 'Torrentio', quality: 1080, state: 'READY', runtimeReady: true, label: 'X.1080p.WEB-DL\n👤 80 💾 1 GB ⚙️ Nyaa' },
    { id: 'c', sourceId: COMET, sourceName: 'Comet', quality: 2160, state: 'READY', runtimeReady: true, label: 'X.2160p.WEB-DL\n👤 20 💾 5 GB ⚙️ Nyaa' },
  ];
  ui.update({ routes, settled: true, status: { text: '4 جاهزة' } });
  const tabs = [...body.querySelectorAll('.ss-tab')].map((b) => b.textContent);
  expect(tabs).toEqual(['الكل', '4K', '1080p', '720p', 'مترجم', 'مدبلج']);
  body.querySelector('.ss-addon-btn').onclick({ stopPropagation() {} });
  expect([...body.querySelectorAll('.ss-addon-opt')].map((o) => o.textContent)).toEqual(['كل المصادر', 'WitAnime', 'Torrentio', 'Comet']);
  body.querySelector('.ss-addon-btn').onclick({ stopPropagation() {} });
  choose(body, 'Comet');
  expect([...body.querySelectorAll('.ss-row')].map((b) => b.querySelector('.ss-name').textContent)).toEqual(['Comet']);
  // المقترح والزر يتبعان المرشّح
  expect(body.querySelector('.ss-row--top .ss-name').textContent).toBe('Comet');
  body.querySelector('.an-pick-best').onclick();
  expect(onPick).toHaveBeenLastCalledWith(routes[3]);
  choose(body, 'all');
  [...body.querySelectorAll('.ss-tab')].find((b) => b.textContent === 'مدبلج').onclick();
  expect([...body.querySelectorAll('.ss-row')].map((b) => b.querySelector('.ss-host').textContent)).toEqual(['Mp4Upload']);
  expect(body.querySelector('.ss-tab.on').textContent).toBe('الكل');
  expect([...body.querySelectorAll('.ss-tab.on')].map((b) => b.textContent)).toEqual(['الكل', 'مدبلج']);
});

it('says plainly when nothing is ready, without a hero card, and offers a retry', () => {
  const { el, body } = dom();
  const onRetry = vi.fn();
  const ui = createServerSheet(body, { el, onPick() {}, onRetry });
  ui.update({ routes: [], settled: false, status: { text: 'نبحث…', spin: true } });
  expect(body.querySelectorAll('.ss-skel')).toHaveLength(5);
  expect(body.querySelector('.an-pick-best').textContent).toContain('شغّل أول سيرفر يجهز');
  ui.update({ routes: [{ id: 'x', sourceId: 'witanime', server: 'videa', quality: 480, state: 'UNAVAILABLE' }], settled: true, status: { text: '' }, retry: { wait: 0 } });
  expect(body.querySelector('.ss-note').textContent).toContain('لم يجهز أي سيرفر الآن');
  expect(body.querySelector('.an-srv-status').hidden).toBe(true);
  expect(body.querySelector('.ss-dead summary').textContent).toContain('1');
  body.querySelector('.an-pick-best').onclick();
  expect(onRetry).toHaveBeenCalled();
});

import { rank, learnStart } from './server-sheet.js';
import { rememberStart, startFeatures } from '../lib/start-memory.js';

const tor = (label, extra = {}) => ({ id: label, sourceId: TORR, sourceName: 'Torrentio', state: 'READY', runtimeReady: true, label, ...extra });
const score = (r) => rank(r, describeRoute(r));

it('«الأفضل» من جاهزية التورنت: المشاركون أولًا، والعربية ترجّح المتقاربين فقط، و1080 قبل 4K، وAV1 يتأخر', () => {
  globalThis.localStorage?.clear?.();
  const many = tor('A.1080p.WEB.x264\n👤 1000 💾 1.4 GB ⚙️ Nyaa', { quality: 1080 });
  const fewAr = tor('B.1080p.WEB.x264 Arabic\n👤 100 💾 1.4 GB ⚙️ Nyaa\n🇸🇦', { quality: 1080 });
  expect(score(many)).toBeGreaterThan(score(fewAr));
  const closeAr = tor('C.1080p.WEB.x264 Arabic\n👤 800 💾 1.4 GB ⚙️ Nyaa\n🇸🇦', { quality: 1080 });
  expect(score(closeAr)).toBeGreaterThan(score(many));
  const uhd = tor('D.2160p.WEB.x264\n👤 1000 💾 6 GB ⚙️ Nyaa', { quality: 2160 });
  expect(score(many)).toBeGreaterThan(score(uhd));
  const av1 = tor('E.1080p.WEB.AV1\n👤 1000 💾 331 MB ⚙️ Nyaa', { quality: 1080 });
  expect(score(many)).toBeGreaterThan(score(av1));
});

it('ما بدأ على هذا الجهاز ببطء يتأخر في الترشيح التالي (زمن المشغّل الأصلي الحقيقي)', () => {
  const store = new Map();
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), clear: () => store.clear() };
  try {
    const hevc = tor('F.1080p.WEB.HEVC-GRP\n👤 600 💾 1 GB ⚙️ Nyaa', { quality: 1080 });
    const avc = tor('G.1080p.WEB.x264-OTHER\n👤 500 💾 1 GB ⚙️ Nyaa', { quality: 1080 });
    expect(score(hevc)).toBeGreaterThan(score(avc) - 5e7);
    rememberStart(startFeatures(describeRoute(hevc)), 28000, true);
    expect(score(avc)).toBeGreaterThan(score(hevc));
    // learnStart لا ينسب زمنًا بلا صف لُمس
    learnStart({ stage: 'server', outcome: 'ok', ms: 1000 });
  } finally { globalThis.localStorage = saved; }
});

it('صف التورنت: الجودة والمصدر واللغة والحجم والمشاركون فقط، والباقي تحت السهم ولا يشغّل', () => {
  const { el, body } = dom();
  const onPick = vi.fn();
  const ui = createServerSheet(body, { el, onPick });
  const r = tor('[NyaaSi] Show Dubbed / Multi Subs 🇬🇧/🇷🇺 2160p WEB-DL HEVC DV DDP5.1\n👤 1100 💾 2.5 GB ⚙️ Nyaa\nMulti Audio / 🇸🇦', { quality: 2160 });
  ui.update({ routes: [r], settled: true, status: { text: '1' } });
  const row = body.querySelector('.ss-row');
  expect(row.querySelector('.ss-host').hidden).toBe(true);
  expect(row.querySelector('.ss-q small').textContent).toBe('');
  const meta = row.querySelector('.ss-meta').textContent;
  expect(meta).toContain('2.5 GB');
  expect(meta).not.toMatch(/HEVC|WEB-DL|DDP/);
  const chev = row.querySelector('.ss-chev');
  chev.onclick({ stopPropagation() {} });
  expect(row.classList.contains('ss-row--open')).toBe(true);
  expect(row.querySelector('.ss-details').textContent).toContain('HEVC');
  expect(onPick).not.toHaveBeenCalled();
});
