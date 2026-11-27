/**
 * يولّد أيقونات التطبيق وشاشة البداية من مصدر شعار VANTARA المتجه.
 *
 *   node tools/build-icons.mjs
 *
 * المصدر (قرار المالك، 27 نوفمبر 2026): الشعار F أبيض مع طيّة الظل،
 * `docs/brand/logo/vantara-F-white/vantara-F-white-mark.svg`. ونسخة Debug
 * معكوسة: الشعار رمادي بظل أسود على أبيض (`vantara-F-gray`) حتى تتميز عن الرسمية
 * على الشاشة الرئيسية. خلفية طبقة Android التكيّفية لـDebug بيضاء أيضًا
 * (`android/app/src/debug/res/values/ic_launcher_background.xml`). والقناع الأبيض `logo-mark.png` من `vantara-F-mono.svg`.
 *
 * الرسم على canvas داخل Chromium نفسه، والنتائج تُقرأ من DOM الصفحة
 * (`--dump-dom`) — بلا أي تبعية. الشعار يُرسم من SVG مباشرة، لا يُلوَّن بلون
 * واحد، فتبقى طيّة الظل والتدرج.
 *
 * الهوامش (نسبة الشعار من الضلع الأقصر، على حدوده الفعلية لا إطار الملف):
 *   - ic_launcher_foreground: أندرويد يقصّ طبقة 108dp إلى شكل المشغّل (دائرة،
 *     مربع مدوّر…) وما يظهر مضمونًا دائرة 66dp في وسطها؛ فالشعار داخلها.
 *   - maskable وic_launcher_round: قصّ دائري، فهامش أكبر.
 *   - المقاسات الصغيرة (favicon و16/24 في ICO): هامش أقل حتى يبقى مقروءًا.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BRAND = join(ROOT, 'docs/brand/logo');
const SOURCES = {
  main: join(BRAND, 'vantara-F-white/vantara-F-white-mark.svg'),
  debug: join(BRAND, 'vantara-F-gray/vantara-F-gray-mark.svg'),
  mono: join(BRAND, 'vantara-F-mono.svg'),
};
const WEB_ICONS = join(ROOT, 'apps/web/icons');
const RES = join(ROOT, 'android/app/src/main/res');
const DEBUG_RES = join(ROOT, 'android/app/src/debug/res');
const DESKTOP = join(ROOT, 'apps/desktop/assets');

/** خلفية كل مصدر: Stable أبيض على أسود، وDebug معكوس (رمادي على أبيض). */
const BG = { main: '#000000', debug: '#FFFFFF', mono: '#000000' };
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  process.env.VANTARA_CHROMIUM,
  '/opt/pw-browsers/chromium',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);

const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];
const launcher = (res, source) =>
  DENSITIES.flatMap(([d, k]) => [
    [join(res, `mipmap-${d}/ic_launcher.png`), 48 * k, 48 * k, 0.72, source],
    [join(res, `mipmap-${d}/ic_launcher_round.png`), 48 * k, 48 * k, 0.6, source],
    [join(res, `mipmap-${d}/ic_launcher_foreground.png`), 108 * k, 108 * k, 0.44, source, true],
  ]);
const icoScale = (size) => (size <= 24 ? 0.84 : 0.74);

/**
 * [مسار الخرج، العرض، الارتفاع، نسبة الشعار، المصدر، خلفية شفافة؟]
 * مسار يبدأ بـ`ico:` إطارٌ داخل ملف ICO لا ملف مستقل.
 */
const TARGETS = [
  // الويب: manifest وindex.html يستخدمان pwa-*، والباقي للإشعارات وسطح المكتب
  [join(WEB_ICONS, 'pwa-icon-192.png'), 192, 192, 0.74, 'main'],
  [join(WEB_ICONS, 'pwa-icon-512.png'), 512, 512, 0.74, 'main'],
  [join(WEB_ICONS, 'pwa-maskable-192.png'), 192, 192, 0.56, 'main'],
  [join(WEB_ICONS, 'pwa-maskable-512.png'), 512, 512, 0.56, 'main'],
  [join(WEB_ICONS, 'pwa-apple-touch-icon.png'), 180, 180, 0.68, 'main'],
  [join(WEB_ICONS, 'pwa-favicon-32.png'), 32, 32, 0.9, 'main'],
  [join(WEB_ICONS, 'icon-192.png'), 192, 192, 0.74, 'main'],
  [join(WEB_ICONS, 'icon-512.png'), 512, 512, 0.74, 'main'],
  [join(WEB_ICONS, 'maskable-192.png'), 192, 192, 0.56, 'main'],
  [join(WEB_ICONS, 'maskable-512.png'), 512, 512, 0.56, 'main'],
  [join(WEB_ICONS, 'apple-touch-icon.png'), 180, 180, 0.68, 'main'],
  [join(WEB_ICONS, 'favicon-32.png'), 32, 32, 0.9, 'main'],
  // قناع CSS (بوابة الدخول والاحتفال والشاشة العريضة): أبيض على شفاف
  [join(WEB_ICONS, 'logo-mark.png'), 512, 512, 0.9, 'mono', true],
  ...launcher(RES, 'main'),
  ...launcher(DEBUG_RES, 'debug'),
  // شاشة البداية: أسود والشعار صغير في الوسط، لا وميض أبيض عند الفتح
  [join(RES, 'drawable/splash.png'), 480, 320, 0.36, 'main'],
  ...[
    ['mdpi', 320, 480],
    ['hdpi', 480, 800],
    ['xhdpi', 720, 1280],
    ['xxhdpi', 960, 1600],
    ['xxxhdpi', 1280, 1920],
  ].flatMap(([d, w, h]) => [
    [join(RES, `drawable-port-${d}/splash.png`), w, h, 0.36, 'main'],
    [join(RES, `drawable-land-${d}/splash.png`), h, w, 0.36, 'main'],
  ]),
  // ويندوز: الأيقونة الرسمية وأيقونة Debug (PNG لغير ويندوز)
  [join(DESKTOP, 'vantara-debug.png'), 512, 512, 0.74, 'debug'],
  ...ICO_SIZES.map((s) => [`ico:main:${s}`, s, s, icoScale(s), 'main']),
  ...ICO_SIZES.map((s) => [`ico:debug:${s}`, s, s, icoScale(s), 'debug']),
];
const ICONS = { main: join(DESKTOP, 'vantara.ico'), debug: join(DESKTOP, 'vantara-debug.ico') };

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

