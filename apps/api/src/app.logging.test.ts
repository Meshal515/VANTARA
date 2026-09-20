import { describe, expect, it } from 'vitest';
import { requestUrlForLog } from './app.ts';

describe('request log redaction', () => {
  it('redacts signed media capability tokens without losing the route', () => {
    const logged = requestUrlForLog('/v1/media/page/book-1/7?t=super-secret-token&maxWidth=1200');
    expect(logged).toContain('/v1/media/page/book-1/7');
    expect(logged).toContain('maxWidth=1200');
    expect(logged).not.toContain('super-secret-token');
  });
});
