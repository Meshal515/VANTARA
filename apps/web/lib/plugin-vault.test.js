import { describe, expect, it } from 'vitest';
import { canonicalJson, compareVersions, createPluginVault, fingerprint, sha256Hex, VAULT_LIMITS } from './plugin-vault.js';
import { createStore } from './idb-store.js';

const vaultStore = () => createStore({ indexedDB: null, spaces: { vault: { ttlMs: Infinity, maxBytes: 64 * 1024 * 1024, maxEntryBytes: 2 * 1024 * 1024 } } });

describe('plugin vault: content addressed by sha256', () => {
  it('canonical JSON is order independent and the address is a real sha256', async () => {
    expect(canonicalJson({ b: [true, null], a: 1 })).toBe('{"a":1,"b":[true,null]}');
    expect(await sha256Hex('{"a":1,"b":[true,null]}')).toBe('1cc69c7fa23616ca2ec3ee70d24390a6225c8832db8a4c814c7e0e7f942f8668');
    expect(await fingerprint({ a: 1, b: [true, null] })).toBe(await fingerprint({ b: [true, null], a: 1 }));
  });

  it('write once, read verified: a blob that no longer matches its address is treated as missing', async () => {
    const store = vaultStore();
    const vault = createPluginVault({ store });
    const sha = await vault.put({ id: 'x', version: 1 });
    expect(await vault.get(sha)).toEqual({ id: 'x', version: 1 });
    // تلف على القرص (أو عبث): نص مختلف تحت البصمة نفسها
    await store.set('vault', `blob:${sha}`, '{"id":"x","version":2}');
    const fresh = createPluginVault({ store });
    expect(await fresh.get(sha)).toBeNull();
    expect(await fresh.get('../../etc/passwd')).toBeNull();
    expect(await fresh.get('a'.repeat(64))).toBeNull();
  });

  it('a returned value is a copy: mutating it cannot change what the vault serves', async () => {
    const vault = createPluginVault({ store: vaultStore() });
    const sha = await vault.put({ id: 'x', config: { a: 1 } });
    const one = await vault.get(sha);
    one.config.a = 666;
    expect((await vault.get(sha)).config.a).toBe(1);
  });

  it('refuses oversize, too deep, prototype-polluting or non-finite data before hashing', async () => {
    const vault = createPluginVault({ store: vaultStore() });
    await expect(vault.put({ big: 'x'.repeat(VAULT_LIMITS.bytes + 1) })).rejects.toMatchObject({ code: 'VAULT_LIMIT' });
    let deep = {};
    const root = deep;
    for (let i = 0; i < 40; i += 1) deep = deep.n = {};
    await expect(vault.put(root)).rejects.toMatchObject({ code: 'VAULT_LIMIT' });
    await expect(vault.put(JSON.parse('{"__proto__":{"polluted":true}}'))).rejects.toMatchObject({ code: 'VAULT_UNSAFE' });
    await expect(vault.put({ n: Infinity })).rejects.toMatchObject({ code: 'VAULT_UNSAFE' });
    await expect(vault.put({ many: Array.from({ length: VAULT_LIMITS.nodes + 1 }, () => 0) })).rejects.toMatchObject({ code: 'VAULT_LIMIT' });
    expect({}.polluted).toBeUndefined();
  });

  it('sweep removes only unreferenced blobs', async () => {
    const vault = createPluginVault({ store: vaultStore() });
    const keep = await vault.put({ v: 1 });
    const drop = await vault.put({ v: 2 });
    expect(await vault.sweep([keep], [keep, drop])).toBe(1);
    expect(await vault.get(keep)).toEqual({ v: 1 });
    expect(await vault.get(drop)).toBeNull();
  });

  it('a failed write is reported, never silently ignored', async () => {
    const vault = createPluginVault({ store: { get: async () => null, set: async () => false } });
    await expect(vault.put({ v: 1 })).rejects.toMatchObject({ code: 'VAULT_WRITE' });
  });
});

describe('version comparison (no downgrade)', () => {
  it('compares integers and semver, pre-release older than release', () => {
    expect(compareVersions(2, 1)).toBeGreaterThan(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('x', '1.0.0')).toBeNull();
  });
});
