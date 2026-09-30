import { contrastRatio } from './profile-color.js';
import { describe, expect, it } from 'vitest';
import { normalizeProfileTheme, profileThemeStyle, profileThemePatch, matchedProfileTheme, reverseProfileGradient, sampleProfileBackground } from './profile-theme.js';

describe('profile themes', () => {
  it('reverses the two gradient colors without changing cards or angle', () => {
    const theme = { backgroundColor: '#223344', backgroundGradient: '#556677', backgroundAngle: 90, cardColor: '#112233' };
    const reversed = reverseProfileGradient(theme);
    expect(reversed).toEqual({ ...theme, backgroundColor: '#556677', backgroundGradient: '#223344' });
    expect(reverseProfileGradient(reversed)).toEqual(theme);
    expect(reverseProfileGradient({ backgroundColor: '#223344' }).backgroundGradient).toBeNull();
  });
  it('preserves selected endpoints and makes semantic colors readable on solids', () => {
    for (const color of ['#ffffff', '#08070c', '#767676', '#5fd49a']) {
      const style = profileThemeStyle({ backgroundColor: color, cardColor: color });
      for (const key of ['--text-1', '--text-2', '--text-3', '--text-4', '--success', '--accent-text', '--pf-card-text', '--pf-card-muted']) {
        expect(contrastRatio(style[key], color)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('samples a gradient at its local position and settles to the ending color below it', () => {
    const theme = { backgroundColor: '#ffffff', backgroundGradient: '#000000', backgroundAngle: 180 };
    expect(sampleProfileBackground(theme, 100, 0, 200, 840)).toBe('#ffffff');
    expect(sampleProfileBackground(theme, 100, 420, 200, 840)).toBe('#808080');
    expect(sampleProfileBackground(theme, 100, 1200, 200, 840)).toBe('#000000');
    expect(sampleProfileBackground(reverseProfileGradient(theme), 100, 0, 200, 840)).toBe('#000000');
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
    expect(style['--pf-background']).toBe('linear-gradient(135deg, #ffffff, #000000)');
    expect(style['--pf-background-end']).toBe('#000000');
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
