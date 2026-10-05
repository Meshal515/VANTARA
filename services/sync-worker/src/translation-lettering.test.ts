import { describe, expect, it } from 'vitest';
import { normalizeLettering, validateGodTranslation, safeGodTranslation } from './translation-lettering.ts';

describe('closed lettering with shaped whole-word emphasis', () => {
  it('falls back on invalid roles and retains at most three exact whole phrases', () => {
    expect(normalizeLettering({ role: '../../asset', ink: 'rainbow', intensity: 999 }, 'حان الوقت')).toEqual({ role: 'neutral', ink: 'auto', intensity: 'normal', emphasis: [] });
    expect(normalizeLettering({ role: 'threat', ink: 'blood', intensity: 'strong', emphasis: ['حان', 'وقت', 'الوقت', 'حان الوقت', 'حان'] }, 'حان الوقت')).toMatchObject({ role: 'threat', emphasis: ['حان', 'الوقت', 'حان الوقت'] });
    expect(normalizeLettering({ emphasis: ['حاكم'] }, 'الحاكم')).toMatchObject({ emphasis: [] });
  });
});
describe('God rule applies only to matching English words', () => {
  it.each(['God','god','GOD',"God’s", "God's",'gods','Gods'])('rejects prohibited tokens for %s', source => {
    for (const arabic of ['إله','الإله','رب','الرب','آلهة','الآلهة','يا إلهي','والإله','رَبّ']) expect(validateGodTranslation(source,arabic)).toBe(false);
  });
  it('rejects combined clitics, possessives and accusative forms even beside a valid ruler noun', () => {
    for (const token of ['للرب','وبالإله','إلها','ربك','لآلهتهم','والآلهة','آلهتنا']) {
      expect(validateGodTranslation('God',`حاكم ${token}`)).toBe(false);
      expect(validateGodTranslation('God',safeGodTranslation('God',`حاكم ${token}`))).toBe(true);
    }
  });
  it('requires ruler equivalents with singular/plural agreement', () => {
    expect(validateGodTranslation('God','حاكم')).toBe(true);
    expect(validateGodTranslation('Gods','ملوك')).toBe(true);
    expect(validateGodTranslation('God','ملوك')).toBe(false);
    expect(validateGodTranslation('Gods','حاكم')).toBe(false);
    expect(validateGodTranslation('God','هو قوي')).toBe(false);
  });
  it('does not rewrite unrelated words or prohibited substrings', () => {
    for (const source of ['Godfather','good','ungodly']) expect(validateGodTranslation(source,'ربيع وإلهام')).toBe(true);
    expect(validateGodTranslation('God','حاكم الربيع والإلهام')).toBe(true);
    expect(safeGodTranslation('God','ربيع الحاكم')).toBe('ربيع الحاكم');
    expect(safeGodTranslation('Gods','الآلهة عادوا')).toBe('الملوك عادوا');
    expect(safeGodTranslation('God','هو قوي')).toBe('حاكم');
  });
});
