/**
 * عمود جانبي للشاشة العريضة.
 *
 * على الكمبيوتر تُجمع عناصر بعينها (الغلاف، زرّ القراءة، أزرار المكتبة،
 * التقدّم) في <aside> واحد يلتصق بالشاشة مع التمرير، فلا يبقى فراغ بجانب
 * الفصول. على الجوال تعود العناصر لمكانها الأصلي حرفيًا (علامة في موضع كل
 * عنصر)، فترتيب الصفحة وسلوكها هناك لا يتغيّر.
 *
 * العناصر تُنقل ولا تُنسخ: معرّفاتها ومستمعوها كما هي.
 *
 * @param {() => (Element | null)[]} pick
 * @param {{ query?: MediaQueryList | null, className: string, doc?: Document }} opts
 */
export function sideDock(pick, { query, className, doc = globalThis.document }) {
  if (!query || !doc) return { apply() {}, destroy() {} };
  const aside = doc.createElement('aside');
  aside.className = className;
  /** @type {Map<Element, Comment>} */
  const marks = new Map();

  function dock() {
    const nodes = pick().filter(Boolean);
    if (!nodes.length) return;
    for (const node of nodes) {
      const mark = doc.createComment('side-dock');
      node.before(mark);
      marks.set(node, mark);
    }
    marks.get(nodes[0]).before(aside);
    aside.append(...nodes);
  }
  function undock() {
    for (const [node, mark] of marks) mark.replaceWith(node);
    marks.clear();
    aside.remove();
  }
  function apply() {
    if (query.matches && !aside.isConnected) dock();
    else if (!query.matches && aside.isConnected) undock();
  }
  apply();
  query.addEventListener?.('change', apply);
  return {
    apply,
    destroy() {
      query.removeEventListener?.('change', apply);
      undock();
    },
  };
}
