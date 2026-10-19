import { describe, expect, it } from 'vitest';
import { momentExportFilename, selectMomentRecorderType, validateMomentRange, exportBrowserMoment } from './moment-export.js';

describe('browser moment export bounds and format', () => {
  it('accepts only finite, positive selected ranges of at most 70 seconds', () => {
    expect(validateMomentRange(5000, 75000)).toEqual({ start: 5, end: 75, duration: 70 });
    for (const range of [[-1, 1000], [0, 70001], [10, 10], [100, 0], [NaN, 1000], [0, Infinity], ['0', 1000]]) {
      expect(() => validateMomentRange(...range)).toThrow(/range/i);
    }
  });
  it('prefers MP4 and falls back to a supported WebM codec with its real extension', () => {
    expect(selectMomentRecorderType({ isTypeSupported: type => type.startsWith('video/mp4') })).toMatch(/^video\/mp4/);
    expect(selectMomentRecorderType({ isTypeSupported: type => type === 'video/webm;codecs=vp8,opus' })).toBe('video/webm;codecs=vp8,opus');
    expect(() => selectMomentRecorderType({ isTypeSupported: () => false })).toThrow(/record/i);
    expect(momentExportFilename('../Moment.mp4', 'video/webm;codecs=vp8,opus')).toBe('Moment.webm');
    expect(momentExportFilename('Moment.webm', 'video/mp4')).toBe('Moment.mp4');
  });
  it('rejects an already cancelled export before creating media or downloading anything', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(exportBrowserMoment({ source: 'https://fixture.test/movie.mp4', startMs: 0, endMs: 1000, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects unavailable browser capture instead of returning the whole source as a clip', async () => {
    await expect(exportBrowserMoment({ source: 'https://fixture.test/movie.mp4', startMs: 0, endMs: 1000 })).rejects.toThrow(/browser/i);
  });
});
