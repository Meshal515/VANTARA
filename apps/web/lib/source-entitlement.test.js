import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUNDLED_CUTOVER_MS,
  CHOICE_PREFIX,
  NOT_ADDED,
  assertVisible,
  choicePatch,
  choiceKey,
  choicesOf,
  cohortOf,
  decide,
  entitlement,
  isBundled,
  onEntitlementChange,
  packageOf,
  setEntitlement,
  visible,
  visiblePackages,
} from './source-entitlement.js';

const DILAR = 'eu.kanade.tachiyomi.extension.ar.dilar';
const MANGADEX = 'eu.kanade.tachiyomi.extension.all.mangadex';
const builtins = [
  { id: DILAR, label: 'Dilar' },
  { id: MANGADEX, label: 'MangaDex' },
  { id: `${MANGADEX}@en`, label: 'MangaDex (EN)', filler: true },
];
const userSources = [
  { id: 'eu.kanade.tachiyomi.extension.ar.other#123', user: true, label: 'من مستودعك' },
  { id: 'user.example.com', label: 'موقع أضفته' },
  { id: 'addon|stremio|x', label: 'إضافة ويب' },
  { id: 'user-42', label: 'أنمي مثبت' },
];
const existing = { user_id: 'a', created_at: BUNDLED_CUTOVER_MS - 86_400_000 };
const fresh = { user_id: 'b', created_at: BUNDLED_CUTOVER_MS + 1 };
const settingsWith = (...patches) => JSON.stringify(Object.assign({ popups: true }, ...patches));

describe('هوية الحزمة والمصدر المدمج', () => {
  it('الحزمة واحدة لكل صيغ المعرّف', () => {
    expect(packageOf(DILAR)).toBe(DILAR);
    expect(packageOf(`${MANGADEX}@en`)).toBe(MANGADEX);
    expect(packageOf(`${DILAR}#77`)).toBe(DILAR);
  });
  it('المدمج سابقًا فقط: لا مستودع المستخدم ولا مواقعه ولا إضافات الويب', () => {
    for (const d of builtins) expect(isBundled(d)).toBe(true);
    for (const d of userSources) expect(isBundled(d)).toBe(false);
  });
  it('مفتاح الإعداد يمر بقاعدة الخادم لحقول settings.patch', () => {
    const key = choiceKey(MANGADEX);
    expect(key).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
    expect(key.startsWith(CHOICE_PREFIX)).toBe(true);
    expect(choiceKey('../etc')).toBeNull();
    expect(choiceKey(`eu.${'x'.repeat(80)}.y`)).toBeNull();
  });
});

