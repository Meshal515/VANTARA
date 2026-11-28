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
