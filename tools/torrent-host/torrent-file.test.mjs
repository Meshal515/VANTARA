import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { torrentFacts } from './torrent-file.mjs';

// ملف مصغّر يُبنى بمرمّز bencode صغير (لا أطوال يدوية): البصمة = SHA-1 لبايتات قاموس info كما هي
const enc = (v) => typeof v === 'number' ? `i${v}e` : typeof v === 'string' ? `${Buffer.byteLength(v, 'latin1')}:${v}`
  : Array.isArray(v) ? `l${v.map(enc).join('')}e` : `d${Object.keys(v).sort().map((k) => enc(k) + enc(v[k])).join('')}e`;
test('torrentFacts: infohash من بايتات info الأصلية، والاسم والمتتبعات', () => {
  const info = { length: 12, name: 'clip.mkv', 'piece length': 16384, pieces: 'a'.repeat(20) };
  const buf = Buffer.from(enc({ announce: 'https://t.example/a', 'announce-list': [['https://t.example/a'], ['udp://t.example:80']], info }), 'latin1');
  const facts = torrentFacts(buf);
  assert.equal(facts.infoHash, createHash('sha1').update(Buffer.from(enc(info), 'latin1')).digest('hex'));
  assert.equal(facts.name, 'clip.mkv');
  assert.deepEqual(facts.trackers, ['https://t.example/a', 'udp://t.example:80']);
});
test('torrentFacts يرفض ملفًا بلا info', () => {
  assert.throws(() => torrentFacts(Buffer.from('d8:announce3:abce', 'latin1')), /no info/);
});
test('torrentFacts يرفض ملفًا تالفًا بخطأ واضح بلا حلقة لا تنتهي', () => {
  for (const bad of ['d4:info', 'd4:infod4:name', 'l', 'd3:abc', 'di1e1:ae', 'd4:info99:x']) assert.throws(() => torrentFacts(Buffer.from(bad, 'latin1')), /bencode|no info/, bad);
});
