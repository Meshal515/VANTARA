// حركة عدسة الألسنة (الخطة 13): بعد الضغط على لسان آخر، هل تنزلق العدسة بإطارات وسطية أم تقفز؟ node tools/ui-qa/glass-tabmove.mjs [phone|w1366]
// تنبيه مقاس: الإحصاءات والعرض الموحد يجريان بـ10 إطارات/ث في بيئة الاختبار حتى بلا Glass، فتظهر فيهما إطارات وسطية قليلة.
import { launch, sleep } from './rig.mjs';
const size = process.argv[2] || 'phone'; const VIEW = size === 'phone' ? [390, 844] : [1366, 768];
const sample = ([sel, item]) => new Promise((done) => {
  const box0 = document.querySelector(sel); const items = [...box0.querySelectorAll(`:scope > ${item}`)].filter((n) => n.offsetWidth);
  const act = items.findIndex((n) => n.matches('.active,.on,.is-on,[aria-selected="true"],[aria-checked="true"],[aria-pressed="true"]'));
  const target = items[act === 0 ? 1 : 0]; if (!target) return done('no target');
  const xs = []; const pos = () => { const b = document.querySelector(sel); const s = b?.querySelector(':scope > .g-seg'); if (!s) return null; const r = s.getBoundingClientRect(); return Math.round(r.left * 10) / 10; };
  xs.push(pos()); target.click(); let n = 0;
  const tick = () => { xs.push(pos()); if (++n < 50) requestAnimationFrame(tick); else done(xs); }; requestAnimationFrame(tick);
});
const cases = [
  ['social-tabs', { section: 'anime' }, (p) => p.evaluate(() => window.__shell.showPage('majlis')), '.social-tabs', '.social-tab'],
  ['library-tabs', { section: 'anime' }, (p) => p.evaluate(() => window.__shell.showPage('library')), '.library-tabs', '.library-tab'],
  ['mj-filters', { section: 'anime' }, async (p) => { await p.evaluate(() => window.__shell.showPage('majlis')); await sleep(500); await p.evaluate(() => document.querySelectorAll('.social-tab')[2].click()); }, '.mj-filters', '.library-tab'],
  ['sx-tabs (room)', { section: 'anime' }, async (p) => { await p.evaluate(() => window.__shell.showPage('majlis')); await sleep(500); await p.evaluate(() => window.__shell.openMajlis()); }, '.sx-tabs', '.sx-tab'],
  ['ins-tabs', { section: 'anime' }, (p) => p.evaluate(() => window.__shell.showPage('insights')), '.ins-tabs', 'button'],
  ['mw-tabs', { section: 'manga', appearance: { unifiedLook: true } }, (p) => p.evaluate(() => window.__open('manga')), '.mw-tabs', 'button'],
  ['mw-ranges', { section: 'manga', appearance: { style: { manga: 'profile' } } }, (p) => p.evaluate(() => window.__open('manga')), '.mw-ranges', 'button'],
  ['cn-kinds (discover)', { section: 'cinema' }, (p) => p.evaluate(() => window.__shell.showPage('discover')), '#discover .cn-kinds', '.cn-kind'],
  ['cn-kinds (home)', { section: 'cinema' }, null, '#home .cn-kinds', '.cn-kind'],
  ['uv-tabs', { section: 'anime', unified: true }, null, '.uv-tabs', 'button'],
  ['us-seg', { section: 'anime', unified: true }, (p) => p.evaluate(() => window.__shell.showPage('discover')), '.us-seg', 'button'],
  ['ul-shelves', { section: 'anime', unified: true }, (p) => p.evaluate(() => window.__shell.showPage('library')), '.ul-shelves', '.ul-shelf'],
];
if (size !== 'phone') cases.push(['drawer-sections', { section: 'anime' }, null, '.drawer-sections', '.drawer-section']);
for (const [name, opts, setup, sel, item] of cases) {
  const h = await launch({ viewport: { width: VIEW[0], height: VIEW[1] }, mobile: size === 'phone', net: 'fixture', ...opts, appearance: { material: 'glass', ...(opts.appearance ?? {}) } });
  try {
    await sleep(1600); if (setup) await setup(h.page); await sleep(1800);
    await h.page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), sel); await sleep(400);
    const xs = await h.page.evaluate(sample, [sel, item]);
    if (!Array.isArray(xs)) { console.log(name.padEnd(22), 'SKIP', xs); continue; }
    const v = xs.filter((x) => x != null); const a = v[0], b = v[v.length - 1];
    const mid = v.filter((x) => (x - a) * (x - b) < -0.5).length; const over = v.some((x) => (a < b ? x > b + 0.5 : x < b - 0.5));
    console.log(name.padEnd(22), a === b ? 'NO MOVE' : mid >= 8 ? 'SMOOTH' : 'JUMP', `from=${a} to=${b} intermediate=${mid} overshoot=${over} missing=${xs.length - v.length}`);
  } catch (e) { console.log(name, 'ERR', String(e).slice(0, 100)); } finally { await h.close(); }
}
