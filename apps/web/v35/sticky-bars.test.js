import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
/** قواعد المحدد كما هي (بلا فك CSS كامل): نص الكتلة بعد المحدد حتى أول «}». */
const block = (text, selector) => [...text.matchAll(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(';');

describe('قوائم لا تلحق القارئ عند التمرير (قرار المالك)', () => {
  it('فلتر الأنواع في الرئيسية الموحدة يمرّ مع الصفحة', () => {
    expect(block(css('./unified-view.css'), '.v35 .uv-tabs')).not.toMatch(/sticky|fixed/);
    expect(css('./unified-view.css')).not.toMatch(/\.uv-tabs\{[^}]*sticky/);
  });
  it('رأس ومرشّحات ورقة السيرفرات تمرّ مع القائمة', () => {
    expect(block(css('./server-sheet.css'), '.v35 .ss-tools')).not.toMatch(/sticky|fixed/);
  });
});
