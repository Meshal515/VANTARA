/**
 * ورقة السيرفرات المشتركة: أسماء بشرية بدل الرموز والمعرّفات الداخلية،
 * و«الأفضل لك» يقدّم المباشر ثم التورنت الصحيح السرب.
 */
import { parseHTML } from 'linkedom';
import { expect, it, vi } from 'vitest';
import { addonName, createServerSheet, describe as describeRoute, hostName, releaseGroup, sourceLabel, warmRows, warmScore } from './server-sheet.js';

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
    { id: 'slow', sourceId: 'okanime', server: 'mp4upload', code: 'MPU', quality: 1080, state: 'READY', probed: true, probeMs: 6000 },
    { id: 'fast', sourceId: 'witanime', server: 'streamwish', code: 'SWH', quality: 1080, state: 'READY', probed: true, probeMs: 700 },
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
  expect(body.querySelector('.an-pick-best small').textContent).toBe('1080p · WitAnime · عربي · يبدأ فورًا');
  // المباشر قبل التورنت، والأسرع بدءًا أولًا. الأماكن الظاهرة للصالح وحده (المالك، 15 نوفمبر): ما يُفحص ينتظر
  // في «قيد الفحص» ولا يحجز مكانًا يدفع صالحًا يصل بعده إلى «نسخ إضافية»
  const direct = [...body.querySelectorAll('.ss-group--direct > .an-srv-grid .ss-row')];
  expect(direct.map((b) => b.querySelector('.ss-host').textContent)).toEqual(['StreamWish', 'Mp4Upload']);
  const waiting = body.querySelector('.cn-srv-wait');
  expect(waiting.querySelector('summary').textContent).toBe('قيد الفحص (1)');
  expect(waiting.textContent).toContain('HG Cloud');
  expect(body.textContent).not.toMatch(/\b(?:SWH|MPU|TRR|HGC)\b/);
  expect(body.querySelector('.ss-group--torrent .ss-row .ss-name').textContent).toBe('Torrentio');
  // ما تعذّر قبل أن يظهر مطويّ في الأسفل
  expect(body.querySelector('.ss-dead summary').textContent).toContain('1');
  body.querySelector('.an-pick-best').onclick();
  expect(onPick).toHaveBeenCalledWith(routes[2], { tapAt: expect.any(Number) });
  top[0].onclick();
  expect(onPick).toHaveBeenLastCalledWith(routes[2], { tapAt: expect.any(Number) });
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

// القائمتان متجاورتان: [0] الجودة، [1] المصدر
const dropBtn = (body, i) => body.querySelectorAll('.ss-drop .ss-addon-btn')[i];
const menuOpts = (body) => [...body.querySelectorAll('.ss-addon-menu:not([hidden]) .ss-addon-opt')];
const choose = (body, value, i = 1) => {
  dropBtn(body, i).onclick({ stopPropagation() {} });
  menuOpts(body).find((o) => o.dataset.value === String(value)).onclick({ stopPropagation() {} });
};

it('filters by quality and source as two side-by-side menus, and language as two buttons', () => {
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
  // لا صف جودات كامل: زر واحد يفتح قائمة بالجودات المتوفرة
  expect([...body.querySelectorAll('.ss-tab')].map((b) => b.textContent)).toEqual(['مترجم', 'مدبلج']);
  expect(dropBtn(body, 0).textContent).toContain('كل الجودات');
  dropBtn(body, 0).onclick({ stopPropagation() {} });
  expect(menuOpts(body).map((o) => o.textContent)).toEqual(['كل الجودات', '4K', '1080p', '720p']);
  dropBtn(body, 0).onclick({ stopPropagation() {} });
  dropBtn(body, 1).onclick({ stopPropagation() {} });
  expect(menuOpts(body).map((o) => o.textContent)).toEqual(['كل المصادر', 'WitAnime', 'Torrentio', 'Comet']);
  dropBtn(body, 1).onclick({ stopPropagation() {} });
  choose(body, 720, 0);
  expect([...body.querySelectorAll('.ss-row')].map((b) => b.querySelector('.ss-host').textContent)).toEqual(['Mp4Upload']);
  expect(dropBtn(body, 0).textContent).toContain('720p');
  choose(body, 'all', 0);
  choose(body, 'Comet');
  expect([...body.querySelectorAll('.ss-row')].map((b) => b.querySelector('.ss-name').textContent)).toEqual(['Comet']);
  // المقترح والزر يتبعان المرشّح
  expect(body.querySelector('.ss-row--top .ss-name').textContent).toBe('Comet');
  body.querySelector('.an-pick-best').onclick();
  expect(onPick).toHaveBeenLastCalledWith(routes[3], { tapAt: expect.any(Number) });
  choose(body, 'all');
  [...body.querySelectorAll('.ss-tab')].find((b) => b.textContent === 'مدبلج').onclick();
  expect([...body.querySelectorAll('.ss-row')].map((b) => b.querySelector('.ss-host').textContent)).toEqual(['Mp4Upload']);
  expect([...body.querySelectorAll('.ss-tab.on')].map((b) => b.textContent)).toEqual(['مدبلج']);
});

