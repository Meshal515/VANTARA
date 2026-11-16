/** بلاغ المالك (16 نوفمبر): أغلفة «آخر التحديثات» حروف. غلاف الحدث يُنسب لمصدره هو، لا لكل نسخ العمل. */
import { expect, it } from 'vitest';
import { groupEvents } from './updates-view.js';
import { withUpdateSources } from './works.js';

it('the event cover belongs to the source that published it, so it is fetched with that source headers', () => {
  const [g] = groupEvents([
    { id: 'e2', section: 'manga', work: 'ext:w', title: 'W', number: 12, at: 2, cover: 'https://cdn.b.example/w.jpg', sources: [{ s: 'src.b', u: '/w' }] },
    { id: 'e1', section: 'manga', work: 'ext:w', title: 'W', number: 11, at: 1, cover: 'https://cdn.a.example/w.jpg', sources: [{ s: 'src.a', u: '/w' }] },
  ]);
  const work = withUpdateSources({ id: 'ext:w', _work: { editions: [] } }, g);
  const thumb = Object.fromEntries(work._work.editions.map((e) => [e.sourceId, e.manga.thumbnailUrl]));
  expect(thumb['src.b']).toBe('https://cdn.b.example/w.jpg');
  expect(thumb['src.a']).not.toBe('https://cdn.b.example/w.jpg');
});
