/** عميل الويب أمام بوابة الهوية والخادم الحقيقيين مع SQLite بجميع الهجرات. */
import { afterEach, expect, it, vi } from 'vitest';
import { createSync } from './sync.js';
import worker, { hashDeviceSecret } from '../../../services/sync-worker/src/secure-index.ts';
import { sqliteEnv } from '../../../services/sync-worker/src/test-d1.ts';

const USER = '07588797-a471-44d1-99ce-7fb4f188c196';
const DEVICE = 'sync-recovery-test-phone';
const CREDENTIAL = 'sync-recovery-test-credential-0001';
const PEPPER = 'sync-recovery-test-pepper-at-least-32-chars';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('renews an expired identity after offline recovery and retries a lost write response without double credit', async () => {
  const { env, db } = sqliteEnv({
    VANTARA_SESSION_SECRET: 'sync-recovery-session-secret-at-least-32-chars',
    VANTARA_IDENTITY_SECRET: 'sync-recovery-identity-secret-at-least-32-chars',
    VANTARA_DEVICE_PEPPER: PEPPER,
  });
  try {
    const hash = await hashDeviceSecret(CREDENTIAL, PEPPER);
    db.prepare('INSERT INTO trusted_devices (device_id, user_id, credential_hash, created_at, last_used_at) VALUES (?, ?, ?, 0, 0)').run(DEVICE, USER, hash);
    const values = new Map([
      ['vantara.device.id', DEVICE], ['vantara.device.credential', CREDENTIAL],
      ['vantara.public-views.v1', '1'], ['vantara.private-usage.v1', '1'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    });
    const deliver = (url, options) => worker.fetch(new Request(url, options), env, { waitUntil: () => {} });
    let offline = false;
    let loseReply = false;
    const sentIds = [];
    vi.stubGlobal('fetch', async (url, options = {}) => {
      if (String(url).includes('/v1/session') && offline) throw new TypeError('Failed to fetch');
      if (String(url).includes('/v1/ops')) sentIds.push(JSON.parse(options.body).ops.map(op => op.opId));
      const res = await deliver(url, options);
      if (String(url).includes('/v1/ops') && res.ok && loseReply) {
        loseReply = false;
        throw new TypeError('Failed to fetch');
      }
      return res;
    });
    const sync = createSync({ baseUrl: 'https://sync.test' });
    await sync.signIn(USER);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    // انتهت جلسة الـ15 دقيقة بينما القراءة استمرت بلا شبكة.
    vi.setSystemTime(Date.now() + 20 * 60_000);
    offline = true;
    sync.enqueue('chapter.complete', { chapterKey: 'src:test:chapter-1', seriesRef: 'src:test:series', ratio: 1, activeMs: 9000 });
    const pending = values.get('vantara.queue');
    await sync.push({ force: true });
    expect(sync.pendingWrites).toBe(1);
    expect(values.get('vantara.queue')).toBe(pending);
    expect(db.prepare('SELECT COUNT(*) AS n FROM applied_ops').get().n).toBe(0);

    offline = false;
    loseReply = true;
    await sync.push({ force: true });
    expect(sync.pendingWrites).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM applied_ops').get().n).toBe(1);
    await sync.push({ force: true });
    expect(sync.pendingWrites).toBe(0);
    expect(sync.quarantined).toBe(0);
    expect(new Set(sentIds.flat()).size).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM applied_ops').get().n).toBe(1);
    expect(db.prepare('SELECT read_count FROM chapter_reads WHERE user_id = ? AND chapter_key = ?').get(USER, 'src:test:chapter-1').read_count).toBe(1);
    expect(sync.rows('chapter_reads')).toEqual(expect.arrayContaining([expect.objectContaining({ user_id: USER, chapter_key: 'src:test:chapter-1', read_count: 1 })]));
    expect(sync.health().state).toBe('ok');
  } finally {
    db.close();
  }
});
