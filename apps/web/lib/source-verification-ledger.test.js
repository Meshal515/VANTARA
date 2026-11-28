import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createSourceVerification } from './source-verification.js';

const host = 'source.example';
const row = { host, token: 'old', state: 'required' };
async function fixture() {
  let pending = async () => ({ pending: [row] });
  const listeners = new Map();
  let launches = 0;
  const verification = createSourceVerification({ plugin: {
    pending: () => pending(),
    addListener: async (name, fn) => { listeners.set(name, fn); return { remove() {} }; },
    begin: async () => { launches++; return { host, state: 'failed', reason: 'network_error' }; },
  }});
  await verification.ready;
  return { verification, listeners, setPending: fn => { pending = fn; }, launches: () => launches };
}

test('a successful empty native snapshot removes a phantom verification before opening it', async () => {
  const f = await fixture();
  try {
    assert.equal(f.verification.list().length, 1);
    f.setPending(async () => ({ pending: [] }));
    const result = await f.verification.beginSource({ host });
    assert.equal(result.ok, false);
    assert.equal(f.launches(), 0, 'must not open a verification absent from the native ledger');
    assert.deepEqual(f.verification.list(), []);
  } finally { f.verification.close(); }
});

test('a stale snapshot cannot resurrect a request discarded during the bridge call', async () => {
  const f = await fixture();
  try {
    let resolve, started;
    const entered = new Promise(r => { started = r; });
    f.setPending(() => new Promise(r => { resolve = r; started(); }));
    const result = f.verification.beginSource({ host });
    await entered;
    f.listeners.get('state')({ ...row, state: 'discarded' });
    resolve({ pending: [row] });
    await result;
    assert.equal(f.launches(), 0, 'discarded requests must not be launched');
    assert.deepEqual(f.verification.list(), []);
  } finally { f.verification.close(); }
});

test('a failed snapshot does not discard the last known pending state', async () => {
  const f = await fixture();
  try {
    f.setPending(async () => { throw new Error('bridge unavailable'); });
    await f.verification.beginSource({ host, isActive: () => false });
    assert.equal(f.verification.list().length, 1);
  } finally { f.verification.close(); }
});

test('a newer bridge event survives an older empty snapshot', async () => {
  const f = await fixture();
  try {
    let resolve, started;
    const entered = new Promise(r => { started = r; });
    f.setPending(() => new Promise(r => { resolve = r; started(); }));
    const result = f.verification.beginSource({ host, isActive: () => false });
    await entered;
    f.listeners.get('required')({ ...row, token: 'new' });
    resolve({ pending: [] });
    await result;
    assert.equal(f.verification.list()[0]?.token, 'new');
  } finally { f.verification.close(); }
});
