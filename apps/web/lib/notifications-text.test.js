import { describe, expect, it } from 'vitest';
import { describeNotification, unitLine } from './notifications.js';

describe('notification text (one wording for toast, inbox and phone)', () => {
  it('new chapters read as the owner asked: «نزل الفصل 120» under the work title, ranges grouped', () => {
    const one = describeNotification({ kind: 'NEW_UNIT', body: 'نزل الفصل 120 من Solo Leveling', meta: JSON.stringify({ t: 'Solo Leveling', k: 'chapter', a: 120, b: 120, c: 'x.jpg' }) });
    expect(one).toEqual({ title: 'Solo Leveling', body: 'نزل الفصل 120', group: 'favorites', image: 'x.jpg' });
    expect(unitLine({ k: 'chapter', a: 118, b: 120 })).toBe('نزلت الفصول 118–120');
    expect(unitLine({ k: 'episode', s: 2, a: 5, b: 5 })).toBe('الموسم 2 · نزلت الحلقة 5');
    expect(unitLine({ k: 'chapter', a: 0, b: 0 })).toBe('نزل الفصل 0');
    expect(unitLine({ k: 'movie' })).toBe('صار متاحًا الآن');
  });

  it('messages: the sender, the latest line, a count while unread, nothing of a deleted one', () => {
    expect(describeNotification({ kind: 'MESSAGE', body: 'وينك', meta: '{"n":1}' }, 'سعد')).toMatchObject({ title: 'سعد', body: 'وينك', group: 'messages' });
    expect(describeNotification({ kind: 'MESSAGE', body: 'رد', meta: '{"n":3}' }, 'سعد').title).toBe('سعد · 3 رسائل');
    expect(describeNotification({ kind: 'MESSAGE', body: 'رسالة صوتية 🎤', meta: '{"v":1,"n":1}' }, 'سعد').body).toBe('🎤 رسالة صوتية');
    expect(describeNotification({ kind: 'MESSAGE', body: 'حُذفت الرسالة', meta: '{"n":1,"x":1}' }, 'سعد').body).toBe('حُذفت الرسالة');
  });

  it('older kinds keep their wording, and a broken body never throws', () => {
    expect(describeNotification({ kind: 'RECOMMENDATION', body: 'لازم تشوفه' }, 'سعد')).toMatchObject({ title: 'سعد رشّح لك', body: 'لازم تشوفه', group: 'social' });
    expect(describeNotification({ kind: 'NEW_UNIT', body: 'نص', meta: '{oops' }).title).toBe('عمل في مفضلتك');
    expect(describeNotification({ kind: 'WHATEVER', body: 'x' }).group).toBe('system');
  });
});
