import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { momentComposeRange, openMomentComposer, publicMomentHints } from './moment-compose.js';
let composer;
beforeEach(() => { const { document, window } = parseHTML('<html><head></head><body></body></html>'); vi.stubGlobal('document', document); vi.stubGlobal('window', window); });
afterEach(() => { composer?.destroy(); vi.unstubAllGlobals(); });
const options = { positionMs: 120000, durationMs: 600000, episode: 3, work: { ref: 'anime:1', title: 'عمل', cover: 'https://image.example/cover.jpg' }, friends: [{ userId: 'a', displayName: 'أحمد', avatarKey: 'https://image.example/a.jpg' }, { userId: 'b', displayName: 'بدر' }] };
describe('shared moment composer', () => {
  it('bounds the editable window to 35 seconds on either side and to finite media duration', () => {
    expect(momentComposeRange(120000, 600000)).toEqual({ startMs: 85000, endMs: 155000 });
    expect(momentComposeRange(1000, 10000)).toEqual({ startMs: 0, endMs: 10000 });
    expect(momentComposeRange(599000, 600000)).toEqual({ startMs: 564000, endMs: 600000 });
    expect(momentComposeRange(1, Infinity)).toBeNull();
  });
  it('sends selected recipients, a bounded source-backed range and no media bytes', async () => {
    const onSend = vi.fn(); composer = openMomentComposer({ ...options, onSend, sourceHints: [{ url: 'https://source.example/movie.mp4', headers: { Cookie: 'private' }, session: 'private', server: 's' }] });
    document.querySelector('[data-recipient="a"]').click();
    const from = document.querySelector('[data-bound="start"]'); from.value = '90000'; from.dispatchEvent(new window.Event('input'));
    document.querySelector('[data-compose-action="send"]').click(); await Promise.resolve();
    expect(onSend.mock.calls[0][0]).toMatchObject({ startMs: 90000, endMs: 155000, toIds: ['a'], broadcast: false, moment: { version: 1, episode: 3, startMs: 90000, endMs: 155000, sources: [{ url: 'https://source.example/movie.mp4', server: 's' }] } });
    expect(onSend.mock.calls[0][0].moment).not.toHaveProperty('mediaKey');
    expect(document.querySelector('.moment-compose')).toBeNull();
  });
  it('shares one selected range across preview, save and external share and cleans up on back', async () => {
    const onPreview = vi.fn(), onSave = vi.fn(), onShare = vi.fn(), onClose = vi.fn();
    composer = openMomentComposer({ ...options, onPreview, onSave, onShare, onClose });
    for (const action of ['preview', 'save', 'share']) { document.querySelector(`[data-compose-action="${action}"]`).click(); await Promise.resolve(); await Promise.resolve(); }
    for (const callback of [onPreview, onSave, onShare]) expect(callback.mock.calls[0][0]).toMatchObject({ startMs: 85000, endMs: 155000, episode: 3 });
    expect(document.querySelector('.recipient-stack')).toBeTruthy(); expect(document.querySelector('.recipient-face img')?.src).toContain('image.example/a.jpg');
    expect(composer.handleBack()).toBe(true); expect(composer.handleBack()).toBe(false); expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('strips private addresses, request headers and local engine handles from transmitted source hints', () => {
    expect(publicMomentHints([{ url: 'http://127.0.0.1:8080/proxy', sourceId: 'torrent', session: 'local' }, { url: 'https://user:secret@source.example/movie', headers: { Cookie: 'secret' } }, { url: 'https://source.example/movie.mp4', headers: { Cookie: 'secret' }, exportHandle: 'local' }])).toEqual([{ sourceId: 'torrent' }, { url: 'https://source.example/movie.mp4' }]);
  });
  it('limits transmitted hints to the backend contract and preserves movie episode null', async () => {
    expect(publicMomentHints(Array.from({ length: 12 }, (_, i) => ({ sourceId: `source${i}` })))).toHaveLength(8);
    const onSend = vi.fn(); composer = openMomentComposer({ ...options, episode: null, onSend });
    document.querySelector('[data-compose-action="send"]').click(); await Promise.resolve();
    expect(onSend.mock.calls[0][0].moment.episode).toBeNull();
  });
});

it('reports the actual Windows clipboard file handoff status', async () => {
  composer = openMomentComposer({ ...options, onShare: async () => ({message:'حُفظ ونسخ الملف للمشاركة'}) });
  document.querySelector('[data-compose-action="share"]').click(); await Promise.resolve(); await Promise.resolve();
  expect(document.querySelector('.mco-status').textContent).toBe('حُفظ ونسخ الملف للمشاركة');
});
