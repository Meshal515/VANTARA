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
  expect(body.querySelector('.ss-rec-name').textContent).toBe('WitAnime');
  expect(body.querySelector('.ss-rec').textContent).toContain('يبدأ فورًا');
  expect(body.querySelector('.ss-rec').textContent).toContain('مترجم عربي');
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
  body.querySelector('.ss-rec').onclick();
  expect(onPick).toHaveBeenLastCalledWith(routes[2]);
});
