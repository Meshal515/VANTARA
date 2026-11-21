import { describe, expect, it, vi } from 'vitest';
import { EXT_PREFIX, REPO_PREFIX, fieldFor, fieldKey, planSync, readAccount, startExtensionSync } from './extension-sync.js';

// المرحلة 3: قائمة الإضافات في حسابك. الكود على الجهاز، والحساب يحفظ القائمة فقط.
const REPO = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo';
const KEY = '9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2';
const MILLION = 'eu.kanade.tachiyomi.extension.all.mangamillion';
const TEAMX = 'eu.kanade.tachiyomi.extension.ar.teamx';
const repoField = (on, at, extra = {}) => ({ [fieldKey(REPO_PREFIX, REPO)]: { url: REPO, name: 'Keiyoushi', fingerprint: KEY, on, at, ...extra } });
const extField = (pkg, on, at) => ({ [fieldKey(EXT_PREFIX, pkg)]: { pkg, repo: REPO, on, at } });

describe('the list format', () => {
  it('field names are short, stable and valid settings keys', () => {
    const key = fieldKey(EXT_PREFIX, MILLION);
    expect(key).toBe(fieldKey(EXT_PREFIX, MILLION));
    expect(key).not.toBe(fieldKey(EXT_PREFIX, TEAMX));
    expect(key).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
    expect(fieldKey(REPO_PREFIX, `${REPO}/${'x'.repeat(500)}`)).toMatch(/^extrepo_[0-9a-f]{16}$/);
  });

  it('reads only well-formed entries whose name matches their content (a forged or edited entry is ignored)', () => {
    const data = {
      ...repoField(true, 5), ...extField(MILLION, true, 6),
      [fieldKey(EXT_PREFIX, TEAMX)]: { pkg: MILLION, repo: REPO, on: true, at: 7 }, // اسم لا يطابق المحتوى
      [fieldKey(REPO_PREFIX, 'http://insecure.example/repo')]: { url: 'http://insecure.example/repo', on: true, at: 1 },
      readerMode: 'webtoon', srcpkg_x: { pkg: 'x', on: true },
    };
    const { repos, exts } = readAccount(JSON.stringify(data));
    expect([...repos.values()].map((r) => r.url)).toEqual([REPO]);
    expect([...exts.values()].map((x) => x.pkg)).toEqual([MILLION]);
  });

  it('a change made by hand becomes exactly one field', () => {
    expect(fieldFor({ type: 'ext', on: false, pkg: MILLION }, 9)).toEqual([fieldKey(EXT_PREFIX, MILLION), { pkg: MILLION, repo: null, on: false, at: 9 }]);
    expect(fieldFor({ type: 'repo', on: true, url: REPO, name: 'K', fingerprint: KEY }, 9)[1]).toMatchObject({ url: REPO, fingerprint: KEY, on: true });
    expect(fieldFor({ type: 'ext', on: true, pkg: '../evil' }, 9)).toBeNull();
    expect(fieldFor({ type: 'repo', on: true, url: 'file:///etc' }, 9)).toBeNull();
  });
});

describe('the plan', () => {
  const empty = { repos: [], installed: [] };

  it('a new device installs what the account lists, with the repository and its signing key first', () => {
    const plan = planSync({ account: readAccount({ ...repoField(true, 1), ...extField(MILLION, true, 2) }), local: empty });
    expect(plan.addRepos).toEqual([{ url: REPO, fingerprint: KEY }]);
    expect(plan.installs).toEqual([{ pkg: MILLION, repo: REPO }]);
    expect(plan.uninstalls).toEqual([]);
  });

  it('removed on another device: removed here too', () => {
    const local = { repos: [{ url: REPO }], installed: [{ pkg: MILLION, repo: REPO }] };
    const plan = planSync({ account: readAccount({ ...repoField(false, 3), ...extField(MILLION, false, 3) }), local });
    expect(plan.uninstalls).toEqual([MILLION]);
    expect(plan.removeRepos).toEqual([REPO]);
  });

  it('removed here while offline: the not-yet-synced removal wins, the account does not reinstall it', () => {
    const plan = planSync({ account: readAccount(extField(MILLION, true, 2)), ledger: extField(MILLION, false, 5), local: empty });
    expect(plan.installs).toEqual([]);
    // والعكس: سجل محلي أقدم مما في الحساب لا يغلبه
    const older = planSync({ account: readAccount(extField(MILLION, true, 9)), ledger: extField(MILLION, false, 5), local: empty });
    expect(older.installs).toEqual([{ pkg: MILLION, repo: REPO }]);
  });

  it('first time for this account on this device: what is here is added to the account; later, nothing outside the account is touched', () => {
    const local = { repos: [{ url: REPO, name: 'Keiyoushi', fingerprint: KEY }], installed: [{ pkg: TEAMX, repo: REPO }] };
    const first = planSync({ account: readAccount({}), local, adopt: true, now: 42 });
    expect(Object.values(first.push).map((v) => v.pkg ?? v.url).sort()).toEqual([TEAMX, REPO].sort());
    expect(Object.values(first.push).every((v) => v.on === true && v.at === 42)).toBe(true);
    const later = planSync({ account: readAccount({}), local, adopt: false });
    expect(later.push).toEqual({});
    expect(later.uninstalls).toEqual([]);
  });

  it('an entry without its repository is not installed blindly', () => {
    const data = { [fieldKey(EXT_PREFIX, MILLION)]: { pkg: MILLION, repo: null, on: true, at: 1 } };
    expect(planSync({ account: readAccount(data), local: empty }).installs).toEqual([]);
  });
});

