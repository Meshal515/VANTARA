import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createSourceVerification } from './source-verification.js';
const host = 'source.example';
async function fixture() {
  const listeners = new Map();
  const verification = createSourceVerification({ plugin: {
    pending: async () => ({ pending: [] }),
    addListener: async (name, fn) => { listeners.set(name, fn); return { remove() {} }; },
    begin: async () => ({ host, state: 'verified' }),
  } });
  await verification.ready;
  return { verification, listeners };
}
test('successful catalog replay is not replaced by unrelated pending event', async () => {
  const { verification: v, listeners } = await fixture();
  try {
    v.require({ host, token: 'original', state: 'required', sourceId: 'catalog', retry: async () => {
      listeners.get('required')({ host, token: 'other', state: 'required', sourceId: 'other' });
      return { ok: true };
    } });
    assert.deepEqual(await v.begin(host), { ok: true });
    assert.equal(v.list()[0]?.token, 'other');
    assert.equal(v.list()[0]?.sourceId, 'other');
  } finally { v.close(); }
});
test('failed replay with explicit challenge stays failed', async () => {
  const { verification: v, listeners } = await fixture();
  try {
    v.require({ host, token: 'original', state: 'required', retry: async () => {
      listeners.get('required')({ host, token: 'next', state: 'required' });
      return { ok: false, needsHuman: true };
    } });
    assert.equal((await v.begin(host)).reason, 'still_challenged');
  } finally { v.close(); }
});
test('successful flag with explicit needsHuman is never treated as accepted', async () => {
  const { verification: v } = await fixture();
  try {
    v.require({ host, token: 'original', state: 'required', retry: async () => ({ ok: true, needsHuman: true }) });
    assert.equal((await v.begin(host)).reason, 'still_challenged');
  } finally { v.close(); }
});
