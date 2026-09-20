import { describe, expect, it } from 'vitest';
import { requestLogSerializer, sanitizeRequestUrl } from './app.ts';

describe('request log redaction', () => {
  it('drops signed media capability query values from access logs', () => {
    const raw = '/v1/media/page/book-1/7?t=0123456789abcdef0123456789abcdef&width=1200';
    expect(sanitizeRequestUrl(raw)).toBe('/v1/media/page/book-1/7');

    const logged = requestLogSerializer({
      method: 'GET',
      url: raw,
      hostname: 'api.vantara.test',
      ip: '203.0.113.9',
    });
    const dump = JSON.stringify(logged);
    expect(dump).not.toContain('0123456789abcdef0123456789abcdef');
    expect(dump).not.toContain('?t=');
    expect(logged.url).toBe('/v1/media/page/book-1/7');
  });

  it('drops every query string, not only today\'s token parameter', () => {
    expect(sanitizeRequestUrl('/v1/search?q=secretish&token=abc')).toBe('/v1/search');
  });
});
