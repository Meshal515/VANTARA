import { describe, expect, it } from 'vitest';
import { cleanReason, handleSourceReportGet, handleSourceReportPost, type SourceReportsEnv } from './source-reports.ts';
import { sqliteEnv } from './test-d1.ts';

/**
 * صحة المصادر من الأجهزة الحقيقية: عدّادات يومية تُجمع، بلا بيانات شخصية،
 * وما لا يطابق العقد يُرفض بدل أن يُخزَّن.
 */
const NOW = Date.UTC(2026, 9, 3, 12);
const env = () => sqliteEnv({ VANTARA_SESSION_SECRET: 'x'.repeat(40), VANTARA_IDENTITY_SECRET: 'y'.repeat(40), VANTARA_DEVICE_PEPPER: 'z'.repeat(40) } as never).env as SourceReportsEnv;
const post = (body: unknown) => new Request('https://x/v1/diag/sources', { method: 'POST', body: JSON.stringify(body) });
const get = async (e: SourceReportsEnv, days = 2) =>
  (await (await handleSourceReportGet(new URL(`https://x/v1/diag/sources?days=${days}`), e, NOW)).json()) as { rows: Array<Record<string, unknown>> };

describe('source reports', () => {
  it('aggregates counts and times per platform/source/stage/outcome', async () => {
    const e = env();
    const ev = { section: 'manga', sourceId: 'eu.kanade.tachiyomi.extension.ar.mangalek', stage: 'details', outcome: 'timeout', reason: 'timeout', ms: 12000 };
    await handleSourceReportPost(post({ platform: 'apk', appVersion: '0.0.99', events: [ev, { ...ev, ms: 14000 }] }), e, NOW);
    await handleSourceReportPost(post({ platform: 'apk', appVersion: '0.0.99', events: [{ ...ev, outcome: 'ok', ms: 900, n: 3 }] }), e, NOW);
    const { rows } = await get(e);
    const timeout = rows.find((r) => r.outcome === 'timeout')!;
    expect(timeout).toMatchObject({ platform: 'apk', section: 'manga', stage: 'details', count: 2, ms_sum: 26000, ms_max: 14000 });
    expect(rows.find((r) => r.outcome === 'ok')).toMatchObject({ count: 3, ms_sum: 2700, reason: '' });
  });

  it('rejects anything outside the contract and strips urls/ids from reasons', async () => {
    const e = env();
    const out = await (await handleSourceReportPost(post({ platform: 'apk', events: [
      { section: 'music', sourceId: 'x', stage: 'details', outcome: 'ok' },
      { section: 'manga', sourceId: 'bad id with spaces', stage: 'details', outcome: 'ok' },
      { section: 'manga', sourceId: 'teamx', stage: 'details', outcome: 'exploded' },
      { section: 'manga', sourceId: 'teamx', stage: 'details', outcome: 'error', reason: 'HTTP 403 https://olympustaff.com/series/123456789 for user 9876543' },
    ] }), e, NOW)).json() as { accepted: number };
    expect(out.accepted).toBe(1);
    const { rows } = await get(e);
    expect(rows[0]!.reason).toBe('HTTP 403 <url> for user <n>');
    expect(cleanReason('x'.repeat(300))).toHaveLength(80);
    expect((await handleSourceReportPost(post({ platform: 'ios', events: [] }), e, NOW)).status).toBe(400);
  });
});