it('says plainly when nothing is ready, without a hero card, and offers a retry', () => {
  const { el, body } = dom();
  const onRetry = vi.fn();
  const ui = createServerSheet(body, { el, onPick() {}, onRetry });
  ui.update({ routes: [], settled: false, status: { text: 'نبحث…', spin: true } });
  expect(body.querySelectorAll('.ss-skel')).toHaveLength(5);
  // لا «شغّل أول ما يجهز»: الأفضل من الصالح وحده، فالزر ينتظر رابطًا صالحًا
  expect(body.querySelector('.an-pick-best').textContent).toContain('ننتظر رابطًا صالحًا');
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

it('«الأفضل» من جدول المعايير: تورنت يدعم العربية يغلب، و1080 قبل 4K، وAV1 يتأخر، والسرب الأقوى يرجّح المتساويين', () => {
  globalThis.localStorage?.clear?.();
  const many = tor('A.1080p.WEB.x264\n👤 1000 💾 1.4 GB ⚙️ Nyaa', { quality: 1080 });
  const fewAr = tor('B.1080p.WEB.x264 Arabic\n👤 100 💾 1.4 GB ⚙️ Nyaa\n🇸🇦', { quality: 1080 });
  expect(score(fewAr)).toBeGreaterThan(score(many));
  const fewer = tor('A2.1080p.WEB.x264\n👤 20 💾 1.4 GB ⚙️ Nyaa', { quality: 1080 });
  expect(score(many)).toBeGreaterThan(score(fewer));
  const uhd = tor('D.2160p.WEB.x264\n👤 1000 💾 6 GB ⚙️ Nyaa', { quality: 2160 });
  expect(score(many)).toBeGreaterThan(score(uhd));
  const av1 = tor('E.1080p.WEB.AV1\n👤 1000 💾 331 MB ⚙️ Nyaa', { quality: 1080 });
  expect(score(many)).toBeGreaterThan(score(av1));
  // سرب بلا مشاركين أو بلا عدد معلن ليس صالحًا: لا درجة له أصلًا
  expect(score(tor('Z.1080p.WEB.x264\n👤 0 💾 1 GB ⚙️ Nyaa', { quality: 1080 }))).toBe(-Infinity);
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


const CS3_RIFT = 'addon|cs3|cs3_0123456789abcdef0123456789abcdef|aa0123456789abcdef012345|u123456789abcdef123456789';
const CS3_4UP = 'addon|cs3|cs3_abcdef0123456789abcdef0123456789|bb0123456789abcdef012345|u123456789abcdef123456789';
it('native CloudStream media routes are direct even when the runtime reported them ready', () => {
  const direct = describeRoute({ id: 'rift-1', sourceId: CS3_RIFT, sourceName: 'AnimeRift', server: 'vidmoly', code: 'VDM',
    quality: 1080, state: 'READY', runtimeReady: true, probed: true });
  expect(direct.torrent).toBe(false);
  expect(direct.name).toBe('AnimeRift');
  const ordinary = describeRoute({ id: 'native', sourceId: 'witanime', sourceName: 'WitAnime', server: 'mp4upload',
    state: 'READY', runtimeReady: true, probed: true });
  expect(ordinary.torrent).toBe(false);
  expect(describeRoute({ id: 'torrent', sourceId: TORR, sourceName: 'Torrentio', state: 'READY', runtimeReady: true }).torrent).toBe(true);
});

it('CloudStream sources that arrive after torrents join quietly below them (no jump) and populate the source menu', () => {
  const { body, el } = dom(), onPick = vi.fn();
  const ui = createServerSheet(body, { el, onPick, sourceName: (r) => r.sourceId });
  const torrent = { id: 'torrent', sourceId: TORR, sourceName: 'Torrentio', state: 'READY', quality: 1080, runtimeReady: true,
    label: 'Series S01E01 1080p 👤 92' };
  const rift = { id: 'rift', sourceId: CS3_RIFT, sourceName: 'AnimeRift', state: 'READY', server: 'vidmoly',
    quality: 1080, variant: 'SUB', runtimeReady: true, probed: true, probeMs: 500 };
  const anime4up = { id: 'fourup', sourceId: CS3_4UP, sourceName: 'Anime4up', state: 'READY', server: 'mp4upload',
    quality: 720, variant: 'SUB', runtimeReady: true, probed: true, probeMs: 800 };
  ui.update({ routes: [torrent], settled: false, status: { text: '1 جاهز' } });
  expect(dropBtn(body, 1).disabled).toBe(true); // one source only: the menu is there (no later jump) but has nothing to choose
  const torrentRow = body.querySelector('.ss-group--torrent .ss-row');
  ui.update({ routes: [torrent, rift, anime4up], settled: true, status: { text: '3 جاهزة' } });
  // التورنت ظهر أولًا فيبقى أولًا وصفّه نفسه بمكانه؛ المباشر يُضاف تحته
  expect(body.querySelector('.an-srv-list').firstElementChild.className).toContain('ss-group--torrent');
  expect(body.querySelector('.ss-group--torrent .ss-row')).toBe(torrentRow);
  const direct = [...body.querySelectorAll('.ss-group--direct .ss-row')];
  expect(direct.map(r => r.querySelector('.ss-name').textContent)).toEqual(['AnimeRift', 'Anime4up']);
  expect([...body.querySelectorAll('.ss-group--torrent .ss-row')].map(r => r.querySelector('.ss-name').textContent)).toEqual(['Torrentio']);
  expect(dropBtn(body, 1).textContent).toContain('كل المصادر');
  dropBtn(body, 1).onclick({ stopPropagation() {} });
  expect(menuOpts(body).map(o => o.textContent)).toEqual(['كل المصادر', 'Torrentio', 'AnimeRift', 'Anime4up']);
  dropBtn(body, 1).onclick({ stopPropagation() {} });
  // No user filter interaction needed: all 3 are visible, directly selectable.
  body.querySelector('.ss-group--direct .ss-row').onclick();
  expect(onPick).toHaveBeenCalledWith(rift, { tapAt: expect.any(Number) });
  choose(body, 'Anime4up');
  expect([...body.querySelectorAll('.ss-row')].map(r => r.querySelector('.ss-name').textContent)).toEqual(['Anime4up']);
  choose(body, 'all');
  expect(body.querySelectorAll('.ss-group--direct .ss-row')).toHaveLength(2);
  expect(body.querySelectorAll('.ss-group--torrent .ss-row')).toHaveLength(1);
});

it('غير المتاح مطويّ تحت الجاهز ويقول سببه في سطره، لا بعد لمسة', () => {
  const { el, body } = dom();
  const ui = createServerSheet(body, { el, onPick() {} });
  ui.update({
    routes: [
      { id: 'ok', sourceId: 'witanime', server: 'ok.ru', quality: 1080, state: 'READY', probed: true, candidates: ['c1'] },
      { id: 'cf', sourceId: 'witanime', server: 'videa', quality: 720, state: 'UNAVAILABLE', reason: 'CLOUDFLARE' },
    ],
    settled: true,
    status: { text: 'سيرفر جاهز' },
  });
  const dead = body.querySelector('.ss-dead');
  expect(dead.querySelector('summary').textContent).toContain('1');
  const why = dead.querySelector('.ss-bad');
  expect(why.textContent).not.toBe('');
  expect(why.textContent).not.toBe('غير متاح');
});

it('an Aniyomi torrent route (Torrentio Anime magnet → native ticket) is a torrent row, not a direct Arabic one', () => {
  const route = { sourceId: 'torrentio-anime', sourceName: 'Torrentio Anime', server: 'Torrentio Anime', type: 'torrent', quality: 1080,
    label: '1080p\nBlack Lagoon - 01 [1080p].mkv\n👤 39 💾 1.7 GB ⚙️ NyaaSi', variant: 'SUB' };
  const d = describeRoute(route, { directLang: 'مترجم عربي', sourceName: () => 'Torrentio Anime' });
  expect(d.torrent).toBe(true);
  expect(d.info.seeders).toBe(39);
  expect(d.host).toContain('NyaaSi');
  expect(d.langs.map((l) => l.t)).not.toContain('مترجم عربي');
});

it('قائمة المصدر المفتوحة تبقى مفتوحة حين يصل سيرفر جديد، ويظهر مصدره فيها', () => {
  const { el, body } = dom();
  const ui = createServerSheet(body, { el, onPick() {} });
  const r = (id, name) => ({ id, sourceId: id, sourceName: name, state: 'READY', quality: 1080, runtimeReady: true, probed: true });
  ui.update({ routes: [r('a', 'Torrentio'), r('b', 'ArabAnime')], settled: false, status: { text: '2' } });
  dropBtn(body, 1).onclick({ stopPropagation() {} });
  const menu = body.querySelector('.ss-addon-menu:not([hidden])');
  ui.update({ routes: [r('a', 'Torrentio'), r('b', 'ArabAnime'), r('c', 'AnimeRift')], settled: false, status: { text: '3' } });
  // القائمة نفسها (لا تُحذف وتُعاد فتومض) ما زالت مفتوحة، وفيها المصدر الجديد
  expect(body.querySelector('.ss-addon-menu:not([hidden])')).toBe(menu);
  expect([...menu.querySelectorAll('.ss-addon-opt')].map((o) => o.textContent)).toEqual(['كل المصادر', 'Torrentio', 'ArabAnime', 'AnimeRift']);
  expect(dropBtn(body, 1).getAttribute('aria-expanded')).toBe('true');
  // اختيار مصدر يغلقها كالعادة
  menu.querySelector('[data-value="AnimeRift"]').onclick({ stopPropagation() {} });
  expect(menu.hidden).toBe(true);
});

it('keeps existing direct rows under the finger and applies the latest ranking when scrolling stops', () => {
  vi.useFakeTimers();
  try {
    const { el, body, document } = dom();
    const onPick = vi.fn();
    const ui = createServerSheet(body, { el, onPick });
    const first = { id: 'a', sourceId: 'witanime', server: 'mp4upload', quality: 720, state: 'READY', probed: true, probeMs: 3000 };
    const second = { id: 'a2', sourceId: 'witanime', server: 'uqload', quality: 480, state: 'READY', probed: true, probeMs: 4000 };
    const pending = { id: 'b', sourceId: 'witanime', server: 'videa', state: 'RESOLVING' };
    const best = { id: 'c', sourceId: 'okanime', server: 'streamwish', quality: 1080, state: 'READY', probed: true, probeMs: 500 };
    const rows = () => [...body.querySelectorAll('.ss-group--direct > .an-srv-grid .ss-row')];
    ui.update({ routes: [first, second, pending] });
    const before = rows();
    const filters = body.querySelector('.an-pick-filters');
    ui.scroll.dispatchEvent(new document.defaultView.Event('touchstart'));
    ui.update({ routes: [first, second, { ...pending, state: 'UNAVAILABLE' }, best] });
    expect(rows()).toEqual(before);
    before[0].onclick();
    expect(onPick).toHaveBeenCalledWith(first, { tapAt: expect.any(Number) });
    ui.scroll.dispatchEvent(new document.defaultView.Event('touchend'));
    vi.advanceTimersByTime(181);
    expect(rows().slice(1)).toEqual(before);
    expect(rows()[0].classList.contains('ss-row--top')).toBe(true);
    expect(body.querySelector('.an-pick-filters')).toBe(filters);
    ui.destroy();
  } finally { vi.useRealTimers(); }
});

it('one torrent release is one row even when Torrentio arrives from three providers', () => {
  const { el, body } = dom();
  const ui = createServerSheet(body, { el, onPick() {}, sourceName: (r) => r.sourceName });
  const t = (id, sourceId, sourceName, seeds) => ({ id, sourceId, sourceName, type: 'torrent', quality: 1080, state: 'READY', runtimeReady: true,
    label: `Sousou.no.Frieren.S01E03.1080p.WEB.mkv\nSousou.no.Frieren.S01E03.1080p.WEB.mkv\n👤 ${seeds} 💾 1.4 GB ⚙️ Nyaa` });
  ui.update({ routes: [t('a', 'addon|torrentio', 'Torrentio', 40), t('b', 'user-torrentio', 'Torrentio (Aniyomi)', 65), t('c', 'user-torrentioanime', 'Torrentio Anime', 20)], settled: true, status: { text: '' } });
  const rows = [...body.querySelectorAll('.ss-group--torrent .ss-row')];
  expect(rows).toHaveLength(1);
  expect(rows[0].textContent).toContain('65');
});

// طلب المالك (15 نوفمبر): «كيف أعرف أنها من CloudStream؟ المفروض تبان صورة الموقع واسمه»
it('each direct row shows its source picture beside the name, in a slot reserved before it arrives', () => {
  const { el, body } = dom();
  const icons = { anime4up: 'https://raw.githubusercontent.com/repo/icons/anime4up.png', bad: 'javascript:alert(1)' };
  const ui = createServerSheet(body, { el, onPick() {}, sourceName: (r) => r.sourceId, sourceIcon: (r) => icons[r.sourceId] ?? null });
  ui.update({ routes: [
    { id: 'a', sourceId: 'anime4up', server: 'voe', quality: 720, state: 'READY', probed: true },
    { id: 'b', sourceId: 'bad', server: 'mp4upload', quality: 720, state: 'READY', probed: true },
    { id: 't', sourceId: TORR, sourceName: 'Torrentio', quality: 1080, state: 'READY', runtimeReady: true, label: 'X.1080p\n👤 50 💾 1 GB' },
  ], settled: true, status: { text: '' } });
  const icon = (id) => [...body.querySelectorAll('.ss-row')].find((b) => b.querySelector('.ss-name').textContent === id).querySelector('.ss-ico');
  expect(icon('anime4up').getAttribute('style')).toContain('anime4up.png');
  expect(icon('anime4up').hidden).toBe(false);
  // عنوان غير آمن لا يصل إلى CSS، والخانة باقية بمقاسها
  expect(icon('bad').getAttribute('style') ?? '').not.toContain('javascript');
  expect(icon('bad').hidden).toBe(false);
  expect(icon('Torrentio').hidden).toBe(true);
});


it('كل قسم 10 ظاهرة ثم «عرض N من الإضافية» (المالك، 27 نوفمبر): المباشر عشرة، والتورنت خمسة لكل جودة', () => {
  const { el, body } = dom();
  const ui = createServerSheet(body, { el, onPick() {}, sourceName: (r) => r.sourceId });
  const direct = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, sourceId: 'witanime', server: `host${i}`, quality: 1080, state: 'READY', probed: true, probeMs: 500 + i }));
  const torrents = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, sourceId: TORR, sourceName: 'Torrentio', quality: 1080, state: 'READY', runtimeReady: true, label: `Show.S01E01.1080p.WEB-DL-G${i}.mkv\n👤 ${100 + i} 💾 1.${i} GB ⚙️ Nyaa` }));
  const cam = { id: 'cam', sourceId: TORR, sourceName: 'Torrentio', quality: 720, state: 'READY', runtimeReady: true, label: 'Show.S01E01.HDCAM.mkv\n👤 3 💾 700 MB ⚙️ Nyaa' };
  ui.update({ routes: [...direct, ...torrents, cam], settled: true, status: { text: '' } });
  expect(body.querySelectorAll('.ss-group--direct > .an-srv-grid .ss-row').length).toBe(10);
  const more = body.querySelector('.ss-group--direct .ss-more-btn');
  expect(more.hidden).toBe(false);
  expect(more.textContent).toBe('عرض 10 من الروابط الإضافية');
  // المطويّة لا تُبنى حتى تُفتح، والفتح يعرضها تحت الظاهرة دون أن يحرّكها
  expect(body.querySelectorAll('.ss-group--direct .ss-more-grid .ss-row').length).toBe(0);
  const firstTen = [...body.querySelectorAll('.ss-group--direct > .an-srv-grid .ss-row')];
  more.onclick({ stopPropagation() {} });
  expect(body.querySelectorAll('.ss-group--direct .ss-more-grid .ss-row').length).toBe(10);
  const same = () => [...body.querySelectorAll('.ss-group--direct > .an-srv-grid .ss-row')].map((n, i) => n === firstTen[i]);
  expect(same()).toEqual(Array(10).fill(true));
  expect(more.textContent).toBe('إخفاء الروابط الإضافية');
  more.onclick({ stopPropagation() {} });
  // جودة واحدة: أقوى خمسة، والنسخة المصوّرة في الإضافية.
  expect(body.querySelectorAll('.ss-group--torrent > .an-srv-grid .ss-row').length).toBe(5);
  expect(body.querySelector('.ss-group--torrent > .an-srv-grid').textContent).not.toContain('CAM');
  // ما يصل بعدها بجودة أقل يذهب إلى الإضافية، والظاهر لا يتغير
  ui.update({ routes: [...direct, ...torrents, cam, { id: 'late', sourceId: 'witanime', server: 'late', quality: 720, state: 'READY', probed: true, probeMs: 900 }], settled: true, status: { text: '' } });
  expect(same()).toEqual(Array(10).fill(true));
  expect(more.textContent).toBe('عرض 11 من الروابط الإضافية');
});

