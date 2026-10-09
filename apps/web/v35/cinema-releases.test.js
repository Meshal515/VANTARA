/**
 * نسخ Torrentio في ورقة السيرفرات: ما قالته كل نسخة عن نفسها (المشاركين، الحجم،
 * المصدر، HDR، العربية) بدل 73 بطاقة «Torrentio» متشابهة، والأقوى سربًا أولًا،
 * وبلا مشاركين/CAM مطويّة — دون تشغيل تلقائي ودون إلغاء اختيار المستخدم.
 */
import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ routes: [], session: null, listeners: new Map(), open: vi.fn(), pick: vi.fn(async (_s, id) => id) }));
vi.mock('./motion.js', () => ({ pop() {}, progressFill() {}, reduced: () => true, revealIn() {}, stripIn() {} }));
vi.mock('../lib/anime-engine.js', async (original) => ({
  ...(await original()), available: () => true, sources: async () => [], onNeedsHuman() {},
  on: (event, fn) => { state.listeners.set(event, fn); return () => state.listeners.delete(event); },
  withAddonCopies: async () => [], prepare: async (args) => { state.session = args.session; return { session: args.session, routes: state.routes, done: true }; },
  routes: async () => ({ routes: state.routes, done: true }), episodes: async () => [],
  pick: state.pick, open: state.open, closeSession: async () => {},
}));
const { createCinema } = await import('./cinema.js');
afterEach(() => { state.listeners.clear(); state.open.mockClear(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const trr = (i, quality, file, meta) => ({
  id: `t${i}`, code: `TRR${i}`, server: 'Torrentio', sourceId: 'addon|torrentio', sourceName: 'Torrentio',
  label: `${file}\n${meta}`, quality, state: 'READY', runtimeReady: true, probed: null,
});
export const FIGHT_CLUB = [
  trr(0, 2160, 'Fight.Club.1999.2160p.UHD.BluRay.REMUX.HEVC.DV.HDR10Plus.TrueHD.Atmos.7.1-FGT', '👤 412 💾 61.2 GB ⚙️ ThePirateBay\nMulti Audio / 🇸🇦 / 🇫🇷'),
  trr(1, 2160, 'Fight.Club.1999.2160p.WEB-DL.x265.HDR.DDP5.1-NOGRP', '👤 2 💾 14.8 GB ⚙️ 1337x'),
  trr(2, 2160, 'Fight.Club.1999.2160p.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1', '👤 86 💾 22.1 GB ⚙️ RARBG'),
  trr(3, 2160, 'Fight.Club.1999.2160p.HDCAM', '👤 0 💾 3.1 GB ⚙️ 1337x'),
  trr(4, 1080, 'Fight.Club.1999.1080p.BluRay.x264.AAC-YTS', '👤 1240 💾 2.1 GB ⚙️ YTS'),
  trr(5, 1080, 'Fight.Club.1999.1080p.WEB-DL.x264.Arabic.Subbed', '👤 7 💾 1.9 GB ⚙️ EgyBest\n🇸🇦'),
  trr(6, 1080, 'Fight.Club.1999.1080p.BluRay.x265', '👤 0 💾 1.4 GB ⚙️ TorrentGalaxy'),
];

it('torrent releases show what they state, strongest first; dead swarms and CAM fold away; no autoplay', async () => {
  vi.useFakeTimers();
  state.routes = FIGHT_CLUB;
  const { window, document } = parseHTML('<html><body><main id="cinema"></main><div id="sheet"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  vi.stubGlobal('Image', function () { return document.createElement('img'); });
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  let cleanup;
  const sheet = document.getElementById('sheet');
  const deps = { q: (id) => document.getElementById(id), el, toast: vi.fn(), showPage() {}, openSheet: (fn) => { cleanup = fn(sheet); }, closeSheet: vi.fn(), currentPage: () => 'cinema' };
  const cinema = createCinema(deps);
  await cinema.openWork({ id: 'tt0137523', type: 'movie', title: 'Fight Club', _sourceCopy: { sourceId: 'addon|torrentio', url: 'tt0137523', title: 'Fight Club' } }, { autoplay: true });
  await vi.advanceTimersByTimeAsync(1);
  if (process.env.VANTARA_PICKER_CAPTURE) (await import('node:fs')).writeFileSync(process.env.VANTARA_PICKER_CAPTURE, sheet.innerHTML);
  expect(state.open).not.toHaveBeenCalled();
  const groups = [...sheet.querySelectorAll('.an-srv-group')];
  const visible = (g) => [...g.querySelectorAll(':scope > .an-srv-grid .an-srv')];
  const folded = (g) => [...g.querySelectorAll('details .an-srv')];
  const uhd = groups.find((g) => g.textContent.includes('Atmos'));
  // الأقوى أولًا: 412 ثم 86 ثم 2؛ الـCAM الميت مطويّ
  expect(visible(uhd).map((b) => b.title)).toEqual([
    'Fight.Club.1999.2160p.UHD.BluRay.REMUX.HEVC.DV.HDR10Plus.TrueHD.Atmos.7.1-FGT',
    'Fight.Club.1999.2160p.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1',
    'Fight.Club.1999.2160p.WEB-DL.x265.HDR.DDP5.1-NOGRP',
  ]);
  expect(folded(uhd).map((b) => b.title)).toEqual(['Fight.Club.1999.2160p.HDCAM']);
  const best = visible(uhd)[0];
  expect(best.querySelector('.an-srv-tag').textContent).toBe('DV · HDR10+ · REMUX');
  expect(best.querySelector('.an-srv-release').textContent).toBe('61 GB · HEVC · Atmos');
  expect(best.querySelector('.an-srv-lang--ar').textContent).toBe('عربي');
  expect(best.querySelector('.an-srv-seeds').textContent).toBe('412');
  expect(best.querySelector('.an-srv-state').textContent).toBe('412مشارك · قوي');
  expect(best.className).toContain('an-srv--swarm-strong');
  expect(visible(uhd)[2].querySelector('.an-srv-state').textContent).toBe('2مشارك · ضعيف');
  // 1080: العربية متوسطة السرب لا تتقدم على 1240 قوي؛ الميت مطويّ
  const fhd = groups.find((g) => g.textContent.includes('YTS') || g.textContent.includes('2.1 GB'));
  expect(visible(fhd).map((b) => b.title)).toEqual(['Fight.Club.1999.1080p.BluRay.x264.AAC-YTS', 'Fight.Club.1999.1080p.WEB-DL.x264.Arabic.Subbed']);
  expect(folded(fhd).map((b) => b.title)).toEqual(['Fight.Club.1999.1080p.BluRay.x265']);
  expect(folded(fhd)[0].querySelector('.an-srv-state').textContent).toBe('لا مشاركين');
  // اختيار المستخدم يبقى: المطويّ والضعيف قابلان للضغط
  expect(folded(fhd)[0].disabled).toBe(false);
  await best.onclick();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.open).toHaveBeenCalledWith(expect.objectContaining({ candidate: 't0', section: 'cinema' }));
  cleanup?.();
});
