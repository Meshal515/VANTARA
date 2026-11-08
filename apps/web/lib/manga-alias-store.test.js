import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _reset, canonicalRefOf, noteRefAlias, refsOf } from './manga-alias-store.js';

beforeEach(() => { vi.stubGlobal('localStorage', undefined); _reset(); });

describe('reading and library references survive canonical regrouping', () => {
  it('includes earlier aliases when a canonical work later joins another work', () => {
    noteRefAlias('ext:first title', 'ext:second title');
    noteRefAlias('ext:second title', 'ext:third title');
    expect(refsOf('ext:third title')).toEqual(['ext:third title', 'ext:second title', 'ext:first title']);
  });

  it('retains every old work reference across more than ten names', () => {
    const old = Array.from({ length: 15 }, (_, i) => `ext:old ${i}`);
    for (const ref of old) noteRefAlias(ref, 'ext:canonical');
    expect(refsOf('ext:canonical')).toEqual(['ext:canonical', ...old]);
  });

  it('terminates and deduplicates when evidence later reverses a canonical reference', () => {
    noteRefAlias('ext:a', 'ext:b');
    noteRefAlias('ext:b', 'ext:a');
    expect(refsOf('ext:a')).toEqual(['ext:a', 'ext:b']);
  });
});

describe('one work, one reference class (both directions)', () => {
  it('an old reference reads the canonical work too, not only the reverse', () => {
    noteRefAlias('ext:demon slayer kimetsu no yaiba', 'ext:kimetsu no yaiba');
    expect(refsOf('ext:demon slayer kimetsu no yaiba')).toEqual(['ext:demon slayer kimetsu no yaiba', 'ext:kimetsu no yaiba']);
    expect(refsOf('ext:kimetsu no yaiba')).toEqual(['ext:kimetsu no yaiba', 'ext:demon slayer kimetsu no yaiba']);
  });

  it('every member of a class has the same canonical reference, whatever order the evidence came in', () => {
    noteRefAlias('ext:b', 'ext:c');
    noteRefAlias('ext:a', 'ext:c');
    noteRefAlias('ext:a', 'ext:d');
    const reps = ['ext:a', 'ext:b', 'ext:c', 'ext:d'].map(canonicalRefOf);
    expect(new Set(reps).size).toBe(1);
    expect(canonicalRefOf('ext:unrelated')).toBe('ext:unrelated');
    expect(canonicalRefOf('anime:21')).toBe('anime:21');
  });

  it('a class learned later is seen at once (no stale cache)', () => {
    expect(canonicalRefOf('ext:x')).toBe('ext:x');
    noteRefAlias('ext:x', 'ext:y');
    expect(canonicalRefOf('ext:x')).toBe(canonicalRefOf('ext:y'));
  });
});
