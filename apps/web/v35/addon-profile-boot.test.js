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

describe('فتح مدير الإضافات (UX06 وUX10)', () => {
  const body = (() => { const s = readFileSync(new URL('./shell.js', import.meta.url), 'utf8'); const i = s.indexOf('async function openAddons()'); return s.slice(i, s.indexOf('async function openNativeAddonSource', i)); })();
  it('لا انتظار بين آخر فحص للجيل ورسم المدير', () => {
    const render = body.indexOf('addonHubView = renderAddonsHub(');
    const lastGuard = body.lastIndexOf('if(run!==addonViewGeneration', render);
    expect(lastGuard).toBeGreaterThan(-1);
    expect(body.slice(lastGuard, render)).not.toMatch(/\bawait\b/);
    // الوسائط نفسها لا تنتظر شيئًا (الانتظار داخل onSourcesChanged لاحق لا يخص الرسم)
    expect(body.slice(render, body.indexOf('\n', render))).not.toMatch(/cloudstreamRepositories: await/);
  });
  it('الفشل يعرض زر إعادة محاولة يعيد فتح المدير', () => {
    const fail = body.slice(body.lastIndexOf('} catch'));
    expect(fail).toContain('إعادة المحاولة');
    expect(fail).toContain('openAddons()');
  });
});
