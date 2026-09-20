import { describe, expect, it, vi } from 'vitest';

const verifyIdentityToken = vi.hoisted(() =>
  vi.fn(async () => ({
    userId: '11111111-1111-1111-1111-111111111111',
    deviceId: 'device-1',
  })),
);

vi.mock('@vantara/domain', async (importOriginal) => {
  const original = await importOriginal<typeof import('@vantara/domain')>();
  return { ...original, verifyIdentityToken };
});

const { requireSession } = await import('./context.ts');
const { IdentityRelinkRequiredError } = await import('./sessions.ts');

describe('bearer identity relink contract', () => {
  it('returns a deterministic relink_required response for an expired upstream credential', async () => {
    const ctx = {
      config: { VANTARA_IDENTITY_SECRET: 'test-secret-at-least-32-characters-long' },
      sessions: {
        resolveIdentity: vi.fn(async () => {
          throw new IdentityRelinkRequiredError();
        }),
      },
    };

    const request = {
      headers: { authorization: 'Bearer valid-v2-token' },
      cookies: {},
    };
    const reply = {
      code: vi.fn(),
      send: vi.fn(),
    };
    reply.code.mockReturnValue(reply);
    reply.send.mockReturnValue(reply);

    await requireSession(ctx as never)(request as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith({ error: 'content_relink_required' });
  });
});