it('التورنت: حتى 5 من كل جودة بالترتيب (4K ثم 1080p) والسرب داخلها، والباقي في «عرض N من النسخ الإضافية» (المالك، 27 نوفمبر)', () => {
  const { el, body } = dom();
  const ui = createServerSheet(body, { el, onPick() {} });
  const mk = (q, i, seeds) => ({ id: `${q}-${i}`, sourceId: TORR, sourceName: 'Torrentio', quality: q, state: 'READY', runtimeReady: true, infoHash: `${q}${i}`.padEnd(40, '0'),
    label: `Show.S01E01.${q}p.WEB-DL-G${q}x${i}.mkv\n👤 ${seeds} 💾 ${q === 2160 ? 6 : 2}.${i} GB ⚙️ TPB` });
  // تصل مختلطة: السرب الأكبر ليس أولًا
  const routes = [
    ...[12, 86, 15, 7, 11, 10, 3].map((s, i) => mk(2160, i, s)),
    ...[40, 9, 120, 33, 5, 60, 2].map((s, i) => mk(1080, i, s)),
    ...[500, 400].map((s, i) => mk(720, i, s)),
  ];
  ui.update({ routes, settled: true, status: { text: '' } });
  const shown = [...body.querySelectorAll('.ss-group--torrent > .an-srv-grid .ss-row')].map((b) => `${b.querySelector('.ss-q b').textContent} ${b.querySelector('.an-srv-seeds')?.textContent}`);
  expect(shown).toEqual(['4K 86', '4K 15', '4K 12', '4K 11', '4K 10', '1080p 120', '1080p 60', '1080p 40', '1080p 33', '1080p 9']);
  expect(body.querySelector('.ss-group--torrent .ss-more-btn').textContent).toBe('عرض 6 من النسخ الإضافية');
  // المقترح تورنت: الأكبر سربًا لا الأضعف
  expect(body.querySelector('.ss-row--top .an-srv-seeds').textContent).toBe('120');
  // قبل أن يلمس المستخدم الورقة: سرب أقوى يصل لاحقًا يأخذ مكانه الصحيح في الخمسة
  ui.update({ routes: [...routes, mk(2160, 9, 300)], settled: true, status: { text: '' } });
  const again = [...body.querySelectorAll('.ss-group--torrent > .an-srv-grid .ss-row')].map((b) => b.querySelector('.an-srv-seeds')?.textContent);
  expect(again.slice(0, 5)).toEqual(['300', '86', '15', '12', '11']);
});

