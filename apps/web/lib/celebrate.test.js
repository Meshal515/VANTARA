import { describe, expect, it } from 'vitest';
import { celebrationFor, markCelebrated } from './celebrate.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};
const releases = [
  { version: '0.3.0', celebrate: { headline: 'كبير' }, items: [{ platforms: ['shared'], text: 'a' }, { platforms: ['pwa'], text: 'b' }] },
  { version: '0.2.0', items: [{ platforms: ['shared'], text: 'old' }] },
];

describe('the big-update celebration', () => {
  it('shows once per celebrated release, with only this platform\'s items', () => {
    const storage = memory();
    const first = celebrationFor('apk', storage, releases);
    expect(first?.version).toBe('0.3.0');
    expect(first.items.map((i) => i.text)).toEqual(['a']);
    markCelebrated('0.3.0', storage);
    expect(celebrationFor('apk', storage, releases)).toBeNull();
  });

  it('an ordinary release never celebrates', () => {
    expect(celebrationFor('apk', memory(), releases.slice(1))).toBeNull();
  });

  it('the shipped release carries a headline and an icon and title per highlight', async () => {
    const { RELEASE } = await import('./release.js');
    const [latest] = RELEASE.releases;
    expect(latest.celebrate?.headline).toBeTruthy();
    for (const item of latest.items) expect(item.icon && item.title && item.text).toBeTruthy();
  });
});
