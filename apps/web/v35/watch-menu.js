/**
 * ⋮ بطاقات «آخر المشاهدات» في الأنمي والسينما: زر صغير بجانب الاسم يفتح ورقة
 * بنفس بنود أوراق التطبيق (`sheet-item`): المفضلة، القائمة، والحذف من السجل.
 * البطاقة نفسها كما هي؛ الزر وحده جديد، ولمسه لا يفتح العمل.
 */
import { glyph } from './icons.js';

/**
 * بنود الورقة بترتيبها. `favorite: null` = لا مفضلة هنا (ضيف في الأنمي).
 * @param {{ favorite?: boolean|null, list: { on: boolean, name: string } }} s
 */
export function watchMenuItems({ favorite = null, list }) {
  const items = [];
  if (favorite !== null) items.push({ key: 'favorite', icon: 'heart', label: favorite ? 'في المفضلة — أزله منها' : 'إضافة إلى المفضلة', pressed: favorite });
  items.push({ key: 'list', icon: list.on ? 'check' : 'plus', label: list.on ? `في «${list.name}» — أزله منها` : `إضافة إلى «${list.name}»`, pressed: list.on });
  items.push({ key: 'remove', icon: 'trash', label: 'حذف من آخر المشاهدات', danger: true });
  return items;
}

/** يفتح الورقة؛ كل بند يغلقها ثم ينفّذ فعله من `actions[key]`. */
export function openWatchMenu({ openSheet, closeSheet, el, title, tone, items, actions }) {
  openSheet((body) => {
    const heading = el('h3', null, title);
    heading.dir = 'auto';
    body.append(heading);
    for (const it of items) {
      const b = el('button', `sheet-item${it.danger ? ' sheet-item--danger' : ''}`);
      b.type = 'button';
      b.dataset.key = it.key;
      b.innerHTML = glyph(it.icon, { filled: Boolean(it.pressed) });
      b.append(el('span', null, it.label));
      if (it.pressed !== undefined) b.setAttribute('aria-pressed', String(Boolean(it.pressed)));
      b.onclick = () => {
        closeSheet();
        actions[it.key]?.();
      };
      body.append(b);
    }
  }, { tone });
}

/** زر ⋮: لا يصل لمسه للبطاقة (فلا يفتح العمل). */
export function moreButton(el, onOpen, label = 'خيارات') {
  const b = el('button', 'cw-more');
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.innerHTML = glyph('more', { size: 18 });
  const stop = (ev) => ev.stopPropagation();
  b.addEventListener('pointerdown', stop);
  b.onclick = (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    onOpen();
  };
  return b;
}

/** بطاقة تُلمس كزر وفيها زر آخر: `div` بدور زر (زر داخل زر لا يصح). */
export function asButton(node, label) {
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  if (label) node.setAttribute('aria-label', label);
  node.addEventListener('keydown', (ev) => {
    if (ev.target !== node || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    ev.preventDefault();
    node.click();
  });
  return node;
}
