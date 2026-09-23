/**
 * ألوان خلفية «من يتابع؟» — من v35 كما هي، بلا WebGL.
 *
 * أربع طبقات من الأغمق إلى الأفتح، كل لون `[r, g, b]` بين 0 و1. الأغمق أولًا
 * بقصد: الخلفية لا تُصارع النص الأبيض فوقها.
 *
 * منفصلة عن `silk.js` لتُختبر بلا متصفح: الرياضيات هنا، والرسم هناك.
 */

export const DEFAULT_SILK = ['#02010A', '#04052E', '#3D2C8D', '#916BBF'];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function hexToRgb01(hex) {
  const s = String(hex || '').replace('#', '');
  const f = s.length === 3 ? s.split('').map((x) => x + x).join('') : s.padEnd(6, '0').slice(0, 6);
  const n = parseInt(f, 16);
  if (!Number.isFinite(n)) return [0.24, 0.17, 0.55];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgb01ToHex(c) {
  return '#' + c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  h = ((h % 1) + 1) % 1;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/** لون ثابت من الاسم: ثلاثة حسابات بلا صور لا تتطابق خلفياتها. */
export function nameAccent(name) {
  let h = 0;
  for (const c of String(name || 'V')) h = (h * 31 + c.codePointAt(0)) % 360;
  return rgb01ToHex(hslToRgb((250 + (h % 70)) / 360, 0.58, 0.52));
}

export function paletteFromAccent(accent) {
  const [r, g, b] = hexToRgb01(accent);
  const [h, s] = rgbToHsl(r, g, b);
  const sat = clamp(s, 0.38, 0.78);
  return [
    hslToRgb(h, sat * 0.28, 0.018),
    hslToRgb(h - 0.035, sat * 0.48, 0.065),
    hslToRgb(h, sat * 0.88, 0.27),
    hslToRgb(h + 0.025, clamp(sat + 0.08, 0, 1), 0.57),
  ];
}

/**
 * لوحةٌ من بكسلات RGBA صغيرة (28×28 تكفي).
 *
 * أكثر لونين وزنًا بالتشبّع في منتصف الإضاءة. صورة رمادية تُعطي رماديًا لا
 * بنفسجيًا مُختلقًا، والبكسل الشفاف لا يُحسب.
 */
export function paletteFromPixels(data) {
  const B = 24;
  const w = new Float64Array(B);
  const ss = new Float64Array(B);
  let chroma = 0;
  let gray = 0;
  let mean = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const [h, s, l] = rgbToHsl(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    count++;
    mean += l;
    if (l < 0.035 || l > 0.965) continue;
    if (s < 0.1) {
      gray++;
      continue;
    }
    const mid = 1 - Math.abs(l - 0.5) * 2;
    const weight = s * (0.22 + 0.78 * mid);
    const k = Math.min(B - 1, Math.floor(h * B));
    w[k] += weight;
    ss[k] += s * weight;
    chroma += weight;
  }
  if (!count || chroma < 0.5 || gray > count * 0.92) {
    const l = clamp(mean / Math.max(count, 1), 0.18, 0.75);
    return [
      [0.01, 0.01, 0.012],
      [0.035, 0.035, 0.04],
      [l * 0.38, l * 0.38, l * 0.4],
      [l * 0.72, l * 0.72, l * 0.75],
    ];
  }
  let best = 0;
  for (let i = 1; i < B; i++) if (w[i] > w[best]) best = i;
  let second = -1;
  for (let i = 0; i < B; i++) {
    const ring = Math.min(Math.abs(i - best), B - Math.abs(i - best));
    if (ring < 2) continue;
    if (second < 0 || w[i] > w[second]) second = i;
  }
  const hue = (k) => (k + 0.5) / B;
  const sat = (k) => (w[k] ? ss[k] / w[k] : 0.5);
  const h1 = hue(best);
  const s1 = clamp(sat(best), 0.38, 0.82);
  const h2 = second >= 0 && w[second] > w[best] * 0.16 ? hue(second) : h1 - 0.045;
  const s2 = second >= 0 ? clamp(sat(second), 0.28, 0.72) : s1 * 0.68;
  return [
    hslToRgb(h1, s1 * 0.26, 0.018),
    hslToRgb(h2, s2 * 0.48, 0.065),
    hslToRgb(h1, s1 * 0.92, 0.28),
    hslToRgb(h1 + 0.018, clamp(s1 + 0.08, 0, 1), 0.58),
  ];
}

/** اللوحة الفورية قبل تحليل الصورة: محفوظة، ثم لون الحساب، ثم الاسم. */
export function silkPaletteFor(account) {
  if (Array.isArray(account?.silkColors) && account.silkColors.length >= 4) {
    return account.silkColors.slice(0, 4).map(hexToRgb01);
  }
  if (account?.accent) return paletteFromAccent(account.accent);
  return paletteFromAccent(nameAccent(account?.displayName));
}

/** لون الشعار: من أفتح طبقة، بإضاءة مضمونة تُقرأ فوق الحرير. */
export function logoColorFromPalette(p) {
  const source = p?.[3] || p?.[2] || [0.65, 0.42, 0.95];
  const [h, s] = rgbToHsl(source[0], source[1], source[2]);
  return rgb01ToHex(hslToRgb(h, clamp(Math.max(s, 0.58), 0.58, 0.86), 0.66));
}
