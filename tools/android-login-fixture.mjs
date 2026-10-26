/** Local-only Android release-login fixture. Never deploy or point it at D1. */
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import worker, { hashDeviceSecret } from '../services/sync-worker/src/secure-index.ts';
import { sqliteEnv } from '../services/sync-worker/src/test-d1.ts';
import { createAccount, pinOf, updatePin } from '../services/sync-worker/src/accounts.ts';

const PORT = Number(process.env.ANDROID_LOGIN_FIXTURE_PORT || 8765);
const OUT = process.env.ANDROID_LOGIN_FIXTURE_PROOF;
const { env, db } = sqliteEnv({
  VANTARA_SESSION_SECRET: 'release-login-fixture-session-secret-only-20261026',
  VANTARA_IDENTITY_SECRET: 'release-login-fixture-identity-secret-only-20261026',
  VANTARA_DEVICE_PEPPER: 'release-login-fixture-pepper-only-20261026',
});
const created = await createAccount(env, Date.now(), {
  username: 'release_fixture', displayName: 'Release Test', avatarKey: null,
});
if (!created.ok) throw new Error('Could not create isolated fixture account');
const userId = created.account.userId;
const queuedOp = 'release-login-queued-fixture-op';
const counts = { sessions200: 0, pinWrong401: 0, untrusted401: 0, sync200: 0, ops200: 0 };
const events = [];
const reply = (res, status, value) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': 'https://localhost',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
  });
  res.end(JSON.stringify(value));
};
function proof() {
  return {
    isolatedFixture: true, counts, events: events.slice(-80),
    accountStillActive: db.prepare('SELECT lifecycle FROM accounts WHERE user_id=?').get(userId)?.lifecycle === 'ACTIVE',
    trustedDevices: Number(db.prepare('SELECT COUNT(*) n FROM trusted_devices WHERE user_id=? AND revoked_at IS NULL').get(userId)?.n || 0),
    queuedOpAppliedExactlyOnce: Number(db.prepare('SELECT COUNT(*) n FROM applied_ops WHERE op_id=? AND user_id=?').get(queuedOp, userId)?.n || 0) === 1,
  };
}
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const path = new URL(req.url, `http://localhost:${PORT}`).pathname;
    if (req.method === 'OPTIONS' && path.startsWith('/__fixture/')) return reply(res, 204, null);
    if (path === '/__fixture/info') return reply(res, 200, { userId, queuedOp, pinDigits: 4 });
    if (path === '/__fixture/proof') return reply(res, 200, proof());
    if (path === '/__fixture/trust' && req.method === 'POST') {
      const input = JSON.parse(body);
      if (!/^android:[0-9a-f]{16}$/.test(input.deviceId || '') || typeof input.deviceCredential !== 'string' || input.deviceCredential.length < 16) {
        return reply(res, 400, { error: 'fixture_requires_real_android_proof' });
      }
      const hash = await hashDeviceSecret(input.deviceCredential, env.VANTARA_DEVICE_PEPPER);
      const old = db.prepare('SELECT credential_hash FROM trusted_devices WHERE device_id=? AND user_id=?').get(input.deviceId, userId);
      if (old && old.credential_hash !== hash) return reply(res, 409, { error: 'fixture_identity_changed' });
      db.prepare('INSERT OR IGNORE INTO trusted_devices(device_id,user_id,credential_hash,created_at,last_used_at) VALUES(?,?,?,?,?)')
        .run(input.deviceId, userId, hash, Date.now(), Date.now());
      if (!(await pinOf(env, userId))) {
        const pin = await updatePin(env, Date.now(), userId, input.deviceId, { action: 'set', pin: '2580' });
        if (!pin.ok) throw new Error('Could not protect fixture account');
      }
      return reply(res, 200, { trusted: true });
    }
    const request = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method, headers: req.headers,
      ...((req.method !== 'GET' && req.method !== 'HEAD') ? { body } : {}),
    });
    const response = await worker.fetch(request, env, { waitUntil: (p) => void p.catch(() => {}) });
    let error = null;
    if (path === '/v1/session') {
      const decoded = await response.clone().json().catch(() => ({}));
      error = decoded.error || null;
      if (response.status === 200) counts.sessions200++;
      if (response.status === 401 && error === 'pin_wrong') counts.pinWrong401++;
      if (response.status === 401 && error === 'device_untrusted') counts.untrusted401++;
    }
    if (path === '/v1/sync' && response.status === 200) counts.sync200++;
    if (path === '/v1/ops' && response.status === 200) counts.ops200++;
    events.push({ path, method: req.method, status: response.status, ...(error ? { error } : {}) });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    if (OUT) writeFileSync(OUT, JSON.stringify(proof(), null, 2));
  } catch (error) {
    console.error('fixture failure:', error?.name || 'Error');
    reply(res, 500, { error: 'fixture_failure' });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Android login fixture listening on loopback:${PORT}`));
