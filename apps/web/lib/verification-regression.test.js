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