describe('the driver', () => {
  function harness({ data = {}, local = { repos: [], installed: [] }, user = 'u1' } = {}) {
    const memory = new Map();
    const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
    const written = [];
    const sync = {
      user: user ? { userId: user } : null,
      row: (table, id) => (table === 'settings' && id === sync.user?.userId ? { data } : null),
      enqueue: vi.fn(async (kind, payload, opts) => { written.push({ kind, fields: payload.fields, opts }); }),
    };
    const target = {
      list: vi.fn(async () => local),
      addRepo: vi.fn(async ({ url }) => { local.repos.push({ url }); }),
      removeRepo: vi.fn(async () => ({})),
      install: vi.fn(async ({ pkg, repo }) => { local.installed.push({ pkg, repo }); }),
      uninstall: vi.fn(async () => ({})),
    };
    let clock = 1000;
    const driver = startExtensionSync({ sync, target, storage, now: () => clock });
    return { driver, sync, target, written, local, tick: (ms) => { clock += ms; } };
  }

  it('what you do by hand is written to your account at once and durably', async () => {
    const h = harness();
    await h.driver.onLocal({ type: 'ext', on: true, pkg: MILLION, repo: REPO });
    expect(h.written).toEqual([{ kind: 'settings.patch', fields: extField(MILLION, true, 1000), opts: { requireDurable: true } }]);
  });

  it('a device signing in installs your list: repository with its key, then the extension', async () => {
    const h = harness({ data: { ...repoField(true, 1), ...extField(MILLION, true, 2) } });
    await h.driver.reconcile();
    expect(h.target.addRepo).toHaveBeenCalledWith({ url: REPO, fingerprint: KEY });
    expect(h.target.install).toHaveBeenCalledWith({ pkg: MILLION, repo: REPO });
    // ما طبّقته المزامنة لا يُعاد كتابته
    expect(h.written.flatMap((w) => Object.keys(w.fields))).not.toContain(fieldKey(EXT_PREFIX, MILLION));
  });

  it('a failing install is retried later, not on every account change', async () => {
    const h = harness({ data: { ...repoField(true, 1), ...extField(MILLION, true, 2) } });
    h.target.install.mockRejectedValue(new Error('network'));
    await h.driver.reconcile();
    await h.driver.reconcile();
    expect(h.target.install).toHaveBeenCalledTimes(1);
    h.tick(11 * 60_000);
    await h.driver.reconcile();
    expect(h.target.install).toHaveBeenCalledTimes(2);
  });

  it('adopts this device once per account, and nothing without an account', async () => {
    const h = harness({ local: { repos: [{ url: REPO, name: 'Keiyoushi', fingerprint: KEY }], installed: [{ pkg: TEAMX, repo: REPO }] } });
    await h.driver.reconcile();
    expect(h.written).toHaveLength(1);
    await h.driver.reconcile();
    expect(h.written).toHaveLength(1);
    const none = harness({ user: null, local: { repos: [{ url: REPO }], installed: [{ pkg: TEAMX, repo: REPO }] } });
    await none.driver.reconcile();
    await none.driver.onLocal({ type: 'ext', on: true, pkg: MILLION, repo: REPO });
    expect(none.written).toEqual([]);
    expect(none.target.list).not.toHaveBeenCalled();
  });

  it('an account switch in the middle stops applying the previous account', async () => {
    const h = harness({ data: { ...repoField(true, 1), ...extField(MILLION, true, 2), ...extField(TEAMX, true, 2) } });
    h.target.addRepo.mockImplementation(async ({ url }) => { h.local.repos.push({ url }); h.sync.user = { userId: 'someone-else' }; });
    await h.driver.reconcile();
    expect(h.target.install).not.toHaveBeenCalled();
  });
});
