/**
 * العدد مع معدوده بالعربية الصحيحة.
 *
 * «4 مصدر» و«2 فصل» أخطاء يلاحظها كل قارئ عربي. قواعد العدد: واحد بلفظ
 * المفرد، اثنان بالمثنّى، من ثلاثة إلى عشرة بالجمع، ومن أحد عشر فما فوق
 * بالمفرد المنصوب. والأرقام تبقى غربية كما في بقية الواجهة.
 */

const FORMS = {
  chapter: ['فصل واحد', 'فصلان', 'فصول', 'فصلًا'],
  source: ['مصدر واحد', 'مصدران', 'مصادر', 'مصدرًا'],
  work: ['عمل واحد', 'عملان', 'أعمال', 'عملًا'],
  day: ['يوم', 'يومين', 'أيام', 'يومًا'],
  page: ['صفحة واحدة', 'صفحتان', 'صفحات', 'صفحة'],
  new: ['جديد واحد', 'جديدان', 'جديدة', 'جديدًا'],
  friend: ['صديق واحد', 'صديقان', 'أصدقاء', 'صديقًا'],
  op: ['عملية واحدة', 'عمليتان', 'عمليات', 'عملية'],
};

/**
 * @param {number} n
 * @param {keyof typeof FORMS} noun
 */
export function countLabel(n, noun) {
  const [one, two, few, many] = FORMS[noun];
  const count = Math.abs(Math.trunc(n));
  if (count === 0) return `0 ${few}`;
  if (count === 1) return one;
  if (count === 2) return two;
  // المئة والألف وما شابهها تأخذ المفرد: «100 فصل»
  const lastTwo = count % 100;
  if (lastTwo === 0) return `${count} ${noun === 'day' ? 'يوم' : one.split(' ')[0]}`;
  if (lastTwo >= 3 && lastTwo <= 10) return `${count} ${few}`;
  return `${count} ${many}`;
}
