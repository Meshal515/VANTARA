import { describe, expect, it } from 'vitest';
import { canAcceptTranslationRepair } from './translation-repair-admission.js';

const region = (source, box, over = {}) => ({ source, box, arabic: 'نص عربي', status: 'pending', kind: 'speech', ...over });
const previous = () => ({ translated: 2, image: 'accepted.webp', regions: [
  region('MY KING KNOWS', [100, 100, 400, 180]),
  region('DO NOT GO', [100, 900, 400, 980]),
] });
const merged = (over = {}) => ({ translated: 1, image: 'repaired.webp', incomplete: false, regions: [
  region('My king knows. Do not go!', [80, 80, 440, 1000]),
], ...over });

describe('whole-holder repair admission', () => {
  it('accepts two old regions merged into one completely drawn holder', () => {
    expect(canAcceptTranslationRepair(previous(), merged())).toBe(true);
  });
  it('accepts punctuation and case changes without losing either old word sequence', () => {
    expect(canAcceptTranslationRepair(previous(), merged({ regions: [region('MY, KING KNOWS!\nDO NOT GO.', [80, 80, 440, 1000])] }))).toBe(true);
  });
  it('rejects a complete-looking holder whose OCR lost old dialogue', () => {
    expect(canAcceptTranslationRepair(previous(), merged({ regions: [region('MY KING KNOWS', [80, 80, 440, 1000])] }))).toBe(false);
  });
  it('requires word boundaries instead of substring matches', () => {
    const old = { translated: 2, regions: [region('HI', [100, 100, 200, 150]), region('KING', [100, 200, 200, 250])] };
    expect(canAcceptTranslationRepair(old, merged({ regions: [region('THIS KING', [80, 80, 440, 1000])] }))).toBe(false);
  });
  it('rejects one recovered occurrence as evidence for two identical old lines', () => {
    const old = { translated: 2, regions: [region('DO NOT GO', [100, 100, 300, 150]), region('DO NOT GO', [100, 900, 300, 950])] };
    expect(canAcceptTranslationRepair(old, merged({ regions: [region('DO NOT GO', [80, 80, 440, 1000])] }))).toBe(false);
  });
  it('accepts two recovered occurrences of repeated old dialogue', () => {
    const old = { translated: 2, regions: [region('DO NOT GO', [100, 100, 300, 150]), region('DO NOT GO', [100, 900, 300, 950])] };
    expect(canAcceptTranslationRepair(old, merged({ regions: [region('DO NOT GO. DO NOT GO!', [80, 80, 440, 1000])] }))).toBe(true);
  });
  it('does not reuse part of a longer recovered sentence for another old line', () => {
    const old = { translated: 2, regions: [region('DO NOT GO', [100, 100, 300, 150]), region('NOT GO', [100, 900, 300, 950])] };
    expect(canAcceptTranslationRepair(old, merged({ regions: [region('DO NOT GO', [80, 80, 440, 1000])] }))).toBe(false);
  });
  it('rejects reordered words as proof that an old sentence survived', () => {
    expect(canAcceptTranslationRepair(previous(), merged({ regions: [region('KING MY KNOWS DO NOT GO', [80, 80, 440, 1000])] }))).toBe(false);
  });
  it('rejects text recovered at the wrong location', () => {
    expect(canAcceptTranslationRepair(previous(), merged({ regions: [region('MY KING KNOWS DO NOT GO', [500, 80, 900, 1000])] }))).toBe(false);
  });
  it('rejects geometry that covers only the first old line', () => {
    expect(canAcceptTranslationRepair(previous(), merged({ regions: [region('MY KING KNOWS DO NOT GO', [80, 80, 440, 200])] }))).toBe(false);
  });
  it.each([true, undefined, null])('rejects non-explicit completeness %s', incomplete => {
    expect(canAcceptTranslationRepair(previous(), merged({ incomplete }))).toBe(false);
  });
  it.each([null, '', '   '])('rejects missing new output %s', image => {
    expect(canAcceptTranslationRepair(previous(), merged({ image }))).toBe(false);
  });
  it('rejects zero drawn regions even when a file exists', () => {
    expect(canAcceptTranslationRepair(previous(), merged({ translated: 0 }))).toBe(false);
  });
  it('rejects absent prior translated-region evidence', () => {
    expect(canAcceptTranslationRepair({ translated: 2, regions: [] }, merged())).toBe(false);
  });
  it('rejects incomplete prior evidence for the old drawn count', () => {
    expect(canAcceptTranslationRepair({ translated: 2, regions: [previous().regions[0]] }, merged())).toBe(false);
  });
  it.each([[100, 100, 100, 180], [100, 100, Infinity, 180], [100, 100, 400], null])('rejects malformed prior geometry %s', box => {
    const old = previous(); old.regions[0].box = box;
    expect(canAcceptTranslationRepair(old, merged())).toBe(false);
  });
  it('rejects a prior Arabic region with missing source evidence', () => {
    const old = previous(); old.regions[0].source = '';
    expect(canAcceptTranslationRepair(old, merged())).toBe(false);
  });
  it.each([{ source: '' }, { arabic: '' }, { status: 'skipped:residual' }, { kind: 'sfx' }, { box: [80, 80, NaN, 1000] }])('rejects malformed or undrawn new region %s', over => {
    expect(canAcceptTranslationRepair(previous(), merged({ regions: [region('MY KING KNOWS DO NOT GO', [80, 80, 440, 1000], over)] }))).toBe(false);
  });
  it('does not treat an untranslated prior region as previously drawn evidence', () => {
    const old = previous(); old.regions.push(region('IGNORED', [600, 1100, 650, 1200], { arabic: null, status: 'skipped:untranslated' }));
    expect(canAcceptTranslationRepair(old, merged())).toBe(true);
  });
});

describe('existing repair behavior', () => {
  it('preserves admission for equal counts even without coverage metadata', () => {
    expect(canAcceptTranslationRepair({ translated: 2 }, { translated: 2 })).toBe(true);
  });
  it('preserves admission for greater counts even with incomplete output', () => {
    expect(canAcceptTranslationRepair({ translated: 2 }, { translated: 3, incomplete: true })).toBe(true);
  });
  it('preserves the legacy default of zero previous translations', () => {
    expect(canAcceptTranslationRepair({}, { translated: 0 })).toBe(true);
  });
  it('rejects failed requests even when their count is higher', () => {
    expect(canAcceptTranslationRepair({ translated: 2 }, { translated: 3, error: 'device_failed' })).toBe(false);
  });
});
