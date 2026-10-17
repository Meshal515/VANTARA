import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cinema = readFileSync(new URL('./cinema.js', import.meta.url), 'utf8');
const cinemaCss = readFileSync(new URL('./cinema.css', import.meta.url), 'utf8');
const coreCss = readFileSync(new URL('./core.css', import.meta.url), 'utf8');
const shell = readFileSync(new URL('./shell.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('./markup.js', import.meta.url), 'utf8');

function rule(css, selector) {
  const pos = css.indexOf(selector + ' {');
  expect(pos, selector).toBeGreaterThanOrEqual(0);
  return css.slice(pos, css.indexOf('}', pos));
}

describe('Cinema navigation tap targets', () => {
  it('mounts the sticky back bar outside the animated detail article', () => {
    expect(cinema).toContain("iconButton('back', 'رجوع', { act: 'goBack' })");
    expect(cinema).toMatch(/wrap\.append\(art, body\);\s*page\.replaceChildren\(bar, wrap\);/);
    expect(cinema).not.toContain('wrap.append(bar, art, body)');
    expect(shell).toContain("goBack: () => goBack()");
    expect(shell).toContain("root.addEventListener('click'");
  });

  it('keeps both navigation bars above the cinematic artwork without transformed ancestors', () => {
    const home = rule(cinemaCss, ".v35[data-section='cinema'] #home > .header");
    expect(home).toMatch(/position:\s*sticky/);
    expect(home).toMatch(/z-index:\s*80/);
    expect(home).toMatch(/isolation:\s*isolate/);
    expect(home).not.toMatch(/transform:\s*translateZ/);
    const detail = rule(cinemaCss, '.v35 .cn-detail-bar');
    expect(detail).toMatch(/position:\s*sticky/);
    expect(detail).toMatch(/pointer-events:\s*auto/);
    expect(detail).toMatch(/z-index:\s*80/);
    expect(detail).not.toMatch(/transform:\s*translateZ/);
    expect(rule(cinemaCss, '.v35 .cn-detail-art')).toMatch(/pointer-events:\s*none/);
    expect(markup).toContain("iconButton('menu', 'القائمة', { act: 'openDrawer' })");
  });

  it('fully removes hidden section menus and scrims from pointer hit testing', () => {
    const hidden = rule(coreCss, '.v35 .section-menu[hidden],\n.v35 .section-scrim[hidden]');
    expect(hidden).toMatch(/display:\s*none\s*!important/);
    expect(hidden).toMatch(/pointer-events:\s*none\s*!important/);
    expect(shell).toContain("menu.hidden = true");
  });
});
