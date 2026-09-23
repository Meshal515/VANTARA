import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gateEntry, rememberGateAccount, rememberedGateAccount } from './gate-policy.js';

/**
 * قفل «من يتابع؟».
 *
 * السؤال: هل يُمنع أحدٌ من دخول حسابٍ يستعمله غيره الآن — دون أن يُمنع صاحب
 * الجهاز من حسابه هو؟ الخادم يقول `active` لكل حساب نبض خلال خمس دقائق،
 * فمن خرج ثم عاد خلالها يرى حسابه «مستخدمًا الآن».
 */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe('gate entry', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('an idle account is open', () => {
    expect(gateEntry({ userId: 'a', active: false }, null)).toEqual({ locked: false });
  });

  it('an account in use elsewhere is locked', () => {
    expect(gateEntry({ userId: 'a', active: true }, 'b')).toEqual({ locked: true });
  });

  it('this device is never locked out of its own last account', () => {
    // خرج ثم فتح الشاشة خلال دقائق: نبضه ما زال «نشطًا» على الخادم
    expect(gateEntry({ userId: 'a', active: true }, 'a')).toEqual({ locked: false });
  });

  it('a device that never signed in locks every account in use', () => {
    expect(gateEntry({ userId: 'a', active: true }, null)).toEqual({ locked: true });
  });

  it('the remembered account survives sign out', () => {
    // signOut يمحو vantara.user؛ هذا مفتاحٌ آخر بقصد
    rememberGateAccount('a');
    localStorage.removeItem('vantara.user');
    expect(rememberedGateAccount()).toBe('a');
  });

  it('blocked storage reads as no remembered account instead of throwing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(rememberedGateAccount()).toBe(null);
  });
});
