import { describe, expect, it } from 'vitest';
import { playbackHealth } from './source-report.js';

describe('playback health (تعذّر ≤ 1%)', () => {
  const rows = [
    { platform: 'apk', section: 'anime', source_id: 'episode', stage: 'play', outcome: 'ok', reason: '', count: 990, ms_sum: 990 * 4200 },
    { platform: 'apk', section: 'anime', source_id: 'episode', stage: 'play', outcome: 'error', reason: 'all_servers_failed', count: 6 },
    { platform: 'apk', section: 'anime', source_id: 'episode', stage: 'play', outcome: 'timeout', reason: 'left_waiting', count: 4 },
    { platform: 'apk', section: 'anime', source_id: 'okru', stage: 'server', outcome: 'error', reason: 'x', count: 30 },
    { platform: 'apk', section: 'anime', source_id: 'okru', stage: 'server', outcome: 'ok', reason: '', count: 70 },
    { platform: 'apk', section: 'anime', source_id: 'hgc', stage: 'server', outcome: 'ok', reason: '', count: 900 },
    { platform: 'pwa', section: 'anime', source_id: 'episode', stage: 'play', outcome: 'error', reason: 'x', count: 500 },
  ];
  it('counts an attempt as failed only when nothing played, and checks the 1% target', () => {
    const h = playbackHealth(rows);
    expect(h.attempts).toBe(1000);
    expect(h.failed).toBe(10);
    expect(h.failRate).toBe(0.01);
    expect(h.meetsTarget).toBe(true);
    expect(h.avgStartMs).toBe(4200);
    expect(h.reasons).toEqual({ all_servers_failed: 6, left_waiting: 4 });
    expect(h.servers[0]).toMatchObject({ server: 'okru', failed: 30, failRate: 0.3 });
  });
  it('does not judge the target on too few attempts', () => {
    expect(playbackHealth(rows.slice(1, 3)).meetsTarget).toBeNull();
  });
});
