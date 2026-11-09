import { describe, expect, it } from 'vitest';
import { ACCENTS, MANGA_WORK_STYLES, WORK_STYLES, accentOf, brandOf, stylesOf, applyAppearance, onAccent, paletteVars, readAppearance, toneCss, workStyleOf, writeAppearance } from './appearance.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
};
const node = () => {
  const props = new Map();
  return { props, style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) } };
};

describe('أنماط المانجا والسينما ولون العلامة', () => {
  it('المانجا بأربعة أنماط متفق عليها أولها «الصفحة»، والأنمي كما هو، والسينما بأساسيها وثلاثة أنماط (قرار المالك، 9 نوفمبر)', () => {
    expect(MANGA_WORK_STYLES.map((s) => s.id)).toEqual(['page', 'gallery', 'profile', 'resume']);
    expect(workStyleOf('manga', readAppearance(memory()))).toBe('page');
    expect(workStyleOf('manga', { style: { manga: 'gallery' } })).toBe('gallery');
    expect(workStyleOf('manga', { style: { manga: 'core' } })).toBe('page');
    expect(workStyleOf('anime', { style: { manga: 'gallery', anime: 'episode' } })).toBe('episode');
    expect(workStyleOf('anime', { style: { anime: 'page' } })).toBe('core');
    expect(stylesOf('cinema').map((s) => s.id)).toEqual(['current', 'premiere', 'poster', 'marquee']);
    expect(workStyleOf('cinema', { style: { cinema: 'marquee' } })).toBe('marquee');
    expect(workStyleOf('cinema', { style: { cinema: 'core' } })).toBe('current');
    expect(workStyleOf('cinema', { style: {} })).toBe('current');
  });

  it('لون العلامة القديم لا يغيّر اللون الأساسي الجديد', () => {
    expect(brandOf({ accent: {} })).toBeNull();
    const root = node();
    applyAppearance('manga', [root], { style: {}, accent: { brand: 'teal' }, pureBlack: false });
    expect(root.props.get('--brand')).toBe('#8f5cff');
    expect(root.props.get('--accent')).toBe('#8f5cff');
    applyAppearance('manga', [root], { style: {}, accent: {}, pureBlack: false });
    expect(root.props.get('--accent')).toBe('#8f5cff');
  });
});

