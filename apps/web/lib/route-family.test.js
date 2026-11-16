import { describe, expect, it } from 'vitest';
import { isTorrentRoute } from './route-family.js';

describe('AW24: Debrid direct links from Stremio addons are not torrents', () => {
  it('direct HTTP from Comet/Jackettio (web type, or native non-btih fingerprint) is direct', () => {
    expect(isTorrentRoute({ sourceId: 'addon|comet', type: 'mp4', url: 'https://debrid.example/v.mkv' })).toBe(false);
    expect(isTorrentRoute({ sourceId: 'addon|jackettio', type: null, fingerprint: 'route:addon|jackettio:abc' })).toBe(false);
  });
  it('real torrents stay torrents', () => {
    expect(isTorrentRoute({ sourceId: 'addon|torrentio', type: 'torrent' })).toBe(true);
    expect(isTorrentRoute({ sourceId: 'addon|torrentio', type: null, fingerprint: `btih:${'a'.repeat(40)}:3` })).toBe(true);
    expect(isTorrentRoute({ sourceId: 'addon|torrentio', infoHash: 'a'.repeat(40) })).toBe(true);
    // بلا أي دليل: كما كان
    expect(isTorrentRoute({ sourceId: 'addon|x' })).toBe(true);
  });
});
