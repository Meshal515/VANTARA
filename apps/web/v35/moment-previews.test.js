import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createMomentPreviews } from './moment-media.js';

let observer, previews, videos, fetcher;
const row = { id: 'preview', series_ref: 'anime:1', chapter_label: 'الحلقة 3 · 0:10–0:30', cover_url: 'https://image.example/poster.jpg' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
  const { document } = parseHTML('<html><head></head><body><span id="shot"></span></body></html>');
  vi.stubGlobal('document', document); videos = [];
  vi.stubGlobal('navigator', { connection: { saveData: false } });
  fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { observer = { callback, targets: new Set() }; }
    observe(target) { observer.targets.add(target); }
    disconnect() { observer.targets.clear(); }
  });
  const create = document.createElement.bind(document);
  document.createElement = (name) => {
    const element = create(name);
    if (name === 'video') { element.play = vi.fn(); element.pause = vi.fn(); element.load = vi.fn(); videos.push(element); }
    return element;
  };
});
afterEach(() => { previews?.destroy(); vi.unstubAllGlobals(); });
it('resolves only visible cards, requests one frame at the shared start and never plays or downloads the movie', async () => {
  const resolveSources = vi.fn(async () => [{ url: 'https://source.example/movie.mp4' }]);
  previews = createMomentPreviews({ resolveSources });
  const shot = document.querySelector('#shot'); previews.mount(shot, row);
  expect(resolveSources).not.toHaveBeenCalled(); expect(videos).toHaveLength(0);
  observer.callback([{ target: shot, isIntersecting: true }]); await tick();
  expect(resolveSources).toHaveBeenCalledTimes(1); expect(videos).toHaveLength(1);
  expect(videos[0].preload).toBe('metadata');
  videos[0].onloadedmetadata(); expect(videos[0].currentTime).toBe(10);
  expect(videos[0].play).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  previews.reset(); expect(videos[0].pause).toHaveBeenCalled(); expect(observer.targets.size).toBe(0);
});
it('honors data saver and leaves lazy source preparation for an explicit play', async () => {
  navigator.connection.saveData = true;
  const resolveSources = vi.fn(async () => []);
  previews = createMomentPreviews({ resolveSources });
  const shot = document.querySelector('#shot'); previews.mount(shot, row);
  observer.callback([{ target: shot, isIntersecting: true }]); await tick();
  expect(resolveSources).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
