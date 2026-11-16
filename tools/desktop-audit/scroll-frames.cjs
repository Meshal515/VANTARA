// لقطات صفحة عمل حقيقية عند مواضع تمرير متتالية (حركة العمق مع التمرير على الكمبيوتر): حواف حادة، خط ظل، قفز.
// node scroll-frames.cjs anime|cinema|manga style OUT.jpg [w=1366] [h=768]
const { openDesktop, chromium } = require('./desktop-harness.cjs');
const { execFileSync } = require('child_process'); const fs = require('fs');
const [section, style, out, w = '1366', h = '768'] = process.argv.slice(2);
const PICK = { anime: { want: /apothecary|frieren/i, card: '.an-card:not(.an-card--ranked)' }, cinema: { card: '.cn-poster', rail: /مسلسلات/ }, manga: { want: /solo leveling|one piece/i, card: '.page.active .work-card' } };
(async () => {
  const browser = await chromium.launch();
  const unified = style === 'unified';
  const { page } = await openDesktop({ browser, screen: { width: +w, height: +h }, storage: { 'vantara.session.v1': { token: 'x', user: { userId: 'u', name: 't' }, savedAt: Date.now() }, 'vantara.appearance.v1': { style: unified ? {} : { [section]: style }, accent: {}, pureBlack: false, unifiedLook: unified } } });
  await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4500);
  await page.evaluate((s) => [...document.querySelectorAll('.drawer button')].find((x) => x.textContent.trim().toUpperCase().startsWith(s.toUpperCase()))?.click(), section);
  await page.waitForTimeout(section === 'manga' ? 10000 : 6500);
  const p = PICK[section];
  await page.evaluate(([sel, want, railRe]) => { let c = [...document.querySelectorAll(sel)].filter((x) => x.checkVisibility?.() && x.querySelector('img')); if (railRe) { const r = c.filter((x) => new RegExp(railRe).test(x.closest('section')?.querySelector('h2,h3')?.textContent ?? '')); if (r.length) c = r; } ((want && c.find((x) => new RegExp(want, 'i').test(x.textContent))) ?? c[0])?.click(); }, [p.card, p.want?.source ?? null, p.rail?.source ?? null]);
  await page.waitForTimeout(8000);
  const frames = [];
  for (const y of [0, 150, 300, 450, 600]) {
    await page.mouse.move(500, 400);
    await page.evaluate((y) => document.scrollingElement.scrollTo(0, y), y); await page.waitForTimeout(450);
    const f = `${out}.${y}.png`; await page.screenshot({ path: f }); frames.push(f);
  }
  execFileSync('python3', ['-I', '-c', `import sys\nfrom PIL import Image\nfs=sys.argv[1:-1]; ims=[Image.open(f).convert('RGB') for f in fs]; ims=[i.resize((683, round(i.height*683/i.width))) for i in ims]\nc=Image.new('RGB',(683*3+16, ims[0].height*2+8),(255,255,255))\nfor k,i in enumerate(ims): c.paste(i,((k%3)*(683+8),(k//3)*(ims[0].height+8)))\nc.save(sys.argv[-1],quality=80)`, ...frames, out]);
  for (const f of frames) fs.unlinkSync(f);
  await browser.close();
})();