/** ICO بإطارات PNG (Vista فما بعد)، بالترتيب المعطى. */
function ico(frames) {
  const head = Buffer.alloc(6 + frames.length * 16);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(frames.length, 4);
  let offset = head.length;
  frames.forEach(({ size, png }, i) => {
    const at = 6 + i * 16;
    head.writeUInt8(size >= 256 ? 0 : size, at);
    head.writeUInt8(size >= 256 ? 0 : size, at + 1);
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(png.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...frames.map((f) => f.png)]);
}

async function main() {
  const svgs = Object.fromEntries(
    await Promise.all(Object.entries(SOURCES).map(async ([k, p]) => [k, (await readFile(p)).toString('base64')])),
  );
  const jobs = TARGETS.map(([, w, h, scale, source, transparent]) => ({ w, h, scale, source, transparent: Boolean(transparent) }));
  const work = await mkdtemp(join(tmpdir(), 'vantara-icons-'));
  const html = join(work, 'icons.html');
  // صور data: لا ملفات: canvas يبقى نظيفًا فيُقرأ بـtoDataURL
  await writeFile(
    html,
    `<!doctype html><html><body><pre id="out"></pre><script>
      const jobs = ${JSON.stringify(jobs)};
      const svgs = ${JSON.stringify(svgs)};
      const bgs = ${JSON.stringify(BG)};
      const RASTER = 4096; // الشعار يُرسم مرة بدقة عالية ثم يُصغَّر لكل مقاس
      const load = (b64) => new Promise((ok, fail) => {
        const img = new Image();
        img.onload = () => ok(img); img.onerror = fail;
        img.src = 'data:image/svg+xml;base64,' + b64;
      });
      (async () => {
        const marks = {};
        for (const [key, b64] of Object.entries(svgs)) {
          const img = await load(b64);
          const big = document.createElement('canvas');
          big.width = big.height = RASTER;
          const bg = big.getContext('2d');
          bg.drawImage(img, 0, 0, RASTER, RASTER);
          // حدود الشعار الفعلية: الهامش يُحسب من الرسم لا من إطار الملف
          const px = bg.getImageData(0, 0, RASTER, RASTER).data;
          let x0 = RASTER, y0 = RASTER, x1 = 0, y1 = 0;
          for (let y = 0; y < RASTER; y++) for (let x = 0; x < RASTER; x++) {
            if (px[(y * RASTER + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
          }
          marks[key] = { canvas: big, x0, y0, bw: x1 - x0 + 1, bh: y1 - y0 + 1 };
        }
        const out = jobs.map(({ w, h, scale, source, transparent }) => {
          const { canvas, x0, y0, bw, bh } = marks[source];
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const g = c.getContext('2d');
          if (!transparent) { g.fillStyle = bgs[source]; g.fillRect(0, 0, w, h); }
          const box = Math.min(w, h) * scale;
          const k = Math.min(box / bw, box / bh);
          const dw = bw * k, dh = bh * k;
          g.imageSmoothingQuality = 'high';
          // تصغير على مراحل: قفزة واحدة من 4096 إلى 16 تُفقد التفاصيل وتُخشّن الحواف
          let src = canvas, sx = x0, sy = y0, sw = bw, sh = bh;
          while (sw / 2 > dw) {
            const half = document.createElement('canvas');
            half.width = Math.ceil(sw / 2); half.height = Math.ceil(sh / 2);
            const hg = half.getContext('2d'); hg.imageSmoothingQuality = 'high';
            hg.drawImage(src, sx, sy, sw, sh, 0, 0, half.width, half.height);
            src = half; sx = 0; sy = 0; sw = half.width; sh = half.height;
          }
          g.drawImage(src, sx, sy, sw, sh, (w - dw) / 2, (h - dh) / 2, dw, dh);
          return c.toDataURL('image/png');
        });
        document.getElementById('out').textContent = JSON.stringify(out);
      })();
    </script></body></html>`,
  );

  try {
    const dom = execFileSync(
      chromium(),
      ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=60000', '--dump-dom', `file://${html}`],
      { maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString();
    const json = dom.match(/<pre id="out">([^<]*)<\/pre>/)?.[1];
    if (!json) throw new Error('Chromium rendered nothing');
    const images = JSON.parse(json.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    const frames = { main: [], debug: [] };
    for (let i = 0; i < TARGETS.length; i++) {
      const [out, w, h] = TARGETS[i];
      const png = Buffer.from(images[i].split(',')[1], 'base64');
      if (out.startsWith('ico:')) {
        const [, kind] = out.split(':');
        frames[kind].push({ size: w, png });
        continue;
      }
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, png);
      console.log(`${out.replace(`${ROOT}/`, '')}  ${w}×${h}`);
    }
    for (const [kind, path] of Object.entries(ICONS)) {
      await writeFile(path, ico(frames[kind]));
      console.log(`${path.replace(`${ROOT}/`, '')}  ${ICO_SIZES.join('/')}`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

await main();
