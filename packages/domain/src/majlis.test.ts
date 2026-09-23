import { describe, expect, it } from 'vitest';
import { hiddenToken, majlisAudience } from './majlis.ts';

const accounts = ['abdulrahman', 'dahmi', 'mishal', 'mansour'];

describe('majlisAudience', () => {
  it('لشخص: الإشعار له وحده، والإخفاء عمّن اختاره المرسل', () => {
    expect(majlisAudience({ accounts, actorId: 'dahmi', toId: 'abdulrahman', hiddenFrom: ['mishal'] })).toEqual({
      recipients: ['abdulrahman'],
      hidden: ['mishal'],
    });
  });

  it('للجميع: كل الأصدقاء إلا المرسل ومن أُخفي عنهم', () => {
    expect(majlisAudience({ accounts, actorId: 'dahmi', toId: null, hiddenFrom: ['mansour'] })).toEqual({
      recipients: ['abdulrahman', 'mishal'],
      hidden: ['mansour'],
    });
  });

  it('لا يُخفى عن المستلم ولا عن المرسل، والغريب يسقط', () => {
    expect(
      majlisAudience({ accounts, actorId: 'dahmi', toId: 'mishal', hiddenFrom: ['mishal', 'dahmi', 'stranger', 'mansour', 'mansour'] }),
    ).toEqual({ recipients: ['mishal'], hidden: ['mansour'] });
  });

  it('يرفض الإرسال لنفسك أو لغريب', () => {
    expect(majlisAudience({ accounts, actorId: 'dahmi', toId: 'dahmi' })).toBeNull();
    expect(majlisAudience({ accounts, actorId: 'dahmi', toId: 'stranger' })).toBeNull();
  });

  it('«الجميع» مع إخفاء الكل = لا جمهور', () => {
    expect(majlisAudience({ accounts, actorId: 'dahmi', hiddenFrom: ['abdulrahman', 'mishal', 'mansour'] })).toBeNull();
  });

  it('قائمة إخفاء غير صالحة تُعامل كفارغة', () => {
    expect(majlisAudience({ accounts, actorId: 'dahmi', toId: 'mishal', hiddenFrom: 'mansour' })?.hidden).toEqual([]);
  });

  it('رمز البحث يطابق JSON المخزّن', () => {
    const stored = JSON.stringify(['mansour', 'mishal']);
    expect(stored.includes(hiddenToken('mishal'))).toBe(true);
    // «mish» جزء من «mishal» لكنه ليس هو: الاقتباس يمنع الخلط
    expect(stored.includes(hiddenToken('mish'))).toBe(false);
  });
});
