import { describe, expect, it } from 'vitest';
import { patchAppearance, readAppearance } from './appearance.js';
import {
  defaultStructure, experienceView, isValidStructure, modeOf, normalizeStructure, readStructure,
  setTemplate, setUnifyContent, setUnifyScreens, writeStructure,
} from './experience.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
};

describe('بنية التجربة: ثلاث حالات صحيحة فقط', () => {
  it('الافتراضي الاستقلال الكامل، والقراءة بلا مفتاح لا تكتب شيئًا', () => {
    const s = memory();
    expect(readStructure(s)).toEqual(defaultStructure());
    expect(modeOf(readStructure(s))).toBe('independent');
    expect(s.m.size).toBe(0);
  });

  it('الحالات الثلاث تُحفظ وتُقرأ كما هي', () => {
    const s = memory();
    for (const [screens, content, mode] of [[false, false, 'independent'], [true, false, 'screens'], [true, true, 'content']]) {
      writeStructure({ unifyScreens: screens, unifyContent: content, template: 'anime' }, s);
      const r = readStructure(s);
      expect([r.unifyScreens, r.unifyContent]).toEqual([screens, content]);
      expect(modeOf(r)).toBe(mode);
      expect(isValidStructure(r)).toBe(true);
    }
  });

  it('الحالة الممنوعة (false,true) لا تُقرأ ولا تُكتب أبدًا، ويُحفظ تفضيل المحتوى', () => {
    const forbidden = { unifyScreens: false, unifyContent: true };
    expect(isValidStructure(forbidden)).toBe(false);
    const n = normalizeStructure(forbidden);
    expect([n.unifyScreens, n.unifyContent, n.contentPreferred]).toEqual([false, false, true]);
    const s = memory({ 'vantara.experience.v1': JSON.stringify(forbidden) });
    expect(readStructure(s).unifyContent).toBe(false);
    writeStructure(forbidden, s);
    expect(JSON.parse(s.m.get('vantara.experience.v1')).unifyContent).toBe(false);
    // طلب المحتوى قبل الشاشات يُرفض
    expect(setUnifyContent(defaultStructure(), true)).toEqual(defaultStructure());
  });

  it('الانتقالات: إيقاف الشاشات يوقف المحتوى ويحفظ تفضيله، وتشغيلها يعيده', () => {
    let s = setUnifyScreens(defaultStructure(), true);
    expect(modeOf(s)).toBe('screens');
    s = setUnifyContent(s, true);
    expect(modeOf(s)).toBe('content');
    s = setUnifyScreens(s, false);
    expect(modeOf(s)).toBe('independent');
    expect(s.unifyContent).toBe(false);
    expect(s.contentPreferred).toBe(true);
    s = setUnifyScreens(s, true);
    expect(modeOf(s)).toBe('content');
    // إيقاف المحتوى صراحة يمحو التفضيل
    s = setUnifyContent(s, false);
    s = setUnifyScreens(setUnifyScreens(s, false), true);
    expect(modeOf(s)).toBe('screens');
  });

  it('الإيقاف والتشغيل السريع المتكرر لا يُنتج حالة ممنوعة', () => {
    let s = defaultStructure();
    const steps = [setUnifyScreens, setUnifyContent];
    for (let i = 0; i < 200; i++) {
      s = steps[i % 2](s, (i * 7) % 3 !== 0);
      expect(isValidStructure(s)).toBe(true);
    }
  });

  it('القالب أحد الأقسام الثلاثة فقط، ويبقى محفوظًا بعد إيقاف التوحيد', () => {
    let s = setTemplate(setUnifyScreens(defaultStructure(), true), 'cinema');
    expect(s.template).toBe('cinema');
    expect(setTemplate(s, 'classic').template).toBe('cinema');
    s = setUnifyScreens(s, false);
    expect(s.template).toBe('cinema');
    expect(normalizeStructure({ template: 'modern' }).template).toBe('manga');
  });

  it('نمط البطاقة مستقل عن قالب الشاشة وعن توحيد المحتوى', () => {
    const look = { style: { manga: 'gallery', anime: 'screen' }, accent: {}, pureBlack: false };
    const views = [
      experienceView(defaultStructure(), look),
      experienceView({ unifyScreens: true, template: 'cinema' }, look),
      experienceView({ unifyScreens: true, unifyContent: true, template: 'anime' }, look),
    ];
    for (const v of views) expect(v.cardStyle).toEqual({ manga: 'gallery', anime: 'screen', cinema: 'current' });
    expect(views[0].screenTemplate('anime')).toBe('anime');
    expect(views[1].screenTemplate('anime')).toBe('cinema');
    expect(views[1].screenTemplate('manga')).toBe('cinema');
    expect([views[0].showSectionSwitch, views[1].showSectionSwitch, views[2].showSectionSwitch]).toEqual([true, true, false]);
    expect([views[0].home, views[1].home, views[2].home]).toEqual(['section', 'section', 'all']);
  });

  it('الإعدادات القديمة تبقى: المفتاح القديم يُقرأ كما هو، والبنية مفتاح مستقل لا يمسّه', () => {
    const legacy = JSON.stringify({ style: { anime: 'card' }, accent: { anime: 'gold', manga: 'rose' }, pureBlack: true, future: { x: 1 } });
    const s = memory({ 'vantara.appearance.v1': legacy, 'vantara.section': 'anime' });
    writeStructure(setUnifyContent(setUnifyScreens(readStructure(s), true), true), s);
    expect(s.m.get('vantara.appearance.v1')).toBe(legacy);
    expect(s.m.get('vantara.section')).toBe('anime');
    // حفظ اختيار جديد (نمط المانجا ولون العلامة) لا يُسقط شيئًا قديمًا ولا حقلًا لا يعرفه هذا الإصدار
    patchAppearance((a) => ({ style: { ...a.style, manga: 'resume' }, accent: { ...a.accent, brand: 'teal' } }), s);
    const after = JSON.parse(s.m.get('vantara.appearance.v1'));
    expect(after).toEqual({ style: { anime: 'card', manga: 'resume' }, accent: { anime: 'gold', manga: 'rose', brand: 'teal' }, pureBlack: true, future: { x: 1 } });
    expect(readAppearance(s).pureBlack).toBe(true);
  });

  it('مفتاح بنية تالف يرجع للاستقلال دون رمي', () => {
    expect(readStructure(memory({ 'vantara.experience.v1': '{bad' }))).toEqual(defaultStructure());
    expect(readStructure(memory({ 'vantara.experience.v1': '[1,2]' }))).toEqual(defaultStructure());
  });
});
