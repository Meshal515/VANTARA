/**
 * ترحيل البيانات المحلية بين الإصدارات (المنصتان).
 *
 * كل ترحيل له رقم، ويعمل مرة واحدة بالترتيب قبل أن تقرأ الواجهة أي بيانات.
 * فشل ترحيل ⇒ يتوقف هنا، والرقم المحفوظ لا يتقدم، والتطبيق يكمل على ما هو
 * (يُعاد المحاولة في الإقلاع التالي). لا ترحيل يمسح بيانات حساب: التغيير
 * يكون متوافقًا للخلف (نسخة أقدم على جهاز آخر تقرأ نفس البيانات من الخادم).
 *
 * لإضافة ترحيل: ارفع `RELEASE.schemaVersion` وأضف `{ version, name, run }` هنا.
 */

import { RELEASE } from './release.js';

const KEY = 'vantara.schema';

/** @type {{ version: number, name: string, run: (storage: Storage) => void }[]} */
export const MIGRATIONS = [
  // 1: خط الأساس — لا تغيير، يثبّت الرقم على الأجهزة الحالية
  { version: 1, name: 'baseline', run: () => {} },
];

export function runMigrations({ storage = globalThis.localStorage, target = RELEASE.schemaVersion, migrations = MIGRATIONS, log = () => {} } = {}) {
  let current = 0;
  try {
    current = Number(storage?.getItem(KEY)) || 0;
  } catch {
    return { from: 0, to: 0, ok: false };
  }
  const from = current;
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= current || m.version > target) continue;
    try {
      m.run(storage);
      current = m.version;
      storage.setItem(KEY, String(current));
    } catch (error) {
      log(`ترحيل ${m.version} (${m.name}) فشل: ${error?.message ?? error}`);
      return { from, to: current, ok: false };
    }
  }
  return { from, to: current, ok: true };
}
