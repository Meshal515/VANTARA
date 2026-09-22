import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SILK,
  hexToRgb01,
  logoColorFromPalette,
  nameAccent,
  paletteFromAccent,
  paletteFromPixels,
  rgb01ToHex,
  silkPaletteFor,
} from './silk-palette.js';

/** بكسلات RGBA بلون واحد. */
function solid(r, g, b, count = 28 * 28) {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) data.set([r, g, b, 255], i * 4);
  return data;
}

function hue([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}

describe('silk palette', () => {
  it('hex round trips through rgb01', () => {
    expect(rgb01ToHex(hexToRgb01('#3d2c8d'))).toBe('#3d2c8d');
  });

  it('a red avatar gives a red silk, dark at the base and brighter on top', () => {
    const p = paletteFromPixels(solid(220, 30, 20));
    expect(p).toHaveLength(4);
    // الطبقة الأغمق أولًا: النص الأبيض لا يضيع فوق خلفية فاتحة
    const light = (c) => (Math.max(...c) + Math.min(...c)) / 2;
    expect(light(p[0])).toBeLessThan(light(p[3]));
    const h = hue(p[3]);
    expect(h < 20 || h > 340).toBe(true);
  });

  it('a grey avatar gives a grey silk, not an invented purple', () => {
    const p = paletteFromPixels(solid(128, 128, 128));
    for (const c of p) expect(Math.max(...c) - Math.min(...c)).toBeLessThan(0.05);
  });

  it('transparent pixels are ignored', () => {
    const data = new Uint8ClampedArray(28 * 28 * 4); // كلها شفافة
    expect(() => paletteFromPixels(data)).not.toThrow();
    expect(paletteFromPixels(data)).toHaveLength(4);
  });

  it('name accents are stable and differ between names', () => {
    expect(nameAccent('NGM')).toBe(nameAccent('NGM'));
    expect(nameAccent('NGM')).not.toBe(nameAccent('MÀN'));
  });

  it('an account without an avatar still gets its own silk', () => {
    // ثلاثة حسابات بلا صور تعني ثلاث خلفيات متطابقة لولا هذا
    const a = silkPaletteFor({ displayName: 'NGM' });
    const b = silkPaletteFor({ displayName: 'D7MM' });
    expect(rgb01ToHex(a[3])).not.toBe(rgb01ToHex(b[3]));
  });

  it('a stored accent wins over the name', () => {
    const fromAccent = paletteFromAccent('#427ab8');
    expect(silkPaletteFor({ displayName: 'x', accent: '#427ab8' })).toEqual(fromAccent);
  });

  it('the logo stays bright enough to read on the silk', () => {
    const color = hexToRgb01(logoColorFromPalette(paletteFromPixels(solid(20, 20, 90))));
    const light = (Math.max(...color) + Math.min(...color)) / 2;
    expect(light).toBeGreaterThan(0.55);
  });

  it('the default silk is the VANTARA purple', () => {
    expect(DEFAULT_SILK).toEqual(['#02010A', '#04052E', '#3D2C8D', '#916BBF']);
  });
});
