/**
 * أدوات قراءة HTML للمحركات. المتصفح يحلّل بـDOMParser الأصلي (سريع ومجاني)؛
 * والاختبارات تحقن محلّلًا بديلًا (linkedom) عبر `setParser`.
 *
 * الروابط تُحلّ يدويًا بـ`new URL(attr, base)`: مستند DOMParser عنوانه
 * about:blank، فخاصية `a.href` لا تُحلّ الرابط النسبي على موقع المصدر.
 */

let parser = null;

/** للاختبارات: `(html) => Document`. */
export function setParser(fn) {
  parser = fn;
}

export function parseHtml(html) {
  if (parser) return parser(String(html ?? ''));
  return new DOMParser().parseFromString(String(html ?? ''), 'text/html');
}

export function parseXml(xml) {
  if (parser) return parser(String(xml ?? ''), 'text/xml');
  return new DOMParser().parseFromString(String(xml ?? ''), 'text/xml');
}

export const q = (root, selector) => {
  try {
    return root?.querySelector(selector) ?? null;
  } catch {
    return null;
  }
};

export const qa = (root, selector) => {
  try {
    return root ? [...root.querySelectorAll(selector)] : [];
  } catch {
    return [];
  }
};

/** النص بمسافات موحّدة (مثل `Element.text()` في Jsoup). */
export function text(el) {
  return String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** نص العنصر نفسه بلا نصوص أبنائه (`ownText()` في Jsoup). */
export function ownText(el) {
  if (!el) return '';
  let out = '';
  for (const node of el.childNodes ?? []) if (node.nodeType === 3) out += node.textContent;
  return out.replace(/\s+/g, ' ').trim();
}

export function attr(el, name) {
  return el?.getAttribute?.(name)?.trim() ?? '';
}

export function resolve(ref, base) {
  if (!ref) return '';
  try {
    return new URL(ref, base).toString();
  } catch {
    return '';
  }
}

/** `abs:attr` في Jsoup. */
export function absAttr(el, name, base) {
  return resolve(attr(el, name), base);
}

/** المسار مع الاستعلام: يبقى صالحًا إن تغيّر دومين المصدر. */
export function pathOf(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return '';
  }
}

/** أكبر صورة في srcset. */
export function srcsetBest(value, base) {
  const candidates = String(value ?? '')
    .split(',')
    .map((part) => part.trim().split(/\s+/))
    .filter(([u]) => u);
  let best = null;
  let bestSize = -1;
  for (const [u, d] of candidates) {
    const size = parseFloat(String(d ?? '').replace(/[wx]$/, '')) || 0;
    if (size >= bestSize) {
      best = u;
      bestSize = size;
    }
  }
  return best ? resolve(best, base) : '';
}

/** رابط صورة كسولة كما تفعل محركات Keiyoushi (`imageFromElement`). */
export function imageOf(img, base) {
  if (!img) return '';
  for (const name of ['data-src', 'data-lazy-src', 'data-lzl-src', 'data-cfsrc', 'data-manga-src', 'data-original']) {
    if (img.hasAttribute?.(name) && attr(img, name)) return absAttr(img, name, base);
  }
  if (img.hasAttribute?.('srcset') && attr(img, 'srcset')) return srcsetBest(attr(img, 'srcset'), base);
  return absAttr(img, 'src', base);
}

/** أرقام عربية/فارسية ⇒ لاتينية. */
export function foldDigits(s) {
  return String(s ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** أول رقم في النص («الفصل ١٢.٥» ⇒ 12.5)، وإلا -1. */
export function firstNumber(s) {
  const m = foldDigits(s).match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : -1;
}
