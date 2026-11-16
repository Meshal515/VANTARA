import { describe, expect, it } from 'vitest';
import { patchAppearance, readAppearance } from './appearance.js';
import { defaultStructure, experienceView, modeOf, normalizeStructure, readStructure, setUnifyContent, writeStructure } from './experience.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
};

describe('بنية التجربة: حالتان فقط (توحيد الشاشات محذوف)', () => {
  it('الافتراضي الاستقلال، والقراءة بلا مفتاح لا تكتب شيئًا', () => {
    const s = memory();
    expect(readStructure(s)).toEqual(defaultStructure());
    expect(modeOf(readStructure(s))).toBe('independent');
    expect(s.m.size).toBe(0);
  });

  it('الحالتان تُحفظان وتُقرآن كما هما، ولا يُكتب حقل الشاشات بعد اليوم', () => {
    const s = memory();
    for (const [content, mode] of [[false, 'independent'], [true, 'content']]) {
      writeStructure(setUnifyContent(readStructure(s), content), s);
      expect(modeOf(readStructure(s))).toBe(mode);
      const raw = JSON.parse(s.m.get('vantara.experience.v1'));
      expect('unifyScreens' in raw).toBe(false);
      expect('template' in raw).toBe(false);
    }
  });

  it('قيم الإصدار السابق: (شاشات+محتوى) محتوى، و(شاشات وحدها) استقلال، والممنوعة القديمة استقلال', () => {
    const read = (v) => modeOf(readStructure(memory({ 'vantara.experience.v1': JSON.stringify(v) })));
    expect(read({ v: 1, unifyScreens: true, unifyContent: true, template: 'anime' })).toBe('content');
    expect(read({ v: 1, unifyScreens: true, unifyContent: false, contentPreferred: true })).toBe('independent');
    expect(read({ v: 1, unifyScreens: false, unifyContent: true })).toBe('independent');
    expect(read({ v: 2, unifyContent: true })).toBe('content');
  });

  it('التبديل السريع المتكرر يعطي آخر اختيار دائمًا', () => {
    let s = defaultStructure();
    for (let i = 0; i < 200; i++) {
      const on = (i * 7) % 3 !== 0;
      s = setUnifyContent(s, on);
      expect(modeOf(s)).toBe(on ? 'content' : 'independent');
    }
  });

  it('عند فشل التخزين لا يرجع مفتاح التوحيد لحالته القديمة داخل الجلسة', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    writeStructure(setUnifyContent(readStructure(storage), true), storage);
    expect(readStructure(storage).unifyContent).toBe(true);
    writeStructure(setUnifyContent(readStructure(storage), false), storage);
    expect(readStructure(storage).unifyContent).toBe(false);
  });

  it('نمط البطاقة مستقل عن توحيد المحتوى', () => {
    const look = { style: { manga: 'gallery', anime: 'screen' }, accent: {}, pureBlack: false };
    const a = experienceView(defaultStructure(), look);
    const b = experienceView({ unifyContent: true }, look);
    for (const v of [a, b]) expect(v.cardStyle).toEqual({ manga: 'gallery', anime: 'screen', cinema: 'current' });
    expect([a.showSectionSwitch, b.showSectionSwitch]).toEqual([true, false]);
    expect([a.home, b.home]).toEqual(['section', 'all']);
    expect('screenTemplate' in a).toBe(false);
  });

  it('الإعدادات القديمة تبقى: البنية مفتاح مستقل لا يمسّ المظهر ولا القسم', () => {
    const legacy = JSON.stringify({ style: { anime: 'card' }, accent: { anime: 'gold', manga: 'rose' }, pureBlack: true, future: { x: 1 } });
    const s = memory({ 'vantara.appearance.v1': legacy, 'vantara.section': 'anime' });
    writeStructure(setUnifyContent(readStructure(s), true), s);
    expect(s.m.get('vantara.appearance.v1')).toBe(legacy);
    expect(s.m.get('vantara.section')).toBe('anime');
    patchAppearance((a) => ({ style: { ...a.style, manga: 'resume' }, accent: { ...a.accent, brand: 'teal' } }), s);
    const after = JSON.parse(s.m.get('vantara.appearance.v1'));
    expect(after).toEqual({ style: { anime: 'card', manga: 'resume' }, accent: { anime: 'gold', manga: 'rose', brand: 'teal' }, pureBlack: true, future: { x: 1 } });
    expect(readAppearance(s).pureBlack).toBe(true);
  });

  it('مفتاح بنية تالف يرجع للاستقلال دون رمي', () => {
    expect(readStructure(memory({ 'vantara.experience.v1': '{bad' }))).toEqual(defaultStructure());
    expect(readStructure(memory({ 'vantara.experience.v1': '[1,2]' }))).toEqual(defaultStructure());
    expect(normalizeStructure(null)).toEqual(defaultStructure());
  });
});
