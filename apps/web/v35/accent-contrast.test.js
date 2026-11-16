import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { onAccent } from './appearance.js';

const css = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const rule = (text, selector) => {
  const i = text.indexOf(`${selector} {`);
  return i < 0 ? '' : text.slice(i, text.indexOf('}', i));
};

describe('نص الأزرار بلون القسم يُحسب بالتباين (بلاغ المالك: «شاهد» أبيض على أبيض)', () => {
  it('اللون الفاتح نصه أسود، والغامق أبيض', () => {
    expect(onAccent('#e6e6ec')).not.toBe('#ffffff');
    expect(onAccent('#c9a227')).not.toBe('#ffffff');
    expect(onAccent('#c1121f')).toBe('#ffffff');
    expect(onAccent('#5260d2')).toBe('#ffffff');
  });
  it('أزرار التشغيل والأزرار الأساسية تستعمل --on-accent', () => {
    expect(rule(css('./cinema.css'), '.v35 .cn-btn--play')).toContain('var(--on-accent');
    expect(rule(css('./core.css'), '.v35 .btn-primary')).toContain('var(--on-accent');
    expect(rule(css('../pwa/player/player.css'), '.pwa-player .pp-pill-btn--primary')).toContain('var(--on-accent');
    expect(css('../pwa/player/player.css')).toContain('.pwa-player .pl-start.is-primary { background: var(--pl-accent); border-color: var(--pl-accent); color: var(--pl-on-accent, #fff); }');
  });
});
