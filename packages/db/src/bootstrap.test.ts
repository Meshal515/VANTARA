import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function text(path: string): Promise<string> {
  return readFile(join(ROOT, path), 'utf8');
}

describe('B1 clean-install invariants', () => {
  it('bootstraps the separate Uchiyomi database during first Postgres init', async () => {
    const compose = await text('infra/docker-compose.yml');
    const init = await text('infra/postgres-init/10-create-uchiyomi.sh');

    expect(compose).toContain('UCHIYOMI_DB: ${UCHIYOMI_DB:-uchiyomi}');
    expect(compose).toContain('./postgres-init:/docker-entrypoint-initdb.d:ro');
    expect(init).toContain('CREATE DATABASE');
    expect(init).toContain('UCHIYOMI_DB');
    expect(init).toContain('POSTGRES_USER');
  });

  it('runs VANTARA migrations before the API opens its pool or listens', async () => {
    const server = await text('apps/api/src/server.ts');
    const migrateAt = server.indexOf('await migrate(');
    const initPoolAt = server.indexOf('initPool(');
    const listenAt = server.indexOf('app.listen(');

    expect(migrateAt).toBeGreaterThan(-1);
    expect(initPoolAt).toBeGreaterThan(migrateAt);
    expect(listenAt).toBeGreaterThan(initPoolAt);
  });

  it('readiness checks the required VANTARA schema, not only SELECT 1', async () => {
    const app = await text('apps/api/src/app.ts');
    expect(app).toContain("to_regclass('public.vantara_users')");
    expect(app).toContain('schema:');
  });

  it('waits for a healthy Uchiyomi before starting the API', async () => {
    const compose = await text('infra/docker-compose.yml');
    expect(compose).toMatch(/uchiyomi:[\s\S]*?healthcheck:/);
    expect(compose).toContain('uchiyomi: { condition: service_healthy }');
  });
});
