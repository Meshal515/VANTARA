import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createUnblockingLookup, isSinkhole, looksLikeSniReset, fragmentingStream, describeNetError, SPLIT_OFFSET } from './net-unblock.mjs';

const R = [{ name: 'A', host: '1.1.1.1', path: '/q' }, { name: 'B', host: '8.8.8.8', path: '/r' }];

test('DoH أولًا: إجابة DoH تُعتمد ولا يُسأل DNS النظام (مثل عميل مشغل الـAPK)', async () => {
  let system = 0;
  const lookup = createUnblockingLookup({ resolvers: R, query: async (_r, _h, type) => type === 'A' ? [{ address: '104.21.1.1', family: 4 }] : [], system: async () => { system++; return []; } });
  assert.deepEqual(await lookup('witanime.site'), [{ address: '104.21.1.1', family: 4 }]);
  assert.equal(system, 0);
});

test('حجب DNS عند المزوّد: إجابة النظام 0.0.0.0 لا تُستعمل، وDoH يعطي العنوان الحقيقي', async () => {
  const lookup = createUnblockingLookup({ resolvers: R, query: async (r, _h, type) => r.name === 'A' ? [{ address: '0.0.0.0', family: 4 }] : type === 'A' ? [{ address: '172.67.1.2', family: 4 }] : [], system: async () => [{ address: '0.0.0.0', family: 4 }] });
  assert.deepEqual(await lookup('torrentio.strem.fun'), [{ address: '172.67.1.2', family: 4 }]);
});

test('DoH محجوب أو معطل: يرجع لـDNS النظام كما كان', async () => {
  const lookup = createUnblockingLookup({ resolvers: R, query: async () => { throw new Error('ECONNRESET'); }, system: async () => [{ address: '93.184.216.34', family: 4 }] });
  assert.deepEqual(await lookup('example.com'), [{ address: '93.184.216.34', family: 4 }]);
});

test('لا DoH ولا نظام: سبب واضح «حجب DNS» بدل «انتهت المهلة»', async () => {
  const lookup = createUnblockingLookup({ resolvers: R, query: async () => [], system: async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); } });
  await assert.rejects(lookup('blocked.example'), error => describeNetError(error) === 'الدومين لا يُحلّ (حجب DNS؟)');
  const sink = createUnblockingLookup({ resolvers: R, query: async () => [], system: async () => [{ address: '127.0.0.1', family: 4 }] });
  await assert.rejects(sink('blocked.example'), /محجوب بالـDNS/);
});

test('IPv6 فقط إن لم يوجد IPv4، والنتيجة تُخزَّن 10 دقائق', async () => {
  let calls = 0, clock = 0;
  const lookup = createUnblockingLookup({ resolvers: R, now: () => clock, query: async (_r, _h, type) => { calls++; return type === 'AAAA' ? [{ address: '2606:4700::1', family: 6 }] : []; }, system: async () => [] });
  assert.deepEqual(await lookup('v6.example'), [{ address: '2606:4700::1', family: 6 }]);
  const first = calls;
  await lookup('V6.example'); assert.equal(calls, first);
  clock = 11 * 60_000; await lookup('v6.example'); assert.ok(calls > first);
});

test('isSinkhole وlooksLikeSniReset: حجب حقيقي فقط، لا أخطاء الشهادة', () => {
  assert.equal(isSinkhole([{ address: '0.0.0.0' }, { address: '10.0.0.1' }]), true);
  assert.equal(isSinkhole([{ address: '10.0.0.1' }, { address: '1.2.3.4' }]), false);
  assert.equal(looksLikeSniReset(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })), true);
  assert.equal(looksLikeSniReset(new Error('Client network socket disconnected before secure TLS connection was established')), true);
  assert.equal(looksLikeSniReset(Object.assign(new Error('bad cert'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })), false);
  assert.equal(describeNetError(Object.assign(new Error('x'), { code: 'ECONNRESET' })), 'قُطع الاتصال الآمن فور المصافحة (حجب؟)');
});

test('التجزئة: أول كتابة (ClientHello) تصل على دفعتين منفصلتين، والباقي كما هو', async () => {
  const reads = [];
  const server = net.createServer(socket => { socket.on('data', chunk => reads.push(chunk.length)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const raw = net.connect(server.address().port, '127.0.0.1');
    raw.setNoDelay(true);
    await new Promise(resolve => raw.once('connect', resolve));
    const stream = fragmentingStream(raw, { gapMs: 40 });
    await new Promise(resolve => stream.write(Buffer.alloc(300, 1), resolve));
    await new Promise(resolve => setTimeout(resolve, 80));
    await new Promise(resolve => stream.write(Buffer.alloc(50, 2), resolve));
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.deepEqual(reads, [SPLIT_OFFSET, 300 - SPLIT_OFFSET, 50]);
    stream.destroy();
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('DoH يُسقَط بصمت: DNS النظام قبل مهلة الطلب (15 ث)، ولا يُعاد سؤال DoH مع كل طلب', async () => {
  const asked = [];
  const silent = (resolver, _host, type, { timeout }) => { asked.push(`${resolver.name}:${type}:${timeout}`); return new Promise((_, reject) => setTimeout(() => reject(new Error(`انتهت مهلة DoH ${resolver.name}`)), 30)); };
  let clock = 0, system = 0;
  const lookup = createUnblockingLookup({ resolvers: R, now: () => clock, dohTimeout: 2500, query: silent, system: async () => { system++; return [{ address: '93.184.216.34', family: 4 }]; } });
  const started = Date.now();
  assert.deepEqual(await lookup('torrentio.strem.fun'), [{ address: '93.184.216.34', family: 4 }]);
  // الخادمان معًا، وA وحده: لا AAAA بعد مهلة (الأسوأ 2.5 ث بدل 16 ث)
  assert.deepEqual(asked.sort(), ['A:A:2500', 'B:A:2500']);
  assert.ok(Date.now() - started < 1000);
  asked.length = 0;
  assert.deepEqual(await lookup('kitsu.io'), [{ address: '93.184.216.34', family: 4 }]);
  assert.deepEqual(asked, [], 'DoH المتعطل لا يُسأل مع كل طلب');
  clock += 5 * 60_000 + 1;
  await lookup('api.example.com');
  assert.equal(asked.length, 2, 'بعد خمس دقائق يُجرَّب DoH من جديد');
  assert.equal(system, 3);
});