it('جودة غير معلنة تظهر «تلقائي» لا «HD» (UX11)، والمعلنة كما هي', () => {
  const { el, body } = dom();
  const ui = createServerSheet(body, { el, onPick: vi.fn() });
  const unknown = { id: 'u', sourceId: 'witanime', sourceName: 'Witanime', server: 'hls', state: 'READY', probed: true, probeMs: 400 };
  const known = { id: 'k', sourceId: 'witanime', sourceName: 'Witanime', server: 'mp4', quality: 720, state: 'READY', probed: true, probeMs: 400 };
  ui.update({ routes: [unknown, known], settled: true, status: { text: '2' } });
  const labels = Object.fromEntries([...body.querySelectorAll('.ss-row')].map((row) => [row.querySelector('.ss-name').textContent, row.querySelector('.ss-q')]));
  const qs = [...body.querySelectorAll('.ss-row .ss-q')];
  const texts = qs.map((q) => q.firstElementChild.textContent);
  expect(texts).toContain('تلقائي');
  expect(texts).toContain('720p');
  expect(texts).not.toContain('HD');
  expect(qs.find((q) => q.firstElementChild.textContent === 'تلقائي').classList.contains('ss-q--auto')).toBe(true);
  expect(qs.find((q) => q.firstElementChild.textContent === '720p').classList.contains('ss-q--auto')).toBe(false);
  expect(Object.keys(labels).length).toBeGreaterThan(0);
});

