import { parseHTML } from 'linkedom';
import { beforeEach, describe, expect, it } from 'vitest';
import { patchAppearance, readAppearance } from './appearance.js';
import { readStructure } from './experience.js';
import { CATEGORIES, renderAppearancePane } from './settings-center.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
};

let doc;
const el = (tag, cls, text) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const glyph = () => '<svg class="icon"></svg>';

function mount(storage) {
  const body = doc.createElement('div');
  doc.body.append(body);
  const sheets = [];
  const ctx = {
    el, glyph, storage,
    openSheet: (fill) => { const s = doc.createElement('div'); fill(s); sheets.push(s); },
    closeSheet: () => {},
    patchAppearance: (change) => patchAppearance(change, storage),
    apply: () => {},
    rerender: () => { body.replaceChildren(); renderAppearancePane(body, ctx); },
  };
  renderAppearancePane(body, ctx);
  return { body, sheets };
}

describe('مركز الإعدادات', () => {
  beforeEach(() => {
    doc = parseHTML('<html><body></body></html>').document;
    globalThis.document = doc;
  });

  it('الفئات السبع بترتيب المالك، وكل مجموعة إعدادات قديمة لها فئة', () => {
    expect(CATEGORIES.map((c) => c.title)).toEqual([
      'المظهر والتخصيص', 'الحسابات والخوادم', 'التشغيل والترجمة', 'المستودعات والإضافات',
      'الخصوصية والتخزين', 'المزامنة والنسخ الاحتياطي', 'الإعدادات المتقدمة',
    ]);
    const mapped = CATEGORIES.flatMap((c) => c.groups);
    for (const old of ['المظهر', 'الحساب', 'الخصوصية', 'ما يراه أصدقاؤك', 'ما تراه أنت', 'التنبيهات', 'الترجمة', 'ملفات الترجمة على الجوال', 'المحتوى', 'أدوات Debug', 'منطقة الخطر', 'حالة المزامنة']) {
      expect(mapped, old).toContain(old);
    }
  });

  it('المظهر بالترتيب: البطاقات ثم الألوان ثم الخلفية ثم أنماط العرض، وكلها بلقطات حقيقية', () => {
    const { body } = mount(memory());
    expect([...body.querySelectorAll('.settings-title')].map((n) => n.textContent)).toEqual(['بطاقات الأعمال', 'ألوان الأقسام', 'الخلفية', 'أنماط العرض والتكامل']);
    const tiles = [...body.querySelectorAll('.look-tiles')];
    // المانجا ثم الأنمي ثم السينما
    expect([...tiles[0].querySelectorAll('.look-tile-text strong')].map((n) => n.textContent)).toEqual(['المانجا', 'الأنمي', 'السينما']);
    expect(tiles[0].querySelector('img').getAttribute('src')).toBe('/v35/looks/work-manga-page-phone.webp');
    // السينما صارت بأنماط: بلاطتها تُفتح كالقسمين الآخرين
    expect(tiles[0].querySelectorAll('.look-tile')[2].hasAttribute('disabled')).toBe(false);
    expect(tiles[1].querySelector('img').getAttribute('src')).toBe('/v35/looks/home-manga-phone.webp');
    expect(tiles[0].querySelector('source').getAttribute('srcset')).toBe('/v35/looks/work-manga-page-pc.webp');
  });

  it('اختيار نمط المانجا يُحفظ لها وحدها، ولا يمسّ نمط الأنمي', () => {
    const storage = memory({ 'vantara.appearance.v1': JSON.stringify({ style: { anime: 'card' }, accent: {}, pureBlack: false }) });
    const { body, sheets } = mount(storage);
    body.querySelector('.look-tiles .look-tile').onclick();
    const options = sheets[0].querySelectorAll('.look-tile');
    expect(options).toHaveLength(5);
    options[3].onclick();
    expect(readAppearance(storage).style).toEqual({ anime: 'card', manga: 'resume' });
  });

  it('«توحيد المحتوى» و«النمط الموحد» خياران منفصلان (توحيد الشاشات محذوف)، ويعملان مباشرة بلا شرط', () => {
    const storage = memory();
    const { body } = mount(storage);
    const switches = () => [...body.querySelectorAll('input[role="switch"]')];
    expect(switches()).toHaveLength(3); // الخلفية، المحتوى، النمط الموحد
    expect(body.textContent).not.toContain('توحيد الشاشات');
    expect(switches()[1].disabled).toBe(false);
    expect(body.querySelector('.look-tiles--static')).toBeTruthy();
    switches()[1].checked = true;
    switches()[1].onchange();
    expect(readStructure(storage).unifyContent).toBe(true);
    expect(body.querySelector('.look-tiles--static')).toBeFalsy();
    expect([...body.querySelectorAll('.look-caption')].at(-1).textContent).toContain('الموحّد');
  });

  it('«النمط الموحد» متاح دائمًا ومستقل: تفعيله لا يفعّل توحيد المحتوى', () => {
    const storage = memory();
    const { body } = mount(storage);
    const look = () => [...body.querySelectorAll('input[role="switch"]')].find((s) => s.closest('.setting, label, div')?.textContent.includes('النمط الموحد'));
    expect(look()).toBeTruthy();
    expect(look().disabled).toBe(false);
    look().checked = true;
    look().onchange();
    expect(readAppearance(storage).unifiedLook).toBe(true);
    expect(readStructure(storage).unifyContent).toBe(false);
  });

  it('ألوان الأقسام الأربعة تبدأ بالأساسي البنفسجي دون خيار مستقل للعلامة', () => {
    const { body, sheets } = mount(memory());
    expect(body.textContent).not.toContain('لون علامة VANTARA');
    const rows = [...body.querySelectorAll('button.setting')];
    for (const label of ['لون المانجا', 'لون الأنمي', 'لون السينما', 'لون الموحد']) {
      const row = rows.find((node) => node.textContent.includes(label));
      expect(row?.textContent, label).toContain('الأساسي');
      row.onclick();
      expect(sheets.at(-1).querySelector('[role="radio"]').getAttribute('aria-label')).toBe('الأساسي');
    }
    expect(body.textContent).not.toContain('لون القسم');
  });
});
