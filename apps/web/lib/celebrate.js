/**
 * احتفال التحديث الكبير: شاشة واحدة، مرة واحدة لكل إصدار موسوم `celebrate` في lib/release.js،
 * بعد الدخول. لا تعود بعد إغلاقها ولا تظهر لمن رآها على هذا الجهاز.
 */
import { releaseNotesFor } from './release.js';

const KEY = 'vantara.celebrated.v1';

/** الإصدار الذي يستحق الاحتفال الآن على هذه المنصة، أو null. */
export function celebrationFor(platform, storage = globalThis.localStorage, releases) {
  const [latest] = releaseNotesFor(platform, releases);
  if (!latest?.celebrate) return null;
  let seen = null;
  try {
    seen = storage?.getItem(KEY) ?? null;
  } catch {
    // تخزين محجوب: نعرض مرة ولا نعيد في نفس الجلسة (يحرسها المستدعي)
  }
  return seen === latest.version ? null : latest;
}

export function markCelebrated(version, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, version);
  } catch {
    // لا يمنع الإغلاق
  }
}

/** شاشة الاحتفال نفسها (بلا ربط): الشعار بتوهج، رقم الإصدار، العنوان، البنود، وزر واحد. */
export function buildCelebration(doc, release, glyph) {
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const layer = el('div', 'vcele');
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-labelledby', 'vcele-title');
  const card = el('div', 'vcele__card');
  const mark = el('div', 'vcele__mark');
  const logo = el('img');
  logo.src = '/icons/logo-mark.png';
  logo.alt = 'VANTARA';
  logo.decoding = 'async';
  mark.append(logo);
  const chip = el('span', 'vcele__chip', `VANTARA ${release.version}`);
  chip.dir = 'ltr';
  const title = el('h2', 'vcele__title', release.celebrate?.headline ?? '');
  title.id = 'vcele-title';
  const list = el('ul', 'vcele__list');
  release.items.forEach((item, i) => {
    const li = el('li', 'vcele__item');
    li.style.setProperty('--i', String(i));
    const ic = el('span', 'vcele__icon');
    ic.innerHTML = glyph(item.icon ?? 'spark', { size: 20 });
    const text = el('span', 'vcele__text');
    text.append(el('strong', null, item.title ?? ''), el('span', null, item.text));
    li.append(ic, text);
    list.append(li);
  });
  const button = el('button', 'vcele__go', 'يلا نبدأ');
  button.type = 'button';
  card.append(mark, chip, title, el('p', 'vcele__sub', release.celebrate?.sub ?? ''), list, button);
  layer.append(card);
  return { layer, button };
}
