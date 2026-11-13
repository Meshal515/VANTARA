// كل طبقة عمق (depth.js) تتحرك مع التمرير: هل يقصّها سلف (overflow) بحافة حادة؟ القاعدة: النافذة تملك
// تلاشيها — قناع على السلف، أو ::after بتدرج عند حده — لا تدرج الطبقة المتحركة نفسها.
// يفشل إن قُصّت طبقة أكثر من 4px بلا قناع ولا تلاشٍ ثابت. الاستثناء نافذة بإطار مقصود (FRAMED).
// node tools/ui-qa/clip-check.mjs
import { launch, sleep } from './rig.mjs';
const { DEPTH_SPECS } = await import('../../apps/web/v35/depth.js');
const { MANGA_WORK_STYLES, WORK_STYLES, CINEMA_WORK_STYLES } = await import('../../apps/web/v35/appearance.js');
const SETS = { manga: [MANGA_WORK_STYLES, 'manga', 'detail'], anime: [WORK_STYLES, 'anime', 'anime'], cinema: [CINEMA_WORK_STYLES, 'series', 'cinema'] };
const FRAMED = new Set(['cinema/marquee']); // البنر في إطار 16:9 بحواف مقصودة
let bad = 0;
for (const sec of ['manga', 'anime', 'cinema']) {
  const [styles, kind, pid] = SETS[sec];
  // «النمط الموحد» (appearance.unifiedLook) حالة إضافية لكل قسم
  for (const { id: look } of [...styles, { id: 'unified' }]) {
    const spec = DEPTH_SPECS[sec]?.[look] ?? [];
    if (!spec.length) { console.log(`${sec}/${look}: لا طبقات`); continue; }
    const h = await launch({ section: sec, appearance: look === 'unified' ? { unifiedLook: true } : { style: { [sec]: look } } });
    await sleep(900); await h.page.evaluate((k) => window.__open(k), kind); await sleep(2000);
    const out = [];
    for (const y of [0, 150, 300]) {
      await h.page.evaluate((y) => scrollTo(0, y), y); await sleep(200);
      out.push(await h.page.evaluate(({ pid, sels }) => {
        const p = document.getElementById(pid);
        return sels.map((s) => {
          const n = p.querySelector(s); if (!n) return `${s}:غائب`;
          const r = n.getBoundingClientRect();
          let a = n.parentElement; while (a && a !== p && getComputedStyle(a).overflowY === 'visible' && getComputedStyle(a).overflowX === 'visible') a = a.parentElement;
          if (!a || a === p) return `${s}: بلا قص`;
          const ar = a.getBoundingClientRect();
          const cut = r.bottom - ar.bottom;
          const mask = getComputedStyle(a).maskImage || getComputedStyle(a).webkitMaskImage;
          const floor = /gradient/.test(getComputedStyle(a, '::after').backgroundImage) && getComputedStyle(a, '::after').display !== 'none';
          const soft = (mask && mask !== 'none') || floor;
          return `${s}: يقصه ${a.className.toString().split(' ')[0]} بمقدار ${cut.toFixed(0)}px${mask && mask !== 'none' ? ' (بقناع)' : floor ? ' (بتلاشٍ ثابت)' : cut > 4 ? ' !حاد' : ''}`;
        }).join(' | ');
      }, { pid, sels: spec.map((l) => l.sel.replace(/^\.mw-stage > /, '.mw-stage > ')) }));
    }
    const hard = !FRAMED.has(`${sec}/${look}`) && out.some((o) => o.includes('!حاد'));
    if (hard) bad++;
    console.log(`${hard ? 'FAIL' : 'ok  '} ${sec}/${look}:\n   ${out.map((o, i) => `[${[0, 150, 300][i]}] ${o}`).join('\n   ')}`);
    await h.close();
  }
}
process.exit(bad ? 1 : 0);
