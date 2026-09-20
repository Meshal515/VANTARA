import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const queryOne = vi.fn(async (sql: string, params?: unknown[]) => {
  void sql;
  void params;
  return { id: 'report-1' };
});

vi.mock('@vantara/db', () => ({
  query: vi.fn(async () => []),
  queryOne,
  transaction: vi.fn(async () => undefined),
  initPool: vi.fn(),
  closePool: vi.fn(async () => undefined),
}));

const { buildApp } = await import('./app.ts');
const { loadConfig } = await import('./lib/config.ts');
const { SESSION_COOKIE } = await import('./lib/context.ts');

let app: FastifyInstance;

beforeAll(async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
    UCHIYOMI_URL: 'http://127.0.0.1:1',
    SESSION_SECRET: 'test-secret-that-is-at-least-32-chars-long',
    VANTARA_IDENTITY_SECRET: 'test-identity-secret-at-least-32-chars-x',
    COOKIE_SECURE: 'false',
    LOG_LEVEL: 'error',
  });
  const built = await buildApp(config);
  app = built.app;
  built.ctx.sessions.resolve = async () => ({
    id: 'session-1',
    userId: 'user-1',
    username: 'meshal',
    token: 'upstream-token',
  });
  built.ctx.sessions.touch = async () => undefined;
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

describe('report description secret scrubbing', () => {
  it('scrubs bearer and signed-media capabilities before PostgreSQL receives the description', async () => {
    queryOne.mockClear();
    const mediaToken = '0123456789abcdef0123456789abcdef';
    const bearer = 'Bearer abcdefghijklmnopqrstuvwxyz123456';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { cookie: `${SESSION_COOKIE}=session-1` },
      payload: {
        kind: 'MISSING_PAGE',
        description: `فشلت الصفحة /page/7?t=${mediaToken} ثم ${bearer}`,
      },
    });

    expect(res.statusCode).toBe(201);
    const insert = queryOne.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO vantara_reports'));
    expect(insert).toBeDefined();
    const params = insert?.[1] as unknown[];
    const storedDescription = String(params?.[6] ?? '');
    expect(storedDescription).not.toContain(mediaToken);
    expect(storedDescription).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(storedDescription).toContain('[redacted]');
  });
});
