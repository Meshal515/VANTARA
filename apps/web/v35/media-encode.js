/**
 * تجهيز صورة الملف قبل الرفع: أي صيغة يفتحها الجهاز، مقصوصة ومضغوطة.
 *
 * الثابتة (JPG، PNG، WebP، AVIF، BMP…) تُرسم مقصوصة على canvas وتُصدَّر
 * WebP بأعلى جودة تدخل الميزانية: تبدأ عالية وتنزل خطوة خطوة حتى تدخل،
 * فالصورة الصغيرة لا تُضغط بلا داعٍ.
 *
 * المتحركة (GIF، WebP متحرك، APNG) لا تمرّ على canvas واحد — هذا يجمّدها.
 * تُفكّ إطارًا إطارًا بـ`ImageDecoder`، ويُقصّ كل إطار بنفس القصّ، وتُجمع
 * GIF من جديد بمدد إطاراتها الأصلية. وإن كبرت عن سقف الخادم صغُرت أبعادها
 * ثم خُفّف عدد إطاراتها (مع جمع مددها، فلا تتسارع الحركة) حتى تدخل.
 */

import { GIFEncoder, applyPalette, quantize } from '../vendor/gifenc.js';

/** سقف الخادم للملف الواحد (`MAX_MEDIA_BYTES`)، بهامش صغير. */
export const MAX_UPLOAD = 1_450_000;

export const TARGETS = {
  avatar: { w: 512, h: 512, budget: 350_000 },
  banner: { w: 1500, h: 600, budget: 900_000 },
};
/** المتحركة أصغر: كل إطار صورة كاملة، والحجم يُضرب في عدد الإطارات. */
const ANIMATED = {
  avatar: { w: 360, h: 360 },
  banner: { w: 960, h: 384 },
};
const MAX_FRAMES = 180;

export class MediaError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * هل الصورة متحركة؟ من البايتات لا من الامتداد: WebP وPNG قد يكونان
 * ثابتين أو متحركين بنفس الاسم.
 * @returns {Promise<string|null>} نوع الملف المتحرك، أو `null` للثابت
 */
export async function sniffAnimated(file) {
  const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 6_000_000)).arrayBuffer());
  const at = (i, s) => [...s].every((c, k) => buf[i + k] === c.charCodeAt(0));
  if (at(0, 'GIF8')) {
    // كل إطار يسبقه امتداد تحكّم رسومي (21 F9 04)؛ أكثر من واحد = متحركة
    let frames = 0;
    for (let i = 13; i < buf.length - 2; i++) {
      if (buf[i] === 0x21 && buf[i + 1] === 0xf9 && buf[i + 2] === 0x04 && ++frames > 1) return 'image/gif';
    }
    return null;
  }
  if (at(0, 'RIFF') && at(8, 'WEBP')) {
    return at(12, 'VP8X') && buf[20] & 0x02 ? 'image/webp' : null;
  }
  if (buf[0] === 0x89 && at(1, 'PNG')) {
    let i = 8;
    while (i + 8 <= buf.length) {
      const len = ((buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>> 0;
      if (at(i + 4, 'acTL')) return 'image/png';
      if (at(i + 4, 'IDAT')) return null;
      i += 12 + len;
    }
  }
  return null;
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/** القصّ على canvas بالأبعاد النهائية. `rect` بإحداثيات الصورة الأصلية. */
export function drawCrop(source, rect, out) {
  const canvas = document.createElement('canvas');
  canvas.width = out.w;
  canvas.height = out.h;
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, out.w, out.h);
  return canvas;
}

/** أعلى جودة تدخل الميزانية. WebP، وJPEG حيث لا يُصدَّر WebP. */
export async function encodeStatic(canvas, budget) {
  let smallest = null;
  for (const quality of [0.92, 0.86, 0.8, 0.72, 0.64, 0.56]) {
    let blob = await toBlob(canvas, 'image/webp', quality);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality);
    if (!blob) break;
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= budget) return blob;
  }
  if (smallest && smallest.size <= MAX_UPLOAD) return smallest;
  throw new MediaError('too_large');
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function decodeFrames(file, type) {
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type });
  await decoder.tracks.ready;
  await decoder.completed;
  const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
  return { decoder, count: Math.min(count, MAX_FRAMES * 4) };
}

async function encodeGif({ decoder, count }, rect, out, step, onProgress, progressBase, progressSpan) {
  const gif = GIFEncoder();
  const canvas = document.createElement('canvas');
  canvas.width = out.w;
  canvas.height = out.h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  const indices = [];
  for (let i = 0; i < count && indices.length < MAX_FRAMES; i += step) indices.push(i);
  for (let n = 0; n < indices.length; n++) {
    let delay = 0;
    let frame = null;
    // مدة الإطارات المتروكة تُضاف للمعروض: نفس سرعة الأصل
    for (let k = indices[n]; k < Math.min(indices[n] + step, count); k++) {
      const { image } = await decoder.decode({ frameIndex: k });
      delay += (image.duration ?? 100_000) / 1000;
      if (k === indices[n]) frame = image;
      else image.close();
    }
    // خلفية التطبيق تحت الشفاف: GIF بلا شفافية جزئية، والحواف لا تُسنّن
    g.fillStyle = '#121019';
    g.fillRect(0, 0, out.w, out.h);
    g.drawImage(frame, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, out.w, out.h);
    frame.close();
    const { data } = g.getImageData(0, 0, out.w, out.h);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), out.w, out.h, { palette, delay: Math.max(20, Math.round(delay)) });
    onProgress?.(progressBase + progressSpan * ((n + 1) / indices.length));
    await tick();
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

/**
 * متحركة مقصوصة. تحاول بالأبعاد الكاملة وكل الإطارات، ثم تتنازل خطوة خطوة.
 * بلا `ImageDecoder` (متصفح قديم) تُرفع كما هي إن دخلت السقف.
 */
export async function encodeAnimated(file, type, rect, kind, onProgress) {
  if (typeof ImageDecoder === 'undefined' || !(await ImageDecoder.isTypeSupported(type).catch(() => false))) {
    if (file.size <= MAX_UPLOAD) return file;
    throw new MediaError('too_large');
  }
  const decoded = await decodeFrames(file, type);
  try {
    const base = ANIMATED[kind];
    const aspect = base.w / base.h;
    // لا نكبّر ما هو أصغر من الهدف
    const w0 = Math.min(base.w, Math.round(rect.sw));
    const attempts = [
      [1, 1],
      [0.8, 1],
      [0.8, 2],
      [0.64, 2],
      [0.5, 3],
    ];
    const autoStep = Math.max(1, Math.ceil(decoded.count / MAX_FRAMES));
    for (let a = 0; a < attempts.length; a++) {
      const [scale, extra] = attempts[a];
      const w = Math.max(64, Math.round(w0 * scale));
      const out = { w, h: Math.round(w / aspect) };
      const blob = await encodeGif(decoded, rect, out, autoStep * extra, onProgress, a / attempts.length, 1 / attempts.length);
      if (blob.size <= MAX_UPLOAD) {
        onProgress?.(1);
        return blob;
      }
    }
    throw new MediaError('too_large');
  } finally {
    decoded.decoder.close();
  }
}
