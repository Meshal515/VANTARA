import { describe, expect, it } from 'vitest';
import { decide, eventId, isAbove, JUMP } from './update-decision.js';

// المرحلة 1 من خطة آخر التحديثات المحلي: العقل نفسه للخادم والجهاز (الخادم يختبر سلوكه في updates.integration.test.ts)
describe('عقل قرار آخر التحديثات المشترك', () => {
  const u = (number, publishedAt = null, season = null) => ({ season, number, publishedAt });
  it('هوية الحدث: 12.50 و12.5 حدث واحد، والمصدر ليس جزءًا منها', () => {
    expect(eventId('ext:x', 'chapter', null, 12.5)).toBe(eventId('ext:x', 'chapter', null, 12.50));
    expect(eventId('anime:1', 'episode', 2, 3)).toBe('anime:1|s2e:3');
  });
  it('أول مشاهدة بلا تواريخ = خط أساس بلا أحداث (لا «ألف عمل قبل ثانية»)', () => {
    expect(decide({ kind: 'chapter', units: [u(10), u(11), u(12)] }, null, 0)).toEqual({ fresh: [], mark: { season: null, number: 12 } });
  });
  it('رقم شاذ فوق القفزة لا يصير خطًا ولا حدثًا', () => {
    const { mark } = decide({ kind: 'chapter', units: [u(10), u(11), u(11 + JUMP.chapter + 500)] }, null, 0);
    expect(mark).toEqual({ season: null, number: 11 });
  });
  it('فصل جديد فوق الخط بلا تاريخ = حدث، والخط يتقدم', () => {
    expect(decide({ kind: 'chapter', units: [u(12), u(13)] }, { season: null, number: 12 }, 0)).toEqual({ fresh: [u(13)], mark: { season: null, number: 13 } });
    expect(isAbove({ season: 2, number: 1 }, { season: 1, number: 99 })).toBe(true);
  });
});
