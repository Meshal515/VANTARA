import { describe, expect, it } from 'vitest';
import { preselected, selectedBytes } from './storage-view.js';

const kinds = [
  { id: 'torrentStreams', cache: true, deletable: true, bytes: 18 * 1024 ** 3, busy: false },
  { id: 'playerCache', cache: true, deletable: true, bytes: 300 * 1024 ** 2, busy: true },
  { id: 'mangaPages', cache: true, deletable: true, bytes: 0, busy: false },
  { id: 'translationModels', cache: false, deletable: true, bytes: 900 * 1024 ** 2, busy: false },
  { id: 'videoDownloads', cache: false, deletable: false, bytes: 5 * 1024 ** 3, busy: false },
];

describe('storage management selection', () => {
  it('preselects only non-empty caches that are not in use; never models or downloads', () => {
    expect([...preselected(kinds)]).toEqual(['torrentStreams']);
  });
  it('counts only what will really be deleted', () => {
    expect(selectedBytes(kinds, new Set(['torrentStreams', 'videoDownloads']))).toBe(18 * 1024 ** 3);
  });
});