describe('حالات القبول (BUNDLED_SOURCE_SEPARATION.md)', () => {
  it('حساب موجود على جهازه: المصادر نفسها بمعرّفاتها نفسها', () => {
    const d = decide({ account: existing, settings: settingsWith() });
    expect(d.state).toBe('legacy');
    expect([...builtins, ...userSources].filter((s) => visible(s, d)).map((s) => s.id))
      .toEqual([...builtins, ...userSources].map((s) => s.id));
  });

  it('حساب موجود على جهاز جديد: القرار من صف الحساب المتزامن وحده، لا من مخزن الجهاز', () => {
    // جهاز جديد = لا شيء محلي إطلاقًا، والصف وصل من المزامنة
    const d = decide({ account: { ...existing }, settings: null });
    expect(d.state).toBe('legacy');
    expect(visiblePackages(builtins, d)).toEqual([MANGADEX, DILAR].sort());
  });

  it('حساب جديد: صفر مصادر مدمجة، وما أضافه بنفسه يبقى', () => {
    const d = decide({ account: fresh, settings: null });
    expect(d.state).toBe('clean');
    expect(builtins.filter((s) => visible(s, d))).toEqual([]);
    expect(userSources.every((s) => visible(s, d))).toBe(true);
  });

  it('لا يُستنتج «حساب جديد» من مخزن فارغ: بلا صف الحساب الحالة غير معروفة، والمدمجة تبقى ظاهرة كما كانت', () => {
    for (const account of [null, { user_id: 'a' }, { user_id: 'a', created_at: null }, { user_id: 'a', created_at: 'x' }]) {
      const d = decide({ account, settings: null });
      expect(d.state).toBe('unknown');
      expect(builtins.every((s) => visible(s, d))).toBe(true);
    }
  });

  it('حساب جديد على جهاز مشترك: لا يرث اختيارات حساب آخر (القرار لصف حسابه وإعداداته فقط)', () => {
    const other = decide({ account: existing, settings: settingsWith(choicePatch(DILAR, true)) });
    expect(visible({ id: DILAR }, other)).toBe(true);
    const mine = decide({ account: fresh, settings: null });
    expect(visible({ id: DILAR }, mine)).toBe(false);
  });

  it('المصدر الذي أزاله المستخدم يبقى مُزالًا على كل أجهزته، والتكملة تتبع حزمتها', () => {
    const d = decide({ account: existing, settings: settingsWith(choicePatch(MANGADEX, false)) });
    expect(visible({ id: MANGADEX }, d)).toBe(false);
    expect(visible({ id: `${MANGADEX}@en` }, d)).toBe(false);
    expect(visible({ id: DILAR }, d)).toBe(true);
  });

  it('حساب جديد يضيف حزمة مدمجة سابقًا: تظهر بمعرّفها القديم نفسه، لا نسخة ثانية', () => {
    const d = decide({ account: fresh, settings: settingsWith(choicePatch(DILAR, true)) });
    expect(builtins.filter((s) => visible(s, d)).map((s) => s.id)).toEqual([DILAR]);
  });

  it('الإزالة اختيار في الإعدادات فقط: لا حقول مكتبة أو تقدّم في الرقعة', () => {
    const patch = choicePatch(DILAR, false, 5);
    expect(Object.keys(patch)).toEqual([choiceKey(DILAR)]);
    expect(patch[choiceKey(DILAR)]).toEqual({ pkg: DILAR, on: false, at: 5 });
  });

  it('مفتاح لكل حزمة: اختيار جهازين لحزمتين مختلفتين لا يمحو أحدهما الآخر', () => {
    const merged = settingsWith(choicePatch(DILAR, false), choicePatch(MANGADEX, true));
    const { added, removed } = choicesOf(merged);
    expect([...added]).toEqual([MANGADEX]);
    expect([...removed]).toEqual([DILAR]);
  });

  it('قيم تالفة أو مزوّرة تُتجاهل', () => {
    const { added, removed } = choicesOf({
      [choiceKey(DILAR)]: { pkg: MANGADEX, on: true },
      srcpkg_x: 'on',
      [choiceKey(MANGADEX)]: { pkg: MANGADEX, on: 'yes' },
    });
    expect(added.size + removed.size).toBe(0);
    expect(choicesOf('{bad json').added.size).toBe(0);
  });

  it('وضع «اقرأ بلا حساب» يبقى كما كان قبل الفصل (المدمجة ظاهرة)، وإزالته المحلية تُحترم', () => {
    const d = decide({ standalone: true });
    expect(d.state).toBe('unknown');
    expect(builtins.every((s) => visible(s, d))).toBe(true);
    expect(visible({ id: DILAR }, decide({ standalone: true, settings: settingsWith(choicePatch(DILAR, false)) }))).toBe(false);
  });

  it('فوج الحساب بحدّ الفصل', () => {
    expect(cohortOf({ created_at: BUNDLED_CUTOVER_MS - 1 })).toBe('legacy');
    expect(cohortOf({ created_at: BUNDLED_CUTOVER_MS })).toBe('clean');
  });
});

describe('الحالة الحالية للتطبيق', () => {
  beforeEach(() => setEntitlement({ state: 'unknown' }));
  afterEach(() => setEntitlement({ state: 'unknown' }));

  it('تُعلم المشتركين عند التغيّر الفعلي فقط', () => {
    const fn = vi.fn();
    const off = onEntitlementChange(fn);
    expect(setEntitlement(decide({ account: existing }))).toBe(true);
    expect(setEntitlement(decide({ account: existing }))).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    setEntitlement(decide({ account: fresh }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('طلب مصدر غير مضاف يرمي «أضف مصدرًا» قبل المحرك', () => {
    setEntitlement(decide({ account: fresh }));
    expect(() => assertVisible({ id: DILAR })).toThrow(expect.objectContaining({ code: NOT_ADDED, sourceId: DILAR }));
    expect(() => assertVisible({ id: 'user.example.com' })).not.toThrow();
    setEntitlement(decide({ account: existing }));
    expect(() => assertVisible({ id: DILAR })).not.toThrow();
    expect(entitlement().state).toBe('legacy');
  });
});
