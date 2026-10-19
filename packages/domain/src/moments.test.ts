import { describe, expect, it } from 'vitest';
import { normalizeMoment } from './moments.ts';
const moment = { version: 1, startMs: 120_000, endMs: 155_000, episode: 3 };

describe('source-backed moments', () => {
  it('keeps the original episode range and provider-only hints without credentials', () => {
    expect(normalizeMoment({ ...moment, sources: [{ sourceId: 'addon|https://public.example/manifest.json', server: '1080p', headers: { Cookie: 'secret' }, cookie: 'secret' }] }))
      .toEqual({ ...moment, sources: [{ sourceId: 'addon|https://public.example/manifest.json', server: '1080p' }] });
    expect(normalizeMoment({ ...moment, episode: null })).toEqual({ ...moment, episode: null, sources: [] });
    expect(normalizeMoment({ ...moment, sources: [{ url: 'https://cdn.example/clip.mp4?expires=1800000000&signature=public-expiring-hint' }] })?.sources[0]?.url).toContain('signature=');
  });
  it('rejects invalid durations, credential URLs and local targets', () => {
    for (const change of [{ startMs: -1 }, { endMs: 120_000 }, { endMs: 190_001 }, { endMs: Infinity }, { episode: -1 }, { version: 2 }]) expect(normalizeMoment({ ...moment, ...change })).toBeNull();
    for (const url of ['javascript:alert(1)', 'http://localhost/x', 'http://127.1/x', 'http://10.0.0.1/x', 'http://172.16.1.1/x', 'http://192.168.1.1/x', 'http://[::1]/x', 'https://user:secret@cdn.example/x', 'https://cdn.example/x?cookie=secret']) expect(normalizeMoment({ ...moment, sources: [{ url }] })).toBeNull();
  });
});
