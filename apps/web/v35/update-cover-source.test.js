/** بلاغ المالك (16 نوفمبر): أغلفة «آخر التحديثات» حروف. غلاف الحدث يُنسب لمصدره هو، لا لكل نسخ العمل. */
import { expect, it } from 'vitest';
import { groupEvents } from './updates-view.js';
import { withUpdateSources } from './works.js';

it('the event cover belongs to the source that published it, so it is fetched with that source headers', () => {
  const [g] = groupEvents([
    { id: 'e2', section: 'manga', work: 'ext:w', title: 'W', number: 12, at: 2, cover: 'https://cdn.b.example/w.jpg', sources: [{ s: 'eu.kanade.tachiyomi.extension.ar.srcb', u: '/w' }] },
    { id: 'e1', section: 'manga', work: 'ext:w', title: 'W', number: 11, at: 1, cover: 'https://cdn.a.example/w.jpg', sources: [{ s: 'eu.kanade.tachiyomi.extension.ar.srca', u: '/w' }] },
  ]);
  const work = withUpdateSources({ id: 'ext:w', _work: { editions: [] } }, g);
  const thumb = Object.fromEntries(work._work.editions.map((e) => [e.sourceId, e.manga.thumbnailUrl]));
  expect(thumb['eu.kanade.tachiyomi.extension.ar.srcb']).toBe('https://cdn.b.example/w.jpg');
  expect(thumb['eu.kanade.tachiyomi.extension.ar.srca']).not.toBe('https://cdn.b.example/w.jpg');
});