describe('المظهر', () => {
  it('اختيار اللون يبقى فعالًا في الجلسة عند رفض التخزين', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    writeAppearance({ style: {}, accent: { anime: 'gold' }, pureBlack: false }, storage);
    expect(accentOf('anime', readAppearance(storage))).toBe('#c9a227');
  });
  it('البنفسجي هو الأساسي لكل الأقسام والموحد، مع احترام اللون المحفوظ لكل واحد', () => {
    for (const section of ['manga', 'anime', 'cinema', 'unified']) {
      const root = node();
      applyAppearance(section, [root], { accent: {}, pureBlack: false });
      expect(root.props.get('--accent'), section).toBe('#8f5cff');
      applyAppearance(section, [root], { accent: { [section]: 'gold' }, pureBlack: false });
      expect(root.props.get('--accent'), section).toBe('#c9a227');
    }
  });
  it('عشرون لونًا أولها ألوان الأقسام الثلاثة ثم الأبيض، وخمسة أنماط أولها الأساسي', () => {
    expect(ACCENTS).toHaveLength(20);
    expect(ACCENTS.slice(0, 4).map((c) => c.id)).toEqual(['manga', 'anime', 'cinema', 'white']);
    expect(new Set(ACCENTS.map((c) => c.hex)).size).toBe(20);
    expect(WORK_STYLES.map((s) => s.id)).toEqual(['core', 'platform', 'card', 'screen', 'episode']);
  });

  it('بلا اختيار: النمط الأساسي واللون البنفسجي', () => {
    const s = memory();
    const a = readAppearance(s);
    expect(workStyleOf('anime', a)).toBe('core');
    expect(accentOf('anime', a)).toBeNull();
    const root = node();
    expect(applyAppearance('anime', [root], a)).toBeNull();
    expect(root.props.get('--accent')).toBe('#8f5cff');
  });

  it('اختيار محفوظ يُقرأ كما هو؛ وقيمة تالفة ترجع للأساسي', () => {
    const s = memory();
    writeAppearance({ style: { anime: 'card' }, accent: { anime: 'gold' }, pureBlack: false }, s);
    const a = readAppearance(s);
    expect(workStyleOf('anime', a)).toBe('card');
    expect(accentOf('anime', a)).toBe('#c9a227');
    expect(workStyleOf('anime', { style: { anime: 'nope' } })).toBe('core');
    s.setItem('vantara.appearance.v1', '{bad');
    expect(readAppearance(s)).toEqual({ style: {}, accent: {}, pureBlack: false });
  });

  it('اللون يصل لجذر التطبيق و<html> معًا، ويُمسح كله عند الرجوع للون المصمّم', () => {
    const root = node();
    const html = node();
    applyAppearance('anime', [root, html], { style: {}, accent: { anime: 'teal' }, pureBlack: false });
    for (const n of [root, html]) {
      expect(n.props.get('--accent')).toBe('#169c9a');
      expect(n.props.get('--bg')).toContain('#169c9a');
    }
    // قسم آخر بلا اختيار: لا يبقى لون الأنمي عالقًا عليه
    applyAppearance('cinema', [root, html], { style: {}, accent: { anime: 'teal' }, pureBlack: false });
    expect(root.props.get('--accent')).toBe('#8f5cff');
    expect(html.props.get('--accent')).toBe('#8f5cff');
  });

  it('أسود صافي: خلفية سوداء تمامًا مع لون القسم المصمّم أو المختار، وشريط النظام أسود', () => {
    expect(paletteVars(null, { pureBlack: true })).toEqual({ '--bg': '#000', '--bg-raised': '#000', '--surface-1': '#0a0a0b' });
    const root = node();
    expect(applyAppearance('manga', [root], { style: {}, accent: { manga: 'rose' }, pureBlack: true })).toBe('#000000');
    expect(root.props.get('--bg')).toBe('#000');
    expect(root.props.get('--accent')).toBe('#cf5f95');
  });

  it('النص فوق اللون المختار يُحسب من تباينه: أسود فوق الأبيض والفاتح، وأبيض فوق الداكن', () => {
    expect(onAccent('#e6e6ec')).toBe('#0b0b0f');
    expect(onAccent('#c9a227')).toBe('#0b0b0f');
    expect(onAccent('#9fb03c')).toBe('#0b0b0f');
    expect(onAccent('#c1121f')).toBe('#ffffff');
    expect(onAccent('#5260d2')).toBe('#ffffff');
    expect(paletteVars('#e6e6ec')['--on-accent']).toBe('#0b0b0f');
    // ألوان الأقسام المصمّمة تبقى بنص أبيض كما هي
    expect(onAccent('#8f5cff')).toBe('#ffffff');
    expect(onAccent('#3b82f6')).toBe('#ffffff');
  });

  it('الأوراق تلبس البنفسجي الأساسي أو لون القسم المختار', () => {
    expect(toneCss({ style: {}, accent: {}, pureBlack: false })).toContain(".v35 [data-tone='anime']{--accent:#8f5cff");
    const css = toneCss({ style: {}, accent: { anime: 'gold' }, pureBlack: false });
    expect(css).toContain(".v35 [data-tone='anime']{");
    expect(css).toContain('--accent:#c9a227');
    expect(css).toContain('--on-accent:#0b0b0f');
    expect(css).toContain("[data-tone='cinema']{--accent:#8f5cff");
  });
});

describe('لون ما يُفتح من الواجهة (المشغّل والقارئ والأوراق) = لون الواجهة نفسه', () => {
  it('لون القسم المختار، وإلا البنفسجي الأساسي (لا أزرق/أحمر مصمّم)، ومع التوحيد لون الموحد', async () => {
    const { liveAccent, toneCss, BRAND_DEFAULT } = await import('./appearance.js');
    const a = { accent: { manga: 'emerald', cinema: 'gold', unified: 'rose' } };
    const hex = (id) => ACCENTS.find((c) => c.id === id)?.hex;
    expect(liveAccent('manga', {}, a)).toBe(hex('emerald'));
    expect(liveAccent('cinema', {}, a)).toBe(hex('gold'));
    expect(liveAccent('anime', {}, a)).toBe(BRAND_DEFAULT);
    expect(liveAccent('cinema', { unified: true }, a)).toBe(hex('rose'));
    expect(liveAccent('anime', { unified: true }, { accent: {} })).toBe(BRAND_DEFAULT);
    // أوراق السيرفرات بنغمة القسم تلبس لون الموحد مع التوحيد
    expect(toneCss(a, { unified: true })).toContain(`[data-tone='cinema']{--accent:${hex('rose')}`);
    expect(toneCss(a)).toContain(`[data-tone='cinema']{--accent:${hex('gold')}`);
  });
});
