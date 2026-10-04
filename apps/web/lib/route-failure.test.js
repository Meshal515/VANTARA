import { expect, it } from 'vitest';
import * as states from './source-states.js';
it.each([
 ['UPSTREAM_HTTP_403 · mxdrop.top', 'رفض مضيف الفيديو الوصول (403)'],
 ['المضيف ردّ403', 'رفض مضيف الفيديو الوصول (403)'],
 ['RESOLVER_EMPTY: لم يُستخرج رابط فيديو', 'لم يوفر هذا السيرفر رابط فيديو صالحًا'],
 ['الإضافة أعادت HTTP 403', 'الإضافة رفضت الطلب (403)'],
 ['انتهت صلاحية الرابط', 'انتهت صلاحية الرابط'],
])('turns %s into a truthful user-facing message', (reason, message) => {
 expect(states.routeFailureMessage(reason)).toBe(message);
});
