import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _reset, noteRefAlias, refsOf } from './manga-alias-store.js';

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
