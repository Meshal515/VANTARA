import { describe, expect, it } from 'vitest';
import { ACCENTS, WORK_STYLES, accentOf, applyAppearance, onAccent, paletteVars, readAppearance, toneCss, workStyleOf, writeAppearance } from './appearance.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
};
const node = () => {
  const props = new Map();
  return { props, style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) } };
};

describe('المظهر', () => {
  it('عشرون لونًا أولها ألوان الأقسام الثلاثة ثم الأبيض، وخمسة أنماط أولها الأساسي', () => {
    expect(ACCENTS).toHaveLength(20);
    expect(ACCENTS.slice(0, 4).map((c) => c.id)).toEqual(['manga', 'anime', 'cinema', 'white']);
    expect(new Set(ACCENTS.map((c) => c.hex)).size).toBe(20);
    expect(WORK_STYLES.map((s) => s.id)).toEqual(['core', 'platform', 'card', 'screen', 'episode']);
  });

  it('بلا اختيار: النمط الأساسي ولون القسم المصمّم، ولا يُكتب شيء على العقد', () => {
    const s = memory();
    const a = readAppearance(s);
    expect(workStyleOf('anime', a)).toBe('core');
    expect(accentOf('anime', a)).toBeNull();
    const root = node();
    expect(applyAppearance('anime', [root], a)).toBeNull();
    expect(root.props.size).toBe(0);
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
    expect(root.props.size).toBe(0);
    expect(html.props.size).toBe(0);
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

  it('الأوراق بنغمة قسم ثابتة تلبس اللون المختار لقسمها، ولا قاعدة بلا اختيار', () => {
    expect(toneCss({ style: {}, accent: {}, pureBlack: false })).toBe('');
    const css = toneCss({ style: {}, accent: { anime: 'gold' }, pureBlack: false });
    expect(css).toContain(".v35 [data-tone='anime']{");
    expect(css).toContain('--accent:#c9a227');
    expect(css).toContain('--on-accent:#0b0b0f');
    expect(css).not.toContain("[data-tone='cinema']");
  });
});
