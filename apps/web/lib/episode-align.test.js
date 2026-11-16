import { describe, expect, it } from 'vitest';
import { alignEpisode, identifiesEpisode, movieListing } from './episode-align.js';

const title = 'Tatsuki Fujimoto 17-26';
const ep = (number, name) => ({ number, name });
const other = [ep(1, `${title} Episode 1 - A Couple Clucking Chickens`), ep(2, `${title} Episode 2 - Woke-Up-as-a-Girl Syndrome`), ep(3, `${title} Episode 3 - Sasaki Stopped a Bullet`), ep(4, `${title} Episode 4 - Love Is Blind`)];

describe('نفس الحلقة في كل المصادر (Tatsuki Fujimoto 17-26)', () => {
  it('مصدر بترتيب آخر يعطي الحلقة التي تحمل القصة نفسها لا الرقم نفسه', () => {
    expect(alignEpisode('Episode 3: Love Is Blind', other[2], other, title)).toEqual({ use: other[3], realigned: true });
    expect(alignEpisode('Sasaki Stopped a Bullet', other[2], other, title)).toEqual({ use: other[2], realigned: false });
  });
  it('قصة أخرى بلا مطابق لا تُخلط', () => {
    expect(alignEpisode('Mermaid Rhapsody', other[2], other, title)).toEqual({ skip: true });
  });
  it('الأسماء العامة واللغات المختلفة ليست دليلًا', () => {
    const generic = [ep(3, 'الحلقة 3'), ep(4, 'الحلقة 4')];
    expect(alignEpisode('Love Is Blind', generic[0], generic, title).use).toBe(generic[0]);
    const arabic = [ep(3, 'ساساكي أوقف رصاصة')];
    expect(alignEpisode('Love Is Blind', arabic[0], arabic, title).use).toBe(arabic[0]);
    expect(alignEpisode(null, other[2], other, title).use).toBe(other[2]);
    expect(identifiesEpisode(`${title} Episode 3`, title)).toBe(false);
  });
});

describe('فيلم لا يأخذ حلقة مسلسل', () => {
  it('صفحة بحلقات مرقّمة مختلفة ليست فيلمًا؛ نسخ الفيلم الواحد مقبولة', () => {
    expect(movieListing([{ number: 1 }])).toBe(true);
    expect(movieListing([{ number: -1, name: 'مترجم' }, { number: -1, name: 'مدبلج' }])).toBe(true);
    expect(movieListing([{ number: 1 }, { number: 2 }, { number: 3 }])).toBe(false);
  });
});