it('اختيار الجودة لا يُمسح بصمت إن غاب خياره مؤقتًا، ويعود حين يظهر (UX13)', () => {
  const { el, body } = dom();
  const ui = createServerSheet(body, { el, onPick: vi.fn() });
  const a = { id: 'a', sourceId: 'witanime', server: 'streamwish', quality: 1080, state: 'READY', probeMs: 700 };
  const b = { id: 'b', sourceId: 'witanime', server: 'mp4upload', quality: 720, state: 'READY', probeMs: 900 };
  const c = { id: 'c', sourceId: 'witanime', server: 'vidmoly', quality: 480, state: 'READY', probeMs: 900 };
  ui.update({ routes: [a, b, c], settled: false, status: { text: '3' } });
  choose(body, 1080, 0);
  const hosts = () => [...body.querySelectorAll('.ss-row')].map((r) => r.querySelector('.ss-host').textContent.toLowerCase());
  expect(hosts()).toEqual(['streamwish']);
  // سيرفر 1080 الوحيد سقط: تُعرض الكل بدل قائمة فارغة
  ui.update({ routes: [{ ...a, state: 'UNAVAILABLE' }, b, c], settled: false, status: { text: '2' } });
  expect(hosts().length).toBeGreaterThan(1);
  // وصل سيرفر 1080 جديد: اختيار المستخدم يعود
  const d = { id: 'd', sourceId: 'witanime', server: 'filemoon', quality: 1080, state: 'READY', probeMs: 600 };
  ui.update({ routes: [{ ...a, state: 'UNAVAILABLE' }, b, c, d], settled: true, status: { text: '3' } });
  // السيرفر الساقط يبقى ظاهرًا بسببه («غير متاح») كما هو مقصود؛ المهم أن 720/480 خرجا
  expect(hosts()).toContain('filemoon');
  expect(hosts()).not.toContain('mp4upload');
  expect(hosts()).not.toContain('vidmoly');
  // واختيار «كل الجودات» صراحة يُحترم أيضًا
  choose(body, 'all', 0);
  expect(hosts()).toContain('mp4upload');
});

it('UX14: البصمة هوية التورنت؛ الاسم والحجم احتياط فقط حين تغيب', () => {
  const { el, body } = dom();
  const ui = createServerSheet(body, { el, onPick: vi.fn() });
  const H1 = 'a'.repeat(40), H2 = 'b'.repeat(40);
  const label = 'Show.S01E01.1080p.WEB.x264\n👤 300 💾 1.4 GB ⚙️ Nyaa';
  const rows = () => body.querySelectorAll('.ss-row').length;
  // نفس الإصدار من مصدرين: البصمة نفسها واسم مختلف قليلًا ← صف واحد
  ui.update({ routes: [tor(label, { id: 's1', quality: 1080, infoHash: H1 }), tor('Show S01E01 1080p WEB x264 (copy)\n👤 120 💾 1.4 GB ⚙️ Nyaa', { id: 's2', quality: 1080, infoHash: H1 })], settled: true, status: { text: '' } });
  expect(rows()).toBe(1);
  // بصمتان مختلفتان بالاسم والحجم نفسيهما ← صفّان
  ui.update({ routes: [tor(label, { id: 'd1', quality: 1080, infoHash: H1 }), tor(label, { id: 'd2', quality: 1080, infoHash: H2 })], settled: true, status: { text: '' } });
  expect(rows()).toBe(2);
  // بلا بصمة عند أحدهما: الاسم والحجم يجمعانهما كما كان
  ui.update({ routes: [tor(label, { id: 'n1', quality: 1080, infoHash: H1 }), tor(label, { id: 'n2', quality: 1080 })], settled: true, status: { text: '' } });
  expect(rows()).toBe(1);
  // ومسار بلا بصمة لا يربط بصمتين مختلفتين
  ui.update({ routes: [tor(label, { id: 'c1', quality: 1080, infoHash: H1 }), tor(label, { id: 'c2', quality: 1080 }), tor(label, { id: 'c3', quality: 1080, infoHash: H2 })], settled: true, status: { text: '' } });
  expect(rows()).toBe(2);
});

