import { describe, expect, it, vi } from 'vitest';
import worker from './secure-index.ts';
import { sqliteEnv } from './test-d1.ts';

describe('post-deploy verifier with internal sync rows', () => {
  it('verifies writes in D1 while proving internal fixtures never reach sync clients', async () => {
    const { env, db } = sqliteEnv({
      VANTARA_SESSION_SECRET: 'verifier-test-session-secret-32-chars',
      VANTARA_IDENTITY_SECRET: 'verifier-test-identity-secret-32-chars',
      VANTARA_DEVICE_PEPPER: 'verifier-test-device-pepper-32-chars',
    });
    const savedArgv = process.argv;
    const savedExitCode = process.exitCode;
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line) => output.push(String(line)));
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-only');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'test-account');
    vi.stubEnv('D1_DATABASE_ID', 'test-database');
    vi.stubEnv('VANTARA_DEVICE_PEPPER', env.VANTARA_DEVICE_PEPPER);
    vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
      if (input.startsWith('https://api.cloudflare.com/')) {
        const { sql, params } = JSON.parse(String(init.body));
        const statement = db.prepare(sql);
        const results = /^\s*SELECT\b/i.test(sql) ? statement.all(...params) : (statement.run(...params), []);
        return Response.json({ success: true, result: [{ results }] });
      }
      return worker.fetch(new Request(input, init), env, { waitUntil: () => {} });
    });
    process.argv = ['node', 'verify.mjs', 'https://worker.test'];
    process.exitCode = 0;
    try {
      const verifier = '../verify.mjs';
      await import(verifier);
      expect(output.filter((line) => line.startsWith('✗'))).toEqual([]);
      expect(output).toContain('✓ كيانات التحقق الداخلية لا تصل في الفروقات');
      expect(output).toContain('✓ التقدم الداخلي لا يصل في الفروقات');
      expect(output).toContain('✓ الفصل الداخلي كُتب في D1');
      expect(output).toContain('\nكل الفحوص نجحت');
      expect(process.exitCode).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS n FROM works WHERE series_ref LIKE '__verify__%'").get()).toMatchObject({ n: 0 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE username = '__verify__'").get()).toMatchObject({ n: 0 });
    } finally {
      process.argv = savedArgv;
      process.exitCode = savedExitCode;
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      db.close();
    }
  });
});
