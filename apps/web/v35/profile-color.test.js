import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex, contrastRatio, readableColor, copyPalette } from './profile-color.js';

describe('profile color controls', () => {
  it('round trips primary, grayscale and custom colors without shifting them', () => {
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#767676', '#7d1f12', '#f5e5d1']) {
      expect(hsvToHex(...hexToHsv(hex))).toBe(hex);
    }
  });
  it('wraps hue and bounds pointer saturation/value', () => {
    expect(hsvToHex(360, 1, 1)).toBe('#ff0000');
    expect(hsvToHex(-120, 1, 1)).toBe('#0000ff');
    expect(hsvToHex(30, 2, -1)).toBe('#000000');
  });
  it('keeps semantic colors readable on light and dark backgrounds', () => {
    for (const bg of ['#ffffff', '#08070c', '#767676', '#5fd49a', '#bba2ff']) {
      for (const desired of ['#5fd49a', '#bba2ff', '#f2b75b']) {
        expect(contrastRatio(readableColor(desired, [bg]), bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('protects only a mixed copy region when neither foreground fits', () => {
    const result = copyPalette(['#ffffff', '#000000']);
    expect(result.guard).toBeTruthy();
    expect(result.text).toBe('#ffffff');
    expect(copyPalette(['#ffffff', '#eeeeee']).guard).toBe('');
    expect(copyPalette(['#08070c']).guard).toBe('');
  });
});
