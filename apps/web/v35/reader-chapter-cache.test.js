import { describe, expect, it, vi } from 'vitest';

const rowOf = (path) => ({
  sourceId: 'madara.test',
  manga: { url: path, title: path },
  chapter: { url: 'chapter-1', name: 'الفصل 1', memo: JSON.stringify({ mangaPath: path }) },
});

async function warmDifferentWorks() {
  vi.resetModules();
  const { warmChapter } = await import('./reader.js');
  const engine = {
    pages: vi.fn(async (_sourceId, chapter) => {
      const { mangaPath } = JSON.parse(chapter.memo);
      return [{ index: 0, url: `https://source.test${mangaPath}chapter-1/`, imageUrl: `https://images.test${mangaPath}1.jpg` }];
    }),
    pageImage: vi.fn(async (_sourceId, page) => ({ src: page.imageUrl })),
  };
  warmChapter(engine, rowOf('/manga/cursed-spirits/'), 1);
  await vi.waitFor(() => expect(engine.pageImage).toHaveBeenCalledTimes(1));
  warmChapter(engine, rowOf('/manga/emperor-sword/'), 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  return engine;
}

describe('reader chapter identity across manga', () => {
  it('loads separate page lists for identical chapter slugs under different manga paths', async () => {
    const engine = await warmDifferentWorks();
    expect(engine.pages).toHaveBeenCalledTimes(2);
    expect(engine.pages.mock.calls.map(([, chapter]) => JSON.parse(chapter.memo).mangaPath)).toEqual(['/manga/cursed-spirits/', '/manga/emperor-sword/']);
  });

  it('does not reuse the previous manga first image when opening another chapter-1', async () => {
    const engine = await warmDifferentWorks();
    expect(engine.pageImage.mock.calls.map(([, page]) => page.imageUrl)).toEqual([
      'https://images.test/manga/cursed-spirits/1.jpg',
      'https://images.test/manga/emperor-sword/1.jpg',
    ]);
  });

  it('still reuses the cached pages and image when returning to the same manga chapter', async () => {
    const engine = await warmDifferentWorks();
    const { warmChapter } = await import('./reader.js');
    warmChapter(engine, rowOf('/manga/cursed-spirits/'), 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(engine.pages).toHaveBeenCalledTimes(2);
    expect(engine.pageImage).toHaveBeenCalledTimes(2);
  });
});
