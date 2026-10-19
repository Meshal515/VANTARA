import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { openMomentViewer } from './moment-viewer.js';

const row = { id: 'clip1', series_ref: 'cinema:movie:1', series_title: 'Test', moment_json: JSON.stringify({ version: 1, startMs: 10000, endMs: 30000, episode: 3 }) };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let viewer;
beforeEach(() => {
  const { window, document } = parseHTML('<html><head></head><body><button id="origin">Moment</button></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('location', { href: 'https://app.example/' });
  const create = document.createElement.bind(document);
  document.createElement = (name) => {
    const node = create(name);
    if (name === 'video') { node.play = vi.fn(async () => {}); node.pause = vi.fn(); node.load = vi.fn(); node.canPlayType = () => ''; node.currentTime = 0; }
    return node;
  };
});
afterEach(() => { viewer?.destroy(); vi.unstubAllGlobals(); });
describe('moment miniplayer', () => {
  it('plays a prepared source at the episode range, stops at the end and exposes four actions', async () => {
    const prepare = vi.fn(async () => ({ url: 'https://source.example/movie.mp4' }));
    const episode = vi.fn(), work = vi.fn();
    viewer = openMomentViewer({ row, resolveSources: async () => [{ prepare }], onEpisode: episode, onWork: work });
    await tick();
    const video = document.querySelector('video');
    expect(prepare).toHaveBeenCalledTimes(1);
    video.dispatchEvent(new window.Event('loadedmetadata'));
    expect(video.currentTime).toBe(10);
    video.currentTime = 30.1; video.dispatchEvent(new window.Event('timeupdate'));
    expect(video.pause).toHaveBeenCalled();
    expect(document.querySelector('.mv-end').hidden).toBe(false);
    expect([...document.querySelectorAll('.mv-end button')].map((b) => b.textContent)).toEqual(['شاهد الحلقة', 'انتقل إلى العمل', 'أعد تشغيل اللقطة', 'حفظ في الصور']);
    document.querySelector('[data-action="episode"]').click(); expect(episode).toHaveBeenCalled();
    expect(document.querySelector('.mv-viewer')).toBeNull();
  });
  it('exports only the selected range and uses the returned local clip for codec fallback', async () => {
    const saveVideo = vi.fn(async () => ({ url: 'blob:local-clip', clipped: true }));
    viewer = openMomentViewer({ row, resolveSources: async () => [{ url: 'https://source.example/movie.mkv' }], saveVideo });
    await tick();
    const video = document.querySelector('video');
    video.dispatchEvent(new window.Event('error')); await tick();
    expect(document.querySelector('.mv-status').textContent).toContain('حفظ');
    document.querySelector('[data-action="save"]').click(); await tick();
    expect(saveVideo.mock.calls[0][0]).toMatchObject({ row, startMs: 10000, endMs: 30000 });
    expect(video.src).toBe('blob:local-clip');
    video.dispatchEvent(new window.Event('loadedmetadata')); expect(video.currentTime).toBe(0);
  });
  it('falls back to another source without closing Majlis and cleans up on back', async () => {
    viewer = openMomentViewer({ row, resolveSources: async () => [{ url: 'https://source.example/bad.mp4' }, { url: 'https://source.example/good.mp4' }] });
    await tick(); const video = document.querySelector('video');
    video.dispatchEvent(new window.Event('error')); await tick();
    expect(video.src).toBe('https://source.example/good.mp4');
    expect(viewer.handleBack()).toBe(true);
    expect(document.querySelector('.mv-viewer')).toBeNull(); expect(video.pause).toHaveBeenCalled();
    expect(viewer.handleBack()).toBe(false);
  });
  it('still plays attached public sources when device provider discovery fails', async () => {
    const attached = { ...row, moment_json: JSON.stringify({ version: 1, startMs: 10000, endMs: 30000, sources: [{ url: 'https://source.example/attached.mp4' }] }) };
    viewer = openMomentViewer({ row: attached, resolveSources: async () => { throw new Error('Device offline'); } });
    await tick();
    expect(document.querySelector('video').src).toBe('https://source.example/attached.mp4');
  });
});
