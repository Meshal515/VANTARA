import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const kotlin = (p) => readFileSync(fileURLToPath(new URL(`../../../android/app/src/main/kotlin/${p}`, import.meta.url)), 'utf8');

/**
 * انحدار Stable 226 (المرجع Stable 224): صفحة التحقق الظاهرة غيّرت علامة Sec-CH-UA إلى «Google Chrome» وبقية بصمة
 * WebView تقول «Android WebView»، فأعاد Turnstile المربع بلا نهاية (المؤشر يدور ثم يعود). الصفحة الظاهرة لا تغيّرها.
 */
it('the visible verification page never overrides the WebView client-hint brand', () => {
  expect(kotlin('com/vantara/verification/VerificationActivity.kt')).not.toMatch(/alignUserAgentMetadata\s*\(/);
  // المحلّل الصامت كما كان قبل 224
  expect(kotlin('eu/kanade/tachiyomi/network/interceptor/CloudflareInterceptor.kt')).toMatch(/setMatchingUserAgentMetadata\(view, userAgent\)/);
});

/**
 * انحدار Debug بعد 224: «صفحة بلا تحدٍّ» شرطًا للإغلاق، وCloudflare يضع challenge-platform في الصفحات العادية، فلا تُغلق
 * النافذة أبدًا؛ وبوابات no_clearance/cookie_scope_mismatch/فحص القبول ترفض تحققًا ناجحًا. المرجع 224.
 */
it('the window completes on a new cf_clearance and the plugin does not reject a completed check (Stable 224 rules)', () => {
  const activity = kotlin('com/vantara/verification/VerificationActivity.kt');
  expect(activity).toMatch(/clearance != null && \(clearance != initialClearance \|\| pageReady\)/);
  expect(activity).not.toMatch(/if \(clearance != null && pageReady\)/);
  const plugin = kotlin('com/vantara/verification/VerificationPlugin.kt').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const gate of ['no_clearance', 'cookie_scope_mismatch', 'no_session_cookie', 'confirm(item, call)']) expect(plugin).not.toContain(gate);
});

/**
 * انحدار Debug 3513: «تم» فورًا بلا صفحة Cloudflare. حذف cf_clearance القديم قبل التحميل ثم تصفير المرجع
 * (initialClearance = null) جعل الكوكي القديم، حين لم يُحذف فعلًا، «جديدًا» من أول فحص. وقراءة مضيف الهبوط أولًا قارنت
 * كوكي مضيف بمرجع مضيف آخر. المرجع 224: لا حذف ولا تصفير، ومضيف الطلب أولًا.
 */
it('the old clearance is the reference, read from the request host first (Stable 224)', () => {
  const code = kotlin('com/vantara/verification/VerificationActivity.kt').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  expect(code).not.toMatch(/initialClearance\s*=\s*null/);
  expect(code).not.toMatch(/cf_clearance=;/);
  expect(code).toMatch(/initialClearance\s*=\s*VerificationPolicy\.clearance\(selectedCookies\?\.getCookie\(current\.origin\s*\+\s*"\/"\)\)/);
  expect(code).toMatch(/fun clearanceNow\(origin: String\): String\? =\s*VerificationPolicy\.clearance\(selectedCookies\?\.getCookie\("\$origin\/"\)\)\s*\?: landed/);
});

it('one rejected side cookie does not fail a completed check (Stable 224)', () => {
  const plugin = kotlin('com/vantara/verification/VerificationPlugin.kt');
  expect(plugin).not.toMatch(/else finish\("failed", "cookie_rejected"\) \}/);
  expect(plugin).toMatch(/if \(ok \|\| \(value == null && pairs\.isEmpty\(\)\)\) finish\("verified", null\) else finish\("failed", "cookie_rejected"\)/);
});

/**
 * «الموقع لم يقبل التحقق بعد» بعد تحقق نجح (Debug 3518): نسخ Debug سابقة كتبت cf_clearance على جذر الموقع
 * (Domain=.site) سبعة أيام، والاستيراد الحالي لا يحذفه، فيرسل المحرك الكوكيين بالاسم نفسه والقديم أولًا.
 */
it('the engine jar loses every old cf_clearance scope before the new one is written', () => {
  const plugin = kotlin('com/vantara/verification/VerificationPlugin.kt').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  expect(plugin).toMatch(/"cf_clearance=; Domain=\.\$it; Path=\/; Max-Age=0"/);
  expect(plugin).toMatch(/"cf_clearance=; Path=\/; Max-Age=0"/);
  expect(plugin).toMatch(/val writes = stale \+ VerificationPolicy\.sessionImport\(/);
  // الحذف يسبق كل كتابة ولا ينتظر وجود كوكي جديد
  expect(plugin.indexOf('val stale')).toBeLessThan(plugin.indexOf('fun write('));
  expect(plugin).not.toMatch(/if \(value == null && pairs\.isEmpty\(\)\) return@post finish/);
});
