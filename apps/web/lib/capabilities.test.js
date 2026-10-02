import { describe, expect, it } from 'vitest';
import { RELEASE, releaseNotesFor } from './release.js';
import { supportedList, supports } from './capabilities.js';

const release = {
  ...RELEASE,
  features: { manga: ['apk', 'pwa'], rafiq: ['apk'], webSources: ['pwa'] },
  flags: {
    pwaCinema: { enabled: true, platforms: ['pwa'] },
    newMangaHome: { enabled: true, accounts: ['ngm'] },
    killed: { enabled: false },
  },
};

describe('capabilities', () => {
  it('shared features exist on both platforms, exclusive ones on their platform only', () => {
    expect(supports('manga', { platform: 'apk', release })).toBe(true);
    expect(supports('manga', { platform: 'pwa', release })).toBe(true);
    expect(supports('rafiq', { platform: 'apk', release })).toBe(true);
    expect(supports('rafiq', { platform: 'pwa', release })).toBe(false);
    expect(supports('webSources', { platform: 'apk', release })).toBe(false);
    expect(supports('unknown', { platform: 'pwa', release })).toBe(false);
  });

  it('flags target a platform, chosen accounts, or switch off everywhere', () => {
    expect(supports('pwaCinema', { platform: 'pwa', release })).toBe(true);
    expect(supports('pwaCinema', { platform: 'apk', release })).toBe(false);
    expect(supports('newMangaHome', { platform: 'apk', account: 'NGM', release })).toBe(true);
    expect(supports('newMangaHome', { platform: 'apk', account: 'dahmi', release })).toBe(false);
    expect(supports('newMangaHome', { platform: 'apk', account: null, release })).toBe(false);
    expect(supports('killed', { platform: 'pwa', release })).toBe(false);
  });

  it('lists what a platform supports', () => {
    expect(supportedList({ platform: 'pwa', account: null, release })).toEqual(['manga', 'pwaCinema', 'webSources']);
  });

  it('release notes show shared items plus the platform own', () => {
    const notes = releaseNotesFor('pwa', [{ version: '1', items: [{ text: 'a', platforms: ['shared'] }, { text: 'b', platforms: ['apk'] }, { text: 'c', platforms: ['pwa'] }] }, { version: '0', items: [{ text: 'd', platforms: ['apk'] }] }]);
    expect(notes).toEqual([{ version: '1', items: [{ text: 'a', platforms: ['shared'] }, { text: 'c', platforms: ['pwa'] }] }]);
  });

  it('the real manifest keeps Rafiq and translation APK-only, and the three sections on both', () => {
    for (const f of ['manga', 'anime', 'cinema', 'social', 'library', 'progress']) expect(RELEASE.features[f]).toEqual(['apk', 'pwa']);
    for (const f of ['rafiq', 'translation', 'autoTranslation']) expect(RELEASE.features[f]).toEqual(['apk']);
    for (const f of ['webSources', 'webInstall', 'webUpdate']) expect(RELEASE.features[f]).toEqual(['pwa']);
    for (const r of RELEASE.releases) for (const it of r.items) expect(it.platforms.every((p) => ['shared', 'apk', 'pwa'].includes(p))).toBe(true);
  });
});
