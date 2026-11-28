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

it('a rejected primary cookie write cannot be masked by an accepted side cookie', () => {
  const plugin = kotlin('com/vantara/verification/VerificationPlugin.kt');
  expect(plugin).toMatch(/val imported = if \(value != null\) clearanceWritten else ok/);
  expect(plugin).toMatch(/if \(imported\) finish\("verified", null\) else finish\("failed", "cookie_rejected"\)/);
  expect(plugin).toMatch(/w\.url == "https:\/\/\$\{request\.host\}\/" && w\.header\.startsWith\("cf_clearance="\)/);
  expect(plugin).not.toMatch(/catch \(_: RuntimeException\) \{ if \(ok\) finish\("verified"/);
});

it('missing replacement cannot delete an existing session', () => {
  const plugin = kotlin('com/vantara/verification/VerificationPlugin.kt').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  expect(plugin).toMatch(/if \(item\.kind == "cloudflare" && value == null\) return@post finish\("failed", "unconfirmed"\)/);
  expect(plugin).toMatch(/if \(value == null && pairs\.isEmpty\(\)\) return@post finish\("verified", null\)/);
  expect(plugin).toMatch(/val stale = if \(value == null\) emptyList\(\) else/);
  expect(plugin.indexOf('if (item.kind == "cloudflare" && value == null)')).toBeLessThan(plugin.indexOf('val stale ='));
  expect(plugin).toMatch(/val writes = stale \+ VerificationPolicy\.sessionImport\(/);
});

it('Debug observation does not send extra requests or compete with the original retry', () => {
  const plugin = kotlin('com/vantara/verification/VerificationPlugin.kt');
  expect(plugin).not.toMatch(/VerificationAcceptance\.(?:probe|matrix)\s*\(/);
  expect(plugin).not.toContain('verification-debug-probe');
});

/**
 * بلاغ المالك (Debug 3520): التشخيص يُنسخ والنافذة مفتوحة، فلا يظهر سبب الإغلاق ولا ما جرى للجلسة في المحرك.
 * Debug وحده يحفظ لحظة الإغلاق ومخزن المحرك بعد النقل بلا قيم كوكيز أو طلبات شبكة إضافية.
 */
it('debug evidence covers the close and engine jar without cookie values or extra requests', () => {
  const activity = kotlin('com/vantara/verification/VerificationActivity.kt');
  expect(activity).toMatch(/trace\.note\("close state=\$state/);
  expect(activity).toMatch(/if \(trace != null\) DebugVerificationLog\.start\(/);
  const plugin = kotlin('com/vantara/verification/VerificationPlugin.kt');
  expect(plugin).toMatch(/if \(com\.vantara\.app\.BuildConfig\.DEBUG\) debugEngineEvidence\(/);
  const trace = kotlin('com/vantara/verification/VerificationTrace.kt');
  // الوصف أسماء وأعداد وأعلام فقط
  expect(trace).toMatch(/names=\[\$\{pairs\.joinToString\(","\) \{ it\.substringBefore\('='\) \}/);
  expect(trace).not.toMatch(/append\([^)]*clearances\.first\(\)\)/);
});
