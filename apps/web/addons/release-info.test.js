import { describe, expect, it } from 'vitest';
import { parseRelease, releaseScore, specLine, swarmText, swarmTier } from './release-info.js';

// بصيغة Torrentio الفعلية (addon/lib/streamInfo.js): name = «Torrentio\n<جودة> <HDR>»،
// title = اسم التورنت ثم «👤 n 💾 size ⚙️ site» ثم اللغات أعلامًا
const uhd = parseRelease(
  'Torrentio\n4k DV | HDR10+',
  'Fight.Club.1999.2160p.UHD.BluRay.REMUX.HEVC.DV.HDR10Plus.TrueHD.Atmos.7.1-GROUP\n👤 412 💾 61.2 GB ⚙️ ThePirateBay\nMulti Audio / 🇸🇦 / 🇫🇷',
);

describe('parseRelease', () => {
  it('reads seeders, size, site, source, codec, HDR, audio and languages', () => {
    expect(uhd).toMatchObject({
      provider: 'Torrentio',
      quality: 2160,
      hdr: ['DV', 'HDR10+'],
      source: 'REMUX',
      codec: 'HEVC',
      audio: 'Atmos',
      seeders: 412,
      sizeLabel: '61 GB',
      site: 'ThePirateBay',
      languages: ['ar', 'fr'],
      arabic: true,
      multiAudio: true,
      filename: 'Fight.Club.1999.2160p.UHD.BluRay.REMUX.HEVC.DV.HDR10Plus.TrueHD.Atmos.7.1-GROUP',
    });
  });

  it('a plain web release without languages or HDR', () => {
    const r = parseRelease('Torrentio\n1080p', 'Fight.Club.1999.1080p.WEB-DL.x264.AAC\n👤 3 💾 1.95 GB ⚙️ YTS');
    expect(r).toMatchObject({ quality: 1080, hdr: [], source: 'WEB-DL', codec: 'H.264', audio: 'AAC', seeders: 3, sizeLabel: '2.0 GB', arabic: false, languages: [] });
  });

  it('missing fields stay null, never guessed', () => {
    const r = parseRelease('MyAddon', 'Episode 1');
    expect(r).toMatchObject({ seeders: null, size: null, source: null, codec: null, site: null, quality: null });
    expect(swarmText(r)).toBeNull();
  });
});

describe('swarm and ranking', () => {
  it('tiers from advertised seeders', () => {
    expect([0, 3, 12, 400, null].map(swarmTier)).toEqual(['dead', 'weak', 'fair', 'strong', null]);
    expect(swarmText(uhd)).toBe('412 مشارك · قوي');
    expect(swarmText({ seeders: 0 })).toBe('لا مشاركين');
  });

  it('strong swarm above weak; CAM last; unknown count is middle, not dead; Arabic breaks ties', () => {
    const weak = parseRelease('Torrentio\n1080p', 'A.1080p.BluRay\n👤 2 💾 2 GB');
    const strong = parseRelease('Torrentio\n1080p', 'B.1080p.WEB-DL\n👤 90 💾 2 GB');
    const cam = parseRelease('Torrentio\nCAM', 'C.HDCAM\n👤 900 💾 1 GB');
    const unknown = parseRelease('Other\n1080p', 'D.1080p');
    const dead = parseRelease('Torrentio\n1080p', 'E.1080p\n👤 0');
    const ranked = [weak, cam, unknown, dead, strong].sort((a, b) => releaseScore(b) - releaseScore(a)).map((r) => r.filename[0]);
    expect(ranked).toEqual(['B', 'D', 'A', 'E', 'C']);
    const arabic = parseRelease('Torrentio\n1080p', 'F.1080p\n👤 90\n🇸🇦');
    expect(releaseScore(arabic)).toBeGreaterThan(releaseScore(strong));
  });

  it('spec line is short and only what the release states', () => {
    expect(specLine(uhd)).toBe('61 GB · HEVC · Atmos');
    expect(specLine(parseRelease('X', 'nothing'))).toBe('');
  });
});
