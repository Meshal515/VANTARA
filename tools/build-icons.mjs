/**
 * يولّد أيقونات التطبيق من `apps/web/icons/vantara-mark.svg`.
 *
 *   node tools/build-icons.mjs
 *
 * الرسم بعلم `--screenshot` في Chromium نفسه: بلا أي تبعية. إضافة محوّل SVG
 * إلى القفل مقابل صور تُولَّد مرة عند تغيير الشعار ليست مقايضة جيدة، والمتصفح
 * موجود أصلًا في بيئة البناء.
 *
 * maskable وic_launcher_round بهامش داخلي: أندرويد يقصّ الأيقونة إلى دائرة،
 * وبلا الهامش يُقطع طرف الحرف.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'apps/web/icons/vantara-mark.svg');
const WEB_ICONS = join(ROOT, 'apps/web/icons');
const ANDROID_RES = join(ROOT, 'android/app/src/main/res');

/** يُضبط بـCHROMIUM_PATH عند اختلاف المسار. */
const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);

/** [مسار الخرج، المقاس بالبكسل، الهامش كنسبة] */
const TARGETS = [
  [join(WEB_ICONS, 'icon-192.png'), 192, 0],
  [join(WEB_ICONS, 'icon-512.png'), 512, 0],
  [join(WEB_ICONS, 'maskable-192.png'), 192, 0.2],
  [join(WEB_ICONS, 'maskable-512.png'), 512, 0.2],
  [join(WEB_ICONS, 'apple-touch-icon.png'), 180, 0.08],
  [join(WEB_ICONS, 'favicon-32.png'), 32, 0],
  // مُشغّل أندرويد: Capacitor يقرأها من res/mipmap-*
  [join(ANDROID_RES, 'mipmap-mdpi/ic_launcher.png'), 48, 0],
  [join(ANDROID_RES, 'mipmap-hdpi/ic_launcher.png'), 72, 0],
  [join(ANDROID_RES, 'mipmap-xhdpi/ic_launcher.png'), 96, 0],
  [join(ANDROID_RES, 'mipmap-xxhdpi/ic_launcher.png'), 144, 0],
  [join(ANDROID_RES, 'mipmap-xxxhdpi/ic_launcher.png'), 192, 0],
  [join(ANDROID_RES, 'mipmap-mdpi/ic_launcher_round.png'), 48, 0.2],
  [join(ANDROID_RES, 'mipmap-hdpi/ic_launcher_round.png'), 72, 0.2],
  [join(ANDROID_RES, 'mipmap-xhdpi/ic_launcher_round.png'), 96, 0.2],
  [join(ANDROID_RES, 'mipmap-xxhdpi/ic_launcher_round.png'), 144, 0.2],
  [join(ANDROID_RES, 'mipmap-xxxhdpi/ic_launcher_round.png'), 192, 0.2],
  // الطبقة الأمامية للأيقونة التكيّفية: النظام يقصّ 33% منها
  [join(ANDROID_RES, 'mipmap-mdpi/ic_launcher_foreground.png'), 108, 0.28],
  [join(ANDROID_RES, 'mipmap-hdpi/ic_launcher_foreground.png'), 162, 0.28],
  [join(ANDROID_RES, 'mipmap-xhdpi/ic_launcher_foreground.png'), 216, 0.28],
  [join(ANDROID_RES, 'mipmap-xxhdpi/ic_launcher_foreground.png'), 324, 0.28],
  [join(ANDROID_RES, 'mipmap-xxxhdpi/ic_launcher_foreground.png'), 432, 0.28],
];

function chromium() {
  for (const path of CANDIDATES) {
    try {
      execFileSync(path, ['--version'], { stdio: 'ignore' });
      return path;
    } catch {
      // المرشّح التالي
    }
  }
  throw new Error(`No Chromium found. Set CHROMIUM_PATH. Tried: ${CANDIDATES.join(', ')}`);
}

async function main() {
  const svg = await readFile(SOURCE, 'utf8');
  const browser = chromium();
  const work = await mkdtemp(join(tmpdir(), 'vantara-icons-'));

  try {
    for (const [out, size, padding] of TARGETS) {
      const inset = Math.round(size * padding);
      const inner = size - inset * 2;
      const html = join(work, 'icon.html');
      await writeFile(
        html,
        `<!doctype html><html><body style="margin:0;background:#000">
           <div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:#000">
             <div style="width:${inner}px;height:${inner}px;line-height:0">${svg}</div>
           </div>
         </body></html>`,
      );

      // Chromium يكتب دائمًا باسم screenshot.png في مجلد العمل
      execFileSync(
        browser,
        [
          '--headless',
          '--no-sandbox',
          '--disable-gpu',
          '--hide-scrollbars',
          `--window-size=${size},${size}`,
          `--screenshot=${join(work, 'shot.png')}`,
          `file://${html}`,
        ],
        { stdio: 'ignore' },
      );

      await mkdir(dirname(out), { recursive: true });
      await rename(join(work, 'shot.png'), out);
      console.log(`${out.replace(`${ROOT}/`, '')}  ${size}px`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

await main();
