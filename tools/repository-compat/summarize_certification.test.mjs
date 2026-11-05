import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, table, verdict, site } from './summarize_certification.mjs';

test('جدول الاعتماد: التغطية والاحتياط وصدق «جاهز» لكل مصدر', () => {
  const lines = [
    'noise',
    JSON.stringify({ type: 'work', name: 'AnimeRift', tier: 'popular', plays: 1, ready: 2 }),
    JSON.stringify({ type: 'source', kind: 'cs3', name: 'AnimeRift', content: 'anime', tiers: { popular: { found: 10, playable: 10 }, mid: { found: 10, playable: 9 }, obscure: { found: 10, playable: 9 } }, worksTested: 30, worksPlayable: 28, worksWithBackup: 20, serversOpened: 70, falseReady: 0, falseReadyCodes: [], ttffMedianMs: 2400, decodedFrames: 9000, droppedFrames: 40 }),
    JSON.stringify({ type: 'source', kind: 'aniyomi', name: 'witanime', content: 'anime', tiers: { popular: { found: 10, playable: 8 } }, worksTested: 30, worksPlayable: 20, worksWithBackup: 5, serversOpened: 40, falseReady: 3, falseReadyCodes: ['NO_FIRST_FRAME×3'], ttffMedianMs: 5000 }),
    JSON.stringify({ type: 'source', kind: 'cs3', name: 'Brstej', code: 'PLUGIN_NOT_IN_REPOSITORY' }),
  ].join('\n');
  const records = parse(lines);
  assert.equal(records.length, 4);
  const md = table(records);
  assert.match(md, /\| AnimeRift \| cs3\/anime \| معتمد \| 10\/10 \| 9\/10 \| 9\/10 \| 20\/30 \| 70 \| 0 \| 2\.4 ث \| 9000\/40 \|/);
  assert.match(md, /witanime .*جاهز يكذب.*NO_FIRST_FRAME×3/);
  assert.equal(verdict({ code: 'X' }), 'لم يكتمل: X');
  assert.equal(verdict({ worksTested: 30, worksPlayable: 20, worksWithBackup: 0, falseReady: 0 }), 'يعمل جزئيًا');
});

test('سبب الكتالوج الفارغ ومرحلة الفشل يظهران في الحكم: الموقع المنتقل لا يُحسب عطل محرك', () => {
  assert.equal(verdict({ code: 'OPERATION_TIMEOUT', stage: 'install' }), 'لم يكتمل: OPERATION_TIMEOUT عند التثبيت');
  const moved = { worksTested: 0, siteHost: 'old.example', siteMovedTo: 'new.example', catalogueErrors: ['popular#1:EMPTY_PAGE'] };
  assert.equal(site(moved), 'الموقع انتقل إلى new.example');
  assert.equal(verdict(moved), 'لا أعمال في الكتالوج (الموقع انتقل إلى new.example؛ popular#1:EMPTY_PAGE)');
  assert.equal(verdict({ worksTested: 0 }), 'لا أعمال في الكتالوج');
  assert.equal(site({ siteStatus: 403, siteChallenge: 'cloudflare' }), 'الموقع يطلب تحقق Cloudflare');
});
