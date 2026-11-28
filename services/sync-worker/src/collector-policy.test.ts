import { describe, expect, it } from 'vitest';
import { plannedCollectors } from './collector-policy.ts';

describe('94% global collector scheduling', () => {
  it('has exactly 48 anime, 12 series and 4 movie runs per UTC day', () => {
    const jobs = Array.from({length:1440}, (_, i) => plannedCollectors('manga-local', i * 60_000)).flat();
    expect(jobs.filter(j=>j==='anilist')).toHaveLength(48);
    expect(jobs.filter(j=>j==='cinemeta-series')).toHaveLength(12);
    expect(jobs.filter(j=>j==='cinemeta-movies')).toHaveLength(4);
    expect(jobs).toHaveLength(64);
  });
  it('keeps the legacy manga cadence in hybrid and never overlaps global jobs', () => {
    const slots = Array.from({length:1440}, (_, i) => plannedCollectors('hybrid', i * 60_000));
    const jobs=slots.flat();
    expect(jobs.filter(j=>j==='teamx')).toHaveLength(360);
    expect(jobs.filter(j=>j==='mangadex-ar')).toHaveLength(360);
    expect(jobs.filter(j=>j==='manga-sites')).toHaveLength(720);
    expect(slots.every(s=>s.filter(j=>j==='anilist'||j.startsWith('cinemeta')).length<=1)).toBe(true);
  });
  it('disables every collector including manual collection in exclusive mode', () => {
    for(let i=0;i<1440;i++) expect(plannedCollectors('exclusive',i*60_000)).toEqual([]);
    expect(plannedCollectors('exclusive',0,false)).toEqual([]);
    expect(plannedCollectors('manga-local',0,false)).toEqual(['anilist','cinemeta-series','cinemeta-movies']);
  });
});
