import { describe, expect, it, vi } from 'vitest';
import { createPhoneNotify, notificationLinkTarget, phoneWanted } from './phone-notify.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};
const plugin = () => ({
  configured: false,
  configure: vi.fn(async function () { this.configured = true; return { permission: true }; }),
  clear: vi.fn(async function () { this.configured = false; }),
  status: vi.fn(async function () { return { configured: this.configured }; }),
  checkNow: vi.fn(async () => {}),
});

describe('phone notifications wiring', () => {
  it('asks the server for a device token once, hands it to Android, and never stores it in the web layer', async () => {
    const p = plugin();
    const storage = memory();
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ token: 'vn_secret' }) }));
    const phone = createPhoneNotify({ plugin: p, endpoint: 'https://sync.test', authHeader: () => 'Bearer s', fetchImpl, storage });
    expect(await phone.ensure('u1', true)).toBe(true);
    expect(p.configure).toHaveBeenCalledWith({ endpoint: 'https://sync.test', token: 'vn_secret' });
    expect(storage.getItem('vantara.phoneNotify.v1')).not.toContain('vn_secret');
    await phone.ensure('u1', true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('switching account or turning it off revokes the old device', async () => {
    const p = plugin();
    const storage = memory();
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ token: 'vn_x' }) }));
    const phone = createPhoneNotify({ plugin: p, endpoint: 'https://sync.test', authHeader: () => 'Bearer s', fetchImpl, storage });
    await phone.ensure('u1', true);
    await phone.ensure('u2', true);
    expect(p.clear).toHaveBeenCalledTimes(1);
    await phone.ensure('u2', false);
    expect(p.clear).toHaveBeenCalledTimes(2);
    expect(storage.getItem('vantara.phoneNotify.v1')).toBeNull();
  });

  it('is inert outside Android', async () => {
    const phone = createPhoneNotify({ plugin: null, endpoint: 'https://sync.test', authHeader: () => 'Bearer s', fetchImpl: vi.fn() });
    expect(phone.native).toBe(false);
    expect(await phone.ensure('u1', true)).toBe(false);
  });

  it('phone notifications are on unless explicitly turned off', () => {
    expect(phoneWanted(null)).toBe(true);
    expect(phoneWanted({ data: '{"notifications":{"phone":false}}' })).toBe(false);
  });

  it('a tapped notification opens the right place and names the notification to mark read', () => {
    expect(notificationLinkTarget('vantara://series/ext%3Asolo%20leveling?n=unit%3Ax')).toEqual({ read: 'unit:x', open: { name: 'series', ref: 'ext:solo leveling' } });
    expect(notificationLinkTarget('vantara://majlis/msg/op-1?n=msg%3Aa%3Ab').open).toEqual({ name: 'majlis' });
    expect(notificationLinkTarget('vantara://series/anime%3A1?n=t1#together=ABC123').open).toEqual({ name: 'together', code: 'ABC123' });
    expect(notificationLinkTarget('vantara://pair?pair=abc')).toBeNull();
    expect(notificationLinkTarget('https://evil.test')).toBeNull();
  });
});
