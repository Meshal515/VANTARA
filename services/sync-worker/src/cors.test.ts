import { describe, expect, it } from 'vitest';
import { isOriginAllowed } from './cors.ts';

describe('sync worker CORS origin matching', () => {
  const configured = 'https://vantara-bcf.pages.dev,https://*.vantara-bcf.pages.dev';

  it('allows the production Pages hostname', () => {
    expect(isOriginAllowed('https://vantara-bcf.pages.dev', configured)).toBe(true);
  });

  it('allows Cloudflare Pages preview aliases for the same project', () => {
    expect(
      isOriginAllowed('https://claude-dreamy-faraday-w9rtsp.vantara-bcf.pages.dev', configured),
    ).toBe(true);
  });

  it('keeps the Capacitor HTTPS origin allowed', () => {
    expect(isOriginAllowed('https://localhost', configured)).toBe(true);
  });

  it('rejects lookalike and unrelated origins', () => {
    expect(isOriginAllowed('https://vantara-bcf.pages.dev.evil.example', configured)).toBe(false);
    expect(isOriginAllowed('https://evilvantara-bcf.pages.dev', configured)).toBe(false);
    expect(isOriginAllowed('https://example.com', configured)).toBe(false);
  });

  it('rejects protocol changes even when the hostname matches', () => {
    expect(isOriginAllowed('http://vantara-bcf.pages.dev', configured)).toBe(false);
  });
});
