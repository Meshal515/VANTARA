/**
 * قرار المالك (16 نوفمبر): العمل المحذوف يُشال من كل شيء فورًا وبسلاسة، ولا يبقى إلا في الأرشيف.
 * حارس واحد على جذر التطبيق بدل فلتر في كل شاشة (تدقيق #349: DL1–DL10).
 */
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installRemovedGate, removeWorkEverywhere, removedChanged, restoreRemovedWork, setRemovedSource, tagWork, workToken } from './removed-works.js';

let document, root, dispose, rows;
const mem = new Map();
const card = (cls, ...keys) => tagWork(Object.assign(document.createElement('div'), { className: cls }), ...keys);
const visible = (n) => !n.hidden && n.style.display !== 'none';
beforeEach(() => {
  ({ document } = parseHTML('<html><body><div class="v35"></div></body></html>'));
  root = document.querySelector('.v35');
  mem.clear();
  vi.stubGlobal('localStorage', { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) });
  vi.stubGlobal('MutationObserver', document.defaultView.MutationObserver);
  rows = [];
  setRemovedSource(() => rows);
  dispose = installRemovedGate(root);
});
afterEach(() => { dispose(); vi.unstubAllGlobals(); });
const flush = () => new Promise((r) => setTimeout(r, 0));

it('deleting hides the work at once on every surface (home, top 5, history, updates), before the server answers', () => {
  const home = card('work-card', 'ext:solo');
  const top = card('an-card', 'ext:solo', 'teamx/solo');
  const history = card('pf-now', 'teamx/solo');
  const other = card('work-card', 'ext:other');
  root.append(home, top, history, other);
  const sync = { enqueue: vi.fn() };
  expect(removeWorkEverywhere(sync, { key: 'ext:solo', kind: 'manga', keys: ['teamx/solo'] })).toBe(true);
  expect([home, top, history].map(visible)).toEqual([false, false, false]);
  expect(visible(other)).toBe(true);
});

it('a card drawn later anywhere (search, latest updates, a reopened page) never shows a removed work', async () => {
  rows = [{ token: workToken('anime:21'), active: 1 }];
  const late = document.createElement('section');
  late.append(card('an-card', 'anime:21'), card('an-card', 'anime:22'));
  root.append(late);
  await flush();
  const [gone, kept] = late.children;
  expect(visible(gone)).toBe(false);
  expect(visible(kept)).toBe(true);
});

it('the archive alone still lists it, and a restore brings the cards back everywhere', async () => {
  const sync = { enqueue: vi.fn() };
  const archive = document.createElement('div');
  archive.dataset.archive = '';
  const inArchive = card('hidden-work', 'cinema:tt1');
  archive.append(inArchive);
  const poster = card('cn-poster', 'cinema:tt1');
  root.append(archive, poster);
  removeWorkEverywhere(sync, { key: 'cinema:tt1', kind: 'cinema' });
  expect(visible(poster)).toBe(false);
  expect(visible(inArchive)).toBe(true);
  restoreRemovedWork(sync, 'cinema:tt1');
  expect(visible(poster)).toBe(true);
});

it('a removal synced from another device (friends) hides what is already on screen', () => {
  const shown = card('up-card', 'ext:x');
  root.append(shown);
  expect(visible(shown)).toBe(true);
  rows = [{ token: workToken('ext:x'), active: 1 }];
  removedChanged();
  expect(visible(shown)).toBe(false);
});

// DL5: الأصدقاء والمجلس ورفيق كانت ترسم بطاقات أعمال بلا مفاتيحها، فلا يراها الحارس ويظهر فيها العمل المحذوف
it('DL5: friends, majlis and rafiq tag every work they draw for the one removal gate', async () => {
  const { readFileSync } = await import('node:fs');
  for (const [file, min] of [['../v35/friends.js', 2], ['../v35/majlis.js', 3], ['../v35/rafiq.js', 1]]) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect([file, (src.match(/\btagWork\(/g) ?? []).length >= min]).toEqual([file, true]);
  }
});
