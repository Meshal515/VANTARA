/**
 * يولّد أيقونات التطبيق وشاشة البداية من شعار VANTARA (`apps/web/icons/logo-mark.png`).
 *
 *   node tools/build-icons.mjs
 *
 * الشعار أبيض على شفاف؛ يُلوَّن هنا بلون العلامة ويُوسَّط بهامشه في كل مقاس.
 * الرسم على canvas داخل Chromium نفسه، والنتائج تُقرأ من DOM الصفحة
 * (`--dump-dom`) — بلا أي تبعية.
 *
 * النسخة السابقة كانت تصوّر الصفحة، والـsvg بعرض ثابت 512 لا يتقلّص داخل
 * صندوقه: الحرف يخرج مزاحًا إلى الزاوية ومقصوصًا في كل مقاس أصغر. هنا المقاس
 * يُحسب لكل ملف، ولا لقطة شاشة.
 *
 * الهوامش:
 *   - ic_launcher_foreground: أندرويد يقصّ طبقة 108dp إلى شكل المشغّل (دائرة،
 *     مربع مدوّر…) وما يظهر مضمونًا دائرة 66dp في وسطها؛ فالشعار داخلها.
 *   - maskable وic_launcher_round: قصّ دائري، فهامش أكبر.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'apps/web/icons/logo-mark.png');
const WEB_ICONS = join(ROOT, 'apps/web/icons');
const RES = join(ROOT, 'android/app/src/main/res');

/** لون العلامة على أسود. */
const MARK = '#8f5cff';
const BG = '#000000';

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);

/**
 * [مسار الخرج، العرض، الارتفاع، نسبة الشعار من الضلع الأقصر، خلفية شفافة؟]
 */
const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];
const TARGETS = [
  [join(WEB_ICONS, 'icon-192.png'), 192, 192, 0.74],
  [join(WEB_ICONS, 'icon-512.png'), 512, 512, 0.74],
  [join(WEB_ICONS, 'maskable-192.png'), 192, 192, 0.56],
  [join(WEB_ICONS, 'maskable-512.png'), 512, 512, 0.56],
  [join(WEB_ICONS, 'apple-touch-icon.png'), 180, 180, 0.68],
  [join(WEB_ICONS, 'favicon-32.png'), 32, 32, 0.9],
  ...DENSITIES.flatMap(([d, k]) => [
    [join(RES, `mipmap-${d}/ic_launcher.png`), 48 * k, 48 * k, 0.72],
    [join(RES, `mipmap-${d}/ic_launcher_round.png`), 48 * k, 48 * k, 0.6],
    [join(RES, `mipmap-${d}/ic_launcher_foreground.png`), 108 * k, 108 * k, 0.44, true],
  ]),
  // شاشة البداية: أسود والشعار صغير في الوسط، لا وميض أبيض عند الفتح
  [join(RES, 'drawable/splash.png'), 480, 320, 0.36],
  ...[
    ['mdpi', 320, 480],
    ['hdpi', 480, 800],
    ['xhdpi', 720, 1280],
    ['xxhdpi', 960, 1600],
    ['xxxhdpi', 1280, 1920],
  ].flatMap(([d, w, h]) => [
    [join(RES, `drawable-port-${d}/splash.png`), w, h, 0.36],
    [join(RES, `drawable-land-${d}/splash.png`), h, w, 0.36],
  ]),
];

function chromium() {
  for (const path of CANDIDATES) {
    try {
      execFileSync(path, ['--version'], { stdio: 'ignore' });
      return path;
    } catch {
      // التالي
    }
  }
  throw new Error(`No Chromium found. Set CHROMIUM_PATH. Tried: ${CANDIDATES.join(', ')}`);
}

async function main() {
  const logo = (await readFile(SOURCE)).toString('base64');
  const jobs = TARGETS.map(([, w, h, scale, transparent]) => ({ w, h, scale, transparent: Boolean(transparent) }));
  const work = await mkdtemp(join(tmpdir(), 'vantara-icons-'));
  const html = join(work, 'icons.html');
  // صورة data: لا ملف: canvas يبقى نظيفًا فيُقرأ بـtoDataURL
  await writeFile(
    html,
    `<!doctype html><html><body><pre id="out"></pre><script>
      const jobs = ${JSON.stringify(jobs)};
      const img = new Image();
      img.onload = () => {
        // حدود الشعار الفعلية: الهامش يُحسب من الرسم لا من إطار الملف
        const probe = document.createElement('canvas');
        probe.width = img.width; probe.height = img.height;
        const pg = probe.getContext('2d');
        pg.drawImage(img, 0, 0);
        const px = pg.getImageData(0, 0, img.width, img.height).data;
        let x0 = img.width, y0 = img.height, x1 = 0, y1 = 0;
        for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
          if (px[(y * img.width + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        }
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        const tinted = document.createElement('canvas');
        tinted.width = bw; tinted.height = bh;
        const tg = tinted.getContext('2d');
        tg.drawImage(img, x0, y0, bw, bh, 0, 0, bw, bh);
        tg.globalCompositeOperation = 'source-in';
        tg.fillStyle = '${MARK}';
        tg.fillRect(0, 0, bw, bh);
        const out = jobs.map(({ w, h, scale, transparent }) => {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const g = c.getContext('2d');
          if (!transparent) { g.fillStyle = '${BG}'; g.fillRect(0, 0, w, h); }
          const box = Math.min(w, h) * scale;
          const k = Math.min(box / bw, box / bh);
          const dw = bw * k, dh = bh * k;
          g.imageSmoothingQuality = 'high';
          g.drawImage(tinted, (w - dw) / 2, (h - dh) / 2, dw, dh);
          return c.toDataURL('image/png');
        });
        document.getElementById('out').textContent = JSON.stringify(out);
      };
      img.src = 'data:image/png;base64,${logo}';
    </script></body></html>`,
  );

  try {
    const dom = execFileSync(
      chromium(),
      ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=15000', '--dump-dom', `file://${html}`],
      { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString();
    const json = dom.match(/<pre id="out">([^<]*)<\/pre>/)?.[1];
    if (!json) throw new Error('Chromium rendered nothing');
    const images = JSON.parse(json.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    for (let i = 0; i < TARGETS.length; i++) {
      const [out, w, h] = TARGETS[i];
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, Buffer.from(images[i].split(',')[1], 'base64'));
      console.log(`${out.replace(`${ROOT}/`, '')}  ${w}×${h}`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

await main();
