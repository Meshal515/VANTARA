/**
 * محرك القارئ المشترك: الفصل الجاهز على الجهاز يُقرأ من مخزن التنزيلات أينما فُتح (المكتبة، البحث،
 * التحديثات)، والباقي من مصدره (`downloads/offline-engine.js`).
 *
 * كائن واحد للتطبيق بقصد: كاش القارئ (قوائم الصفحات والصور) لكل محرك، فتجهيز صفحة العمل للفصل التالي
 * (`warmChapter`) والقارئ نفسه يجب أن يمرّا بالكائن نفسه وإلا ضاع التجهيز.
 */
import engine from './extension-engine.js';
import { withDownloads } from './downloads/offline-engine.js';

export const readerEngine = withDownloads(engine, () => import('./downloads/index.js').then((m) => m.downloads()));
