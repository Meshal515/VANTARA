import { expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { VALIDITY, bestRoute, failureText, scoreRoute, validity } from './route-validity.js';
import { createServerSheet, describe as describeRoute } from '../v35/server-sheet.js';

const TORR = 'addon|https://torrentio.strem.fun|torrentio';
const tor = (label, extra = {}) => ({ id: label, sourceId: TORR, sourceName: 'Torrentio', state: 'READY', runtimeReady: true, quality: 1080, label, ...extra });

it('ثلاث حالات فقط: صالح بدليل، قيد الفحص بلا حكم، غير متاح بسبب عربي صادق', () => {
  expect(validity({ state: 'READY', probed: true }).state).toBe(VALIDITY.VALID);
  expect(validity({ state: 'READY' }).state).toBe(VALIDITY.CHECKING);
  expect(validity({ state: 'RESOLVING' }).state).toBe(VALIDITY.CHECKING);
  expect(validity({ state: 'READY', probed: false, reason: 'HTTP 503' })).toEqual({ state: VALIDITY.UNAVAILABLE, reason: 'موقع المصدر متعطل الآن (الخلل من الموقع نفسه)' });
  expect(validity(tor('A.1080p\n👤 40')).state).toBe(VALIDITY.VALID);
  expect(validity(tor('A.1080p\n👤 0')).state).toBe(VALIDITY.UNAVAILABLE);
  // بلا عدد معلن: لا دليل أنه يعمل ولا أنه ميت
  expect(validity(tor('A.1080p')).state).toBe(VALIDITY.CHECKING);
  expect(validity(tor('A.1080p\n👤 40', { runtimeReady: false })).state).toBe(VALIDITY.UNAVAILABLE);
  expect(validity({ state: 'READY', probed: true, expiresAt: 1000 }, { now: 2000 }).state).toBe(VALIDITY.UNAVAILABLE);
  expect(failureText('weird english error')).toBe('لم ينجح فحص رابط الفيديو');
});

it('«شغّل الأفضل» من الصالح وحده، وتورنت يدعم العربية يغلب الأكثر مشاركين', () => {
  globalThis.localStorage?.clear?.();
  const many = tor('A.1080p.WEB.x264\n👤 1000 💾 1.4 GB');
  const ar = tor('B.1080p.WEB.x264 Arabic\n👤 60 💾 1.4 GB\n🇸🇦');
  const unknown = tor('C.1080p.WEB.x264 Arabic');
  expect(scoreRoute(unknown, describeRoute(unknown)).score).toBe(-Infinity);
  expect(bestRoute([many, ar, unknown], (r) => describeRoute(r))).toBe(ar);
  expect(bestRoute([unknown, { id: 'x', state: 'READY' }], (r) => describeRoute(r))).toBeNull();
});

it('الورقة: «قيد الفحص» الجاهز يُلمس فيُجرَّب، لكن «شغّل الأفضل» لا يقترحه', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const body = el('div');
  const onPick = vi.fn();
  const ui = createServerSheet(body, { el, title: 'عمل', onPick });
  ui.update({ routes: [{ id: 'u', sourceId: 'owned', server: 'https://cdn.example/v.mp4', quality: 1080, state: 'READY', candidates: ['c'] }], settled: true, status: { text: '' } });
  expect(body.querySelector('.an-pick-best').disabled).toBe(true);
  const row = body.querySelector('.ss-row');
  expect(row.disabled).toBe(false);
  expect(row.textContent).toContain('قيد الفحص');
  row.onclick();
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'u' }));
});
