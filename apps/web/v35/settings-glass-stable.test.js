import { parseHTML } from 'linkedom';
import { describe, expect, it, vi } from 'vitest';

// نسخة Stable: رقم الإصدار مختوم، ولا قناة Debug (قرار المالك، 22 نوفمبر: Glass مقفل «قيد التطوير» في Stable)
vi.mock('../lib/config.js', async (importOriginal) => ({ ...(await importOriginal()), appVersion: () => '0.0.400', buildChannel: () => null }));

const { patchAppearance, glassChosen } = await import('./appearance.js');
const { renderAppearancePane } = await import('./settings-center.js');

describe('Stable: Glass is shown locked as under development, the normal look stays', () => {
  it('the switch is disabled and says «قيد التطوير», and a saved Glass choice draws the normal look', () => {
    const doc = parseHTML('<html><body></body></html>').document;
    globalThis.document = doc;
    const m = new Map([['vantara.appearance.v1', JSON.stringify({ material: 'glass' })]]);
    const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
    const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const body = doc.createElement('div');
    doc.body.append(body);
    const ctx = { el, glyph: () => '<svg></svg>', storage, openSheet: () => {}, closeSheet: () => {}, patchAppearance: (c) => patchAppearance(c, storage), apply: () => {}, rerender: () => {} };
    renderAppearancePane(body, ctx);
    const row = [...body.querySelectorAll('label')].find((l) => l.textContent.includes('التأثير الزجاجي'));
    expect(row.textContent).toContain('قيد التطوير');
    const input = row.querySelector('input[role="switch"]');
    expect(input.disabled).toBe(true);
    expect(input.checked).toBe(false);
    expect(glassChosen({ material: 'glass' })).toBe(false);
  });
});
