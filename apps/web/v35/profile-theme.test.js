import { describe, expect, it } from 'vitest';
import { normalizeProfileTheme, profileThemeStyle, profileThemePatch, matchedProfileTheme, reverseProfileGradient } from './profile-theme.js';

describe('profile themes', () => {
  it('reverses the two gradient colors without changing cards or angle', () => {
    const theme = { backgroundColor: '#223344', backgroundGradient: '#556677', backgroundAngle: 90, cardColor: '#112233' };
    const reversed = reverseProfileGradient(theme);
    expect(reversed).toEqual({ ...theme, backgroundColor: '#556677', backgroundGradient: '#223344' });
    expect(reverseProfileGradient(reversed)).toEqual(theme);
    expect(reverseProfileGradient({ backgroundColor: '#223344' }).backgroundGradient).toBeNull();
  });
  it('keeps all profile and card text above 4.5 contrast, including midgray colors', () => {
    const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const light = (rgb) => rgb.map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
      .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    for (const [first, second] of [['#767676', '#767676'], ['#ffffff', '#000000'], ['#b07070', '#7060a0'], ['#ffffff', '#eeeeee']]) {
      const style = profileThemeStyle({ backgroundColor: first, backgroundGradient: second, cardColor: first });
      const shade = style['--pf-background'].includes('rgba') ? 0.42 : 1;
      for (let i = 0; i <= 20; i++) {
        const background = channels(first).map((v, c) => (v + (channels(second)[c] - v) * i / 20) * shade);
        for (const key of ['--text-1', '--text-2', '--text-3', '--text-4']) {
          expect(contrast(light(channels(style[key])), light(background))).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const key of ['--pf-card-text', '--pf-card-muted']) {
        expect(contrast(light(channels(style[key])), light(channels(first)))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('uses only complete hex colors and bounded integer angles', () => {
    expect(normalizeProfileTheme({ backgroundColor: '#ABCDEF', cardColor: 'url(x)', backgroundAngle: 361 }))
      .toEqual({ backgroundColor: '#abcdef', backgroundGradient: null, backgroundAngle: null, cardColor: null });
  });
  it('keeps defaults untouched and resets only changed fields', () => {
    expect(profileThemeStyle({})).toEqual({});
    expect(profileThemePatch({ cardColor: '#112233' }, {})).toEqual({ cardColor: null });
    expect(profileThemePatch({}, { backgroundColor: '#abcdef', cardColor: '#223344' }))
      .toEqual({ backgroundColor: '#abcdef', cardColor: '#223344' });
  });
  it('builds a gradient and gives bright cards their own dark text', () => {
    const style = profileThemeStyle({ backgroundColor: '#201234', backgroundGradient: '#0c1830', backgroundAngle: 90, cardColor: '#ffffff' });
    expect(style['--pf-background']).toBe('linear-gradient(90deg, #201234, #0c1830)');
    expect(style['--text-1']).toBe('#ffffff');
    expect(style['--pf-card-text']).toBe('#000000');
    expect(style['--pf-card']).toBe('#ffffff');
  });
  it('keeps text legible across gradients with both bright and dark ends', () => {
    const style = profileThemeStyle({ backgroundColor: '#ffffff', backgroundGradient: '#000000' });
    expect(style['--pf-background']).toContain('rgba(0, 0, 0, 0.58)');
    expect(style['--text-1']).toBe('#ffffff');
  });
  it('matches one image without a gradient, and uses the avatar as the second color when matching both', () => {
    const banner = [[0, 0, 0], [0, 0, 0], [0.6, 0.2, 0.1], [1, 0.5, 0.2]];
    const avatar = [[0, 0, 0], [0, 0, 0], [0.1, 0.2, 0.6], [0.2, 0.5, 1]];
    expect(matchedProfileTheme('banner', banner, avatar)).toMatchObject({ backgroundColor: '#99331a', backgroundGradient: null, backgroundAngle: null });
    expect(matchedProfileTheme('avatar', banner, avatar)).toMatchObject({ backgroundColor: '#1a3399', backgroundGradient: null });
    expect(matchedProfileTheme('both', banner, avatar)).toMatchObject({ backgroundColor: '#99331a', backgroundGradient: '#1a3399', backgroundAngle: 135 });
    expect(matchedProfileTheme('both', null, avatar)).toBeNull();
  });
});
