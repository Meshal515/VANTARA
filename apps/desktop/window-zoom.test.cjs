'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { fitZoom, attachWindowZoom } = require('./window-zoom.cjs');

test('1366 وما دون ~1480 بلا تكبير؛ 1920 و2560 تكبر بتناسب عرضها بحد 1.6', () => {
  assert.equal(fitZoom(1366), 1);
  assert.equal(fitZoom(1440), 1);
  assert.equal(fitZoom(1920), 1.3);
  assert.equal(fitZoom(2560), 1.6);
  assert.equal(fitZoom(3840), 1.6);
  assert.equal(fitZoom(NaN), 1);
});
test('تكبير المستخدم يُضرب فوق التلقائي وله حدود', () => {
  assert.equal(fitZoom(1920, 1.1), 1.43);
  assert.equal(fitZoom(1366, 5), 2);
  assert.equal(fitZoom(1366, 0.1), 0.5);
});
test('يُطبّق عند تغيّر الحجم وعلى النوافذ التابعة، وCtrl+العجلة نسبي ولا يلغي التلقائي', () => {
  const contents = Object.assign(new EventEmitter(), { factor: null, setZoomFactor(f) { this.factor = f; } });
  const child = { isDestroyed: () => false, webContents: { factor: null, setZoomFactor(f) { this.factor = f; } } };
  let size = [1366, 768];
  const win = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false, getContentSize: () => size });
  const z = attachWindowZoom(win, { also: () => [child] });
  assert.equal(contents.factor, 1);
  size = [1920, 1080]; win.emit('resize');
  assert.equal(contents.factor, 1.3); assert.equal(child.webContents.factor, 1.3);
  contents.emit('zoom-changed', {}, 'in');
  assert.equal(contents.factor, 1.43);
  z.reset(); assert.equal(contents.factor, 1.3);
  size = [1280, 720]; win.emit('leave-full-screen');
  assert.equal(contents.factor, 1);
});
