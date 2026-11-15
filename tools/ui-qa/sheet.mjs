// لوحة مقارنة: يجمع لقطات PNG في صورة واحدة مصغّرة. node tools/ui-qa/sheet.mjs <dir> <out.png> <regex> [cols] [cellWidth]
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.VANTARA_PLAYWRIGHT_MODULE || 'playwright');
const [dir, out, pattern = '.', cols = '6', cell = '260'] = process.argv.slice(2);
const files = (await readdir(dir)).filter((f) => f.endsWith('.png') && new RegExp(pattern).test(f)).sort();
const items = await Promise.all(files.map(async (f) => `<figure><img src="data:image/png;base64,${(await readFile(path.join(dir, f))).toString('base64')}"><figcaption>${f.replace('.png', '')}</figcaption></figure>`));
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: Number(cols) * (Number(cell) + 8) + 8, height: 600 } });
await page.setContent(`<style>body{margin:8px;background:#222;display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:8px;font:11px sans-serif;color:#eee}figure{margin:0}img{width:100%;display:block}figcaption{padding:2px 0;word-break:break-all}</style>${items.join('')}`);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out, files.length);
