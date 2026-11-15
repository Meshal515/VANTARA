import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';

// بلاغ المالك (14 نوفمبر): صفحة المانجا بالنمط الموحد بقيت فوق الإعدادات وكل صفحة بعدها، لأن قاعدة كمبيوتر أعطت
// #detail «display: grid» فغلبت «display: none» للصفحات غير النشطة. أي قاعدة تُظهر صفحةً (.page) بعينها يجب أن
// تُقيَّد بحالتها (active أو حركة الدخول والخروج)، أو تقابلها قاعدة تخفيها وهي غير نشطة.
const PAGES = ['detail', 'anime', 'cinema', 'home', 'animeCollection', 'settings', 'settingsPane'];
const dir = new URL('./', import.meta.url);
/** فواصل المحدِّد في المستوى الأعلى فقط: الفاصلة داخل :is() أو :not() ليست حدًّا بين محدِّدين. */
const split = (selector) => { const out = []; let depth = 0, cur = ''; for (const ch of selector) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
const css = readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]);

it('no stylesheet shows a page while it is not the active page', () => {
  const leaks = [];
  for (const [file, text] of css) {
    const flat = text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector, body] of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/(^|[;\s])display\s*:\s*(?!none)/.test(body)) continue;
      for (const part of split(selector)) {
        const last = part.trim().split(/[\s>+~]+/).pop() ?? '';
        const page = PAGES.find((id) => new RegExp(`#${id}(?![\\w-])`).test(last));
        if (!page || /active|page-(in|out)|leaving|layer/.test(last)) continue;
        const guarded = css.some(([, t]) => new RegExp(`#${page}\\[[^{]*:not\\(\\.active\\)[^{]*\\{[^}]*display:\\s*none`).test(t.replace(/\/\*[\s\S]*?\*\//g, '')));
        if (!guarded) leaks.push(`${file}: ${part.trim()}`);
      }
    }
  }
  expect(leaks).toEqual([]);
});
