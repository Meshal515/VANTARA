import { describe, expect, it } from 'vitest';
import { describeFailure, ORIGIN, siteStatusMessage } from './plugin-failure.js';
import { HostCoolingError } from './host-breaker.js';

const arabic = /[؀-ۿ]/;

describe('transparent failure: an Arabic reason that says where it came from', () => {
  it('cancellation is its own state, never success and never blamed on anyone', () => {
    const out = describeFailure(new DOMException('x', 'AbortError'));
    expect(out).toMatchObject({ code: 'CANCELLED', cancelled: true, origin: ORIGIN.USER });
    expect(out.text).toMatch(arabic);
  });

  it('site replies say the fault is the site, keep the HTTP number for diagnostics', () => {
    for (const status of [403, 429, 500, 503]) {
      const out = describeFailure({ status, message: 'x' });
      expect(out.origin).toBe(ORIGIN.SITE);
      expect(out.text).toContain(`HTTP ${status}`);
      expect(out.text).toMatch(/الموقع/);
    }
    expect(siteStatusMessage(404)).toMatch(/أُزيل من موقع المصدر/);
    expect(describeFailure(new HostCoolingError('a.test', 5000)).text).toContain('الخلل من الموقع لا من VANTARA');
  });

  it('device, VANTARA and contract failures are named as such', () => {
    expect(describeFailure({ code: 'network' }).origin).toBe(ORIGIN.NETWORK);
    expect(describeFailure({ code: 'host_not_allowed' }).origin).toBe(ORIGIN.VANTARA);
    expect(describeFailure({ code: 'rate_limited', status: 429 }).origin).toBe(ORIGIN.VANTARA);
    expect(describeFailure({ code: 'challenge' }).text).toMatch(/تحقق/);
    expect(describeFailure({ code: 'INVALID_RESPONSE' }).code).toBe('CONTRACT');
  });

  it('never leaks a URL (a Stremio URL may carry a debrid key) and never guesses an unknown cause', () => {
    const out = describeFailure(new Error('فشل https://torrentio.test/realdebrid=KEY/stream.json'));
    expect(out.text).not.toContain('KEY');
    const unknown = describeFailure(new Error('weird internal thing'));
    expect(unknown.origin).toBe(ORIGIN.UNKNOWN);
    expect(unknown.text).toMatch(arabic);
  });
});
