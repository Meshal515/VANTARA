import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// انحدار: ربط CloudStream بالحساب عند الإقلاع قبل قراءة الجلسة كان يفتح مخزن «local» الفارغ،
// فتختفي الإضافات المثبتة من الأقسام حتى تُفتح صفحة الإضافات.
describe('ربط ملف إضافات CloudStream عند الإقلاع', () => {
  it('ينتظر جاهزية الجلسة قبل setProfile', () => {
    const shell = readFileSync(new URL('./shell.js', import.meta.url), 'utf8');
    const boot = shell.slice(shell.indexOf('Plugins?.VantaraRuntime)queueMicrotask'));
    const wait = boot.indexOf('await sync.ready');
    const bind = boot.indexOf("registry.setProfile(sync.user?.userId ?? 'local')");
    expect(wait).toBeGreaterThan(0);
    expect(bind).toBeGreaterThan(wait);
  });
});