it('المقترح تورنت يُعلن للتسخين مرة واحدة بعد أن يثبت، والمباشر لا', () => {
  vi.useFakeTimers();
  try {
    const { el, body } = dom();
    const onTop = vi.fn();
    const ui = createServerSheet(body, { el, onPick: vi.fn(), onTop });
    const t = tor('Show.S01E01.1080p.WEB.x264\n👤 900 💾 1.4 GB ⚙️ Nyaa', { id: 'tt', quality: 1080, infoHash: 'c'.repeat(40) });
    ui.update({ routes: [t], settled: false, status: { text: '1' } });
    ui.update({ routes: [t], settled: false, status: { text: '1' } });
    vi.advanceTimersByTime(399);
    expect(onTop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onTop).toHaveBeenCalledTimes(1);
    expect(onTop.mock.calls[0][0].id).toBe('tt');
    // نفس المقترح في تحديثات لاحقة: لا إعادة
    ui.update({ routes: [t], settled: true, status: { text: '1' } });
    vi.advanceTimersByTime(1000);
    expect(onTop).toHaveBeenCalledTimes(1);
    // مقترح مباشر لا تورنت: لا تسخين
    const { el: el2, body: body2 } = dom();
    const onTop2 = vi.fn();
    const ui2 = createServerSheet(body2, { el: el2, onPick: vi.fn(), onTop: onTop2 });
    ui2.update({ routes: [{ id: 'd', sourceId: 'witanime', server: 'mp4upload', quality: 1080, state: 'READY', probed: true, probeMs: 400 }], settled: true, status: { text: '1' } });
    vi.advanceTimersByTime(1000);
    expect(onTop2).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it('المقترح الثابت يُسخَّن بعد 400ms من ظهوره ولو تتابعت تحديثات الورقة (لا يجوّعه وصول السيرفرات)', () => {
  // الورقة تُحدَّث مع كل حدث من المحرك (سيرفر يصل، فحص يكتمل، حقائق كل 1.5 ث)، أسرع من 400ms ما دامت المصادر
  // تتوالى. كان كل update يلغي مؤقت «المقترح» ويعيد عدّه، فلا يبدأ التسخين حتى تهدأ الورقة (عينة المالك:
  // التسخين بدأ 0.7 و4.7 ث فقط قبل الضغط والورقة مفتوحة أطول). وكذلك الصفوف الخلفية.
  vi.useFakeTimers();
  try {
    const { el, body } = dom();
    const onTop = vi.fn(), onWarmRows = vi.fn();
    const ui = createServerSheet(body, { el, onPick: vi.fn(), onTop, onWarmRows });
    const t = tor('Show.S01E01.1080p.WEB.x264\n👤 900 💾 1.4 GB ⚙️ Nyaa', { id: 'tt', quality: 1080, infoHash: 'c'.repeat(40) });
    const extra = Array.from({ length: 12 }, (_, i) => tor(`Show.S01E01.720p.WEB.x264-G${i}\n👤 ${40 + i} 💾 700 MB ⚙️ Nyaa`, { id: `x${i}`, quality: 720, infoHash: String(i % 10).repeat(40) }));
    // سيرفر جديد كل 100ms على مدى 3 ث، و«المقترح» نفسه لا يتغير
    for (let i = 0; i < 30; i++) {
      ui.update({ routes: [t, ...extra.slice(0, Math.min(extra.length, Math.floor(i / 2)))], settled: false, status: { text: String(i) } });
      vi.advanceTimersByTime(100);
      if (i === 4) expect(onTop).toHaveBeenCalledTimes(1);
    }
    expect(onTop).toHaveBeenCalledTimes(1);
    expect(onTop.mock.calls[0][0].id).toBe('tt');
    // الصفوف الخلفية: قائمتها ثبتت في آخر 600ms (الاثنا عشر وصلوا) والتحديثات ما زالت كل 100ms، فأُعلنت مرة
    expect(onWarmRows).toHaveBeenCalledTimes(1);
    // والقائمة نفسها في تحديثات لاحقة لا تُعاد
    for (let i = 0; i < 10; i++) {
      ui.update({ routes: [t, ...extra], settled: false, status: { text: `s${i}` } });
      vi.advanceTimersByTime(100);
    }
    expect(onWarmRows).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it('حقائق المحرك (حجم القطعة والسرب المقاس) تنقل «المقترح» بين المتقاربين ولا تحرك الصفوف', () => {
  const { el, body } = dom();
  const ui = createServerSheet(body, { el, onPick: vi.fn() });
  const big = tor('Show.S01E01.1080p.WEB.x264-AAA\n👤 900 💾 1.4 GB ⚙️ Nyaa', { id: 'big', quality: 1080, infoHash: 'a'.repeat(40) });
  const small = tor('Show.S01E01.1080p.WEB.x264-BBB\n👤 850 💾 1.4 GB ⚙️ Nyaa', { id: 'small', quality: 1080, infoHash: 'b'.repeat(40) });
  const order = () => [...body.querySelectorAll('.ss-group--torrent .ss-row')].map((b) => (b.textContent.includes('AAA') ? 'AAA' : b.textContent.includes('BBB') ? 'BBB' : '?'));
  const topName = () => body.querySelector('.ss-row--top')?.textContent ?? '';
  ui.update({ routes: [big, small], settled: true, status: { text: '' } });
  const before = order();
  expect(before).toEqual(['AAA', 'BBB']);
  expect(topName()).toContain('AAA');
  // المُسخَّن الأول قطعه 8MB والثاني 1MB، والسرب المقاس متقارب: الأصغر قطعةً يبدأ أسرع
  ui.update({ routes: [big, small], facts: { big: { pieceLength: 8 << 20, seeds: 700, peers: 12 }, small: { pieceLength: 1 << 20, seeds: 650, peers: 10 } }, settled: true, status: { text: '' } });
  expect(topName()).toContain('BBB');
  expect(order()).toEqual(before);
  // صفر مقاس بلا اتصال ليس دليل موت: يبقى المعلن
  ui.update({ routes: [big, small], facts: { small: { pieceLength: 1 << 20, seeds: 0, peers: 0 } }, settled: true, status: { text: '' } });
  expect(topName()).toContain('BBB');
});

it('التسخين (المالك، 27 نوفمبر): برق التسخين يبقى تحت المغناطيس ويختفي عندما تزول الجاهزية', () => {
  const { el, body } = dom();
  const ui = createServerSheet(body, { el, onPick: vi.fn() });
  const t = (id, seeds) => tor(`Show.S01E01.1080p.WEB.x264-${id}\n👤 ${seeds} 💾 1.4 GB ⚙️ Nyaa`, { id, quality: 1080, infoHash: id.padEnd(40, '0') });
  const routes = [t('aaa', 900), t('bbb', 12), t('ccc', 3)];
  const row = (id) => [...body.querySelectorAll('.ss-group--torrent .ss-row')].find((b) => b.textContent.toLowerCase().includes(id));
  ui.update({ routes, settled: true, status: { text: '' } });
  // لا شيء في المحرك: مغناطيس، ولا بنفسجي
  for (const id of ['aaa', 'bbb', 'ccc']) {
    expect(row(id).classList.contains('ss-row--warming')).toBe(false);
    expect(row(id).querySelector('.ss-bolt')).toBeNull();
  }
  // الزارعون: قوي ≥20 أخضر، 5–19 برتقالي، 1–4 أحمر (صنف الطبقة؛ اللون في CSS)
  expect(row('aaa').querySelector('.ss-seeds--strong')).not.toBeNull();
  expect(row('bbb').querySelector('.ss-seeds--fair')).not.toBeNull();
  expect(row('ccc').querySelector('.ss-seeds--weak')).not.toBeNull();
  // aaa في المحرك ولم يجهز: يسخن
  ui.update({ routes, facts: { aaa: { pieceLength: 2 << 20, seeds: 800, peers: 9, ready: false } }, settled: true, status: { text: '' } });
  expect(row('aaa').classList.contains('ss-row--warming')).toBe(true);
  expect(row('aaa').classList.contains('ss-row--warm')).toBe(false);
  expect(row('aaa').querySelector('.ss-bolt')).not.toBeNull();
  expect(row('bbb').classList.contains('ss-row--warming')).toBe(false);
  // إشارة المحرك: جاهز
  ui.update({ routes, facts: { aaa: { pieceLength: 2 << 20, seeds: 800, peers: 9, ready: true } }, settled: true, status: { text: '' } });
  expect(row('aaa').classList.contains('ss-row--warm')).toBe(true);
  expect(row('aaa').classList.contains('ss-row--warming')).toBe(false);
  expect(row('aaa').querySelector('.ss-bolt')).not.toBeNull();
  expect(row('aaa').querySelector('.ss-kind').children).toHaveLength(2);
  ui.update({ routes, facts: {} });
  expect(row('aaa').classList.contains('ss-row--warm')).toBe(false);
  expect(row('aaa').querySelector('.ss-bolt')).toBeNull();
});

it('ترتيب التسخين الخلفي: السرب 16 ثم حجم القطعة 12 ثم العربي 2، وما سربه 20 فأقل يُترك إن وُجد أقوى', () => {
  const row = (id, seeders, { arabic = false, piece } = {}) => ({ r: { id }, d: { torrent: true, info: { seeders, arabic }, langs: [] }, m: piece ? { pieceLength: piece, seeds: seeders, peers: 3 } : undefined });
  // السرب الأقوى وزنًا: 900 بقطعة 2MB فوق 40 بقطعة 512KB
  expect(warmRows([row('small', 40, { piece: 512 << 10 }), row('big', 900, { piece: 2 << 20 })])).toEqual(['big', 'small']);
  // لكن القطعة الضخمة (8MB = 16 ضعف 512KB قبل أول صورة) تخسر أمام سرب كافٍ (60) بقطعة صغيرة
  expect(warmScore(row('a', 900, { piece: 8 << 20 }).d, row('a', 900, { piece: 8 << 20 }).m)).toBeCloseTo(19.4, 1);
  expect(warmRows([row('small', 60, { piece: 512 << 10 }), row('big', 900, { piece: 8 << 20 })])).toEqual(['small', 'big']);
  // حجم القطعة يحسم السرب المتقارب
  expect(warmRows([row('p8', 400, { piece: 8 << 20 }), row('p1', 380, { piece: 1 << 20 })])).toEqual(['p1', 'p8']);
  // العربي يحسم المتساوي فقط
  expect(warmRows([row('en', 300), row('ar', 300, { arabic: true })])).toEqual(['ar', 'en']);
  // قاعدة 20: الضعيف يُترك مع وجود أقوى، ويُسخَّن إن كان وحده
  expect(warmRows([row('w', 5), row('s', 21), row('e', 20)])).toEqual(['s']);
  expect(warmRows([row('w', 5), row('e', 20)])).toEqual(['e', 'w']);
});

it('الورقة ترسل الصفوف الظاهرة غير «المقترح» للتسخين الخلفي، لا النسخ الإضافية', () => {
  vi.useFakeTimers();
  try {
    const { el, body } = dom();
    const onWarmRows = vi.fn();
    const ui = createServerSheet(body, { el, onPick: vi.fn(), onWarmRows });
    const routes = Array.from({ length: 12 }, (_, i) => tor(`Show.S01E01.1080p.WEB.x264-G${i}\n👤 ${100 + i * 50} 💾 1.4 GB ⚙️ Nyaa`, { id: `t${i}`, quality: 1080, infoHash: String(i % 10).repeat(39) + String(Math.floor(i / 10)) }));
    ui.update({ routes, settled: true, status: { text: '' } });
    vi.advanceTimersByTime(401);
    expect(onWarmRows).toHaveBeenCalledTimes(1);
    const ids = onWarmRows.mock.calls[0][0];
    const top = body.querySelector('.ss-row--top');
    const shown = [...body.querySelectorAll('.ss-group--torrent > .an-srv-grid .ss-row')];
    // جودة واحدة: أقوى خمسة. المرشحون للتسخين الخلفي من الظاهر فقط.
    expect(shown.length).toBe(5);
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain('t0');
    expect(ids).not.toContain('t1');
    expect(ids).not.toContain(routes.find((r) => top.textContent.includes(r.label.split('\n')[0].split('-').pop())).id);
    // نفس القائمة في تحديث لاحق: لا إعادة
    ui.update({ routes, settled: true, status: { text: '' } });
    vi.advanceTimersByTime(1000);
    expect(onWarmRows).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it('الفأرة على صف تورنت 120ms تسخّنه، والخروج يعيد «المقترح»، واللمس لا يسخّن', () => {
  vi.useFakeTimers();
  try {
    const { el, body } = dom();
    const onHover = vi.fn();
    const ui = createServerSheet(body, { el, onPick: vi.fn(), onHover });
    const a = tor('Show.S01E01.1080p.WEB.x264-AAA\n👤 900 💾 1.4 GB ⚙️ Nyaa', { id: 'a', quality: 1080, infoHash: 'a'.repeat(40) });
    const b = tor('Show.S01E01.1080p.WEB.x264-BBB\n👤 40 💾 1.4 GB ⚙️ Nyaa', { id: 'b', quality: 1080, infoHash: 'b'.repeat(40) });
    ui.update({ routes: [a, b], settled: true, status: { text: '' } });
    const rowOf = (tag) => [...body.querySelectorAll('.ss-row')].find((x) => x.textContent.includes(tag));
    const fire = (node, type, pointerType) => { const e = new body.ownerDocument.defaultView.Event(type); Object.defineProperty(e, 'pointerType', { value: pointerType }); node.dispatchEvent(e); };
    fire(rowOf('BBB'), 'pointerenter', 'touch');
    vi.advanceTimersByTime(500);
    expect(onHover).not.toHaveBeenCalled();
    fire(rowOf('BBB'), 'pointerenter', 'mouse');
    vi.advanceTimersByTime(119);
    expect(onHover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onHover.mock.calls.map((c) => c[0].id)).toEqual(['b']);
    fire(rowOf('BBB'), 'pointerleave', 'mouse');
    vi.advanceTimersByTime(801);
    // «المقترح» (900 مشارك) يعود مسخَّنًا
    expect(onHover.mock.calls.map((c) => c[0].id)).toEqual(['b', 'a']);
  } finally { vi.useRealTimers(); }
});

it('ranks late stronger torrents after a touch gesture, independent of language and arrival order', () => {
  vi.useFakeTimers();
  try {
    const { el, body, document } = dom();
    const ui = createServerSheet(body, { el, onPick() {} });
    const mk = (seeders, index) => tor(`Show.1080p.WEB-G${index}.mkv\n👤 ${seeders} 💾 2 GB`, {
      id: 'late-' + index, seeders, quality: 1080, infoHash: index.toString(16).padStart(40, '0'),
      variant: index < 2 ? 'DUB' : 'SUB',
    });
    const first = [mk(19, 0), mk(1, 1)], late = [mk(381, 2), mk(379, 3), mk(258, 4)];
    const displayed = () => [...body.querySelectorAll('.ss-group--torrent > .an-srv-grid .an-srv-seeds')].map(x => Number(x.textContent));
    ui.update({ routes: first });
    const Event = document.defaultView.Event;
    ui.scroll.dispatchEvent(new Event('touchstart'));
    ui.update({ routes: [...first, ...late] });
    expect(displayed()).toEqual([19, 1]);
    ui.scroll.dispatchEvent(new Event('touchend'));
    vi.advanceTimersByTime(300);
    expect(displayed()).toEqual([381, 379, 258, 19, 1]);
    ui.destroy();
  } finally { vi.useRealTimers(); }
});

// تقرير الذهب يقيس من الضغطة الحقيقية: ساعة الحدث (timeOrigin + timeStamp)، لا لحظة فتح المصدر
it('tapTime returns the event clock and rejects foreign or future stamps', async () => {
  const { tapTime } = await import('./server-sheet.js');
  const perf = { timeOrigin: 1_000_000 };
  expect(tapTime({ timeStamp: 2_500 }, perf, 1_003_000)).toBe(1_002_500);
  // ساعة حدث بعد الآن أو أقدم من دقيقة: الآن
  expect(tapTime({ timeStamp: 9_000 }, perf, 1_003_000)).toBe(1_003_000);
  expect(tapTime({ timeStamp: 1 }, perf, 1_100_000)).toBe(1_100_000);
  expect(tapTime(null, perf, 42)).toBe(42);
});

// شعار القسم يمثل المحرك لا أول مصدر فيه (المالك: قسم CloudStream كان يعرض شعار AnimeRift)، وللتورنت عنوان وعلامة
it('section marks come from the engine identity, never from the first source inside', async () => {
  const { routeEngine } = await import('../lib/route-family.js');
  const { body, el } = dom();
  const rift = { id: 'rift', sourceId: CS3_RIFT, sourceName: 'AnimeRift', state: 'READY', server: 'vidmoly', quality: 1080, runtimeReady: true, probed: true };
  const torrent = { id: 't', sourceId: TORR, sourceName: 'Torrentio', state: 'READY', quality: 1080, runtimeReady: true, label: 'X S01E01 1080p 👤 92' };
  const native = { id: 'n', sourceId: 'witanime', sourceName: 'WitAnime', state: 'READY', server: 'mp4upload', runtimeReady: true, probed: true };
  const ui = createServerSheet(body, { el, onPick() {}, sourceName: (r) => r.sourceName, sourceIcon: (r) => (r.id === 'rift' ? 'https://img.example/rift.png' : null) });
  ui.update({ routes: [torrent, rift, native], settled: true, status: { text: '3' } });
  const ico = (cls) => body.querySelector(`.${cls} > .an-srv-q > .ss-group-ico`);
  expect(ico('ss-group--cloudstream').hidden).toBe(false);
  expect(ico('ss-group--cloudstream').dataset.mark).toBe('cloudstream');
  expect(ico('ss-group--cloudstream').style.backgroundImage || '').not.toContain('rift');
  expect(ico('ss-group--torrent').dataset.mark).toBe('torrent');
  expect(ico('ss-group--torrent').hidden).toBe(false);
  // «مباشر» لمصدر مدمج بلا هوية محرك: بلا علامة، لا تصنيف مخترع
  expect(ico('ss-group--direct:not(.ss-group--engine)').hidden).toBe(true);
  // الهوية من صيغ المحرك نفسه: النقل أولًا، ثم CloudStream، ثم Stremio، ثم Aniyomi المثبتة
  expect([torrent, rift, native, { sourceId: 'addon|https://debrid.example/manifest.json', type: 'http' }, { sourceId: 'user-animerco' }].map(routeEngine))
    .toEqual(['torrent', 'cloudstream', null, 'stremio', 'aniyomi']);
});

it('the generic direct section takes an engine mark only when every row shares that engine', () => {
  const { body, el } = dom();
  const debrid = (id) => ({ id, sourceId: `addon|https://debrid.example/${id}`, sourceName: 'Comet', type: 'http', state: 'READY', server: 'https://cdn.example/v.mp4', runtimeReady: true, probed: true });
  const ui = createServerSheet(body, { el, onPick() {}, sourceName: (r) => r.sourceName });
  ui.update({ routes: [debrid('a'), debrid('b')], settled: true, status: { text: '2' } });
  const ico = () => body.querySelector('.ss-group--direct:not(.ss-group--engine) > .an-srv-q > .ss-group-ico');
  expect(ico().dataset.mark).toBe('stremio');
  ui.update({ routes: [debrid('a'), { id: 'n', sourceId: 'witanime', sourceName: 'WitAnime', state: 'READY', server: 'mp4upload', runtimeReady: true, probed: true }], settled: true, status: { text: '2' } });
  expect(ico().hidden).toBe(true);
});
