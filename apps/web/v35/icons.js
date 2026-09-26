/**
 * عائلة أيقونات VANTARA — مصدر واحد لكل رمز في الواجهة.
 *
 * القواعد التي تجعلها عائلة لا مجموعة:
 *   - شبكة 24 وهامش 2: الرسم يسكن المربع 2..22، فتتساوى الأوزان البصرية.
 *   - خط 1.75 بأطراف ووصلات مدوّرة، ولا تعبئة — إلا حالة «مفعّل» لمفتاحٍ
 *     ثنائي (المفضلة، المكتبة، المقروء): التعبئة هناك تقول «هذا عليك» بلا نص.
 *   - الاتجاه عربي: «رجوع» يشير يمينًا و«ادخل» يسارًا، كما في أندرويد RTL.
 *   - لا رموز تعبيرية ولا Unicode: شكلها يتغيّر بين الأنظمة ولونها لا يُضبط.
 *
 * `glyph()` نصٌّ لقوالب HTML، و`glyphNode()` عقدة جاهزة للـDOM.
 */

const P = {
  // ── التنقّل ──
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  back: '<path d="m9 5.5 6.5 6.5L9 18.5"/>',
  chevron: '<path d="m15 5.5-6.5 6.5 6.5 6.5"/>',
  chevronDown: '<path d="m5.5 9 6.5 6.5L18.5 9"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  home: '<path d="M4 10.4 12 4l8 6.4V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1Z"/>',
  library: '<path d="M7 3.8h10a1 1 0 0 1 1 1v15.4l-6-3.9-6 3.9V4.8a1 1 0 0 1 1-1Z"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.3 8.7-2.1 4.5-4.5 2.1 2.1-4.5Z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4.6 1.9 6 1.9 6H4.6s1.9-1.4 1.9-6Z"/><path d="M10 19.3a2.2 2.2 0 0 0 4 0"/>',
  // أعضاء المجلس: ثلاثة، الأوسط أقرب — رمز المجلس نفسه لا «مستخدمون» عامة
  members:
    '<circle cx="12" cy="8.2" r="3.1"/><path d="M6.6 19.4c.5-3.3 2.5-5.1 5.4-5.1s4.9 1.8 5.4 5.1"/><circle cx="5.3" cy="10.3" r="2.2" opacity=".7"/><path d="M2.4 17.6c.3-2 1.4-3.2 3.1-3.5" opacity=".7"/><circle cx="18.7" cy="10.3" r="2.2" opacity=".7"/><path d="M21.6 17.6c-.3-2-1.4-3.2-3.1-3.5" opacity=".7"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.5-3.4 2.4-5.2 5.5-5.2s5 1.8 5.5 5.2"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17 14.5c2 .5 3.2 2.1 3.5 5"/>',
  user: '<circle cx="12" cy="8.3" r="3.6"/><path d="M5.5 20c.6-4 2.8-6 6.5-6s5.9 2 6.5 6"/>',
  activity: '<path d="M3 12h3.6l2.2-5.5 4.4 11 2.2-5.5H21"/>',
  spark: '<path d="M12 3.5 14 10l6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2Z"/>',
  switchUser: '<path d="M16.5 3.5 20 7l-3.5 3.5M20 7H8.5M7.5 20.5 4 17l3.5-3.5M4 17h11.5"/>',
  settings:
    '<path d="M18.89 9.92 21 10.17v3.66l-2.11.25-.55 1.33 1.33 1.67-2.59 2.59-1.67-1.33-1.33.55-.25 2.11h-3.66l-.25-2.11-1.33-.55-1.67 1.33-2.59-2.59 1.33-1.67-.55-1.33L3 13.83v-3.66l2.11-.25.55-1.33-1.33-1.67 2.59-2.59 1.67 1.33 1.33-.55L10.17 3h3.66l.25 2.11 1.33.55 1.67-1.33 2.59 2.59-1.33 1.67Z"/><circle cx="12" cy="12" r="3"/>',
  server: '<rect x="4" y="4.5" width="16" height="6" rx="1.5"/><rect x="4" y="13.5" width="16" height="6" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  flame: '<path d="M12 20.5c3.3 0 5.8-2.4 5.8-5.7 0-3.6-2.6-5.4-3.6-8.8-1.1 1.4-1.5 2.8-1.4 4.3-1.4-.9-2.6-3.3-2.3-6.8C7.7 6 6.2 9.8 6.2 14.8c0 3.3 2.5 5.7 5.8 5.7Z"/>',
  star: '<path d="m12 3.8 2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5 2.7.9-5.6-4-4 5.6-.8Z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.7"/><path d="M4 4.5v4.2h4.2"/><path d="M12 8v4l2.8 1.8"/>',

  // ── الأفعال ──
  share: '<circle cx="17.5" cy="5.8" r="2.3"/><circle cx="6.5" cy="12" r="2.3"/><circle cx="17.5" cy="18.2" r="2.3"/><path d="m8.5 10.9 7-4M8.5 13.1l7 4"/>',
  heart: '<path d="M12 19.8 4.6 12.6a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 0 1 6.5 6.5Z"/>',
  more: '<circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 8.5V6.2A1.7 1.7 0 0 0 13.8 4.5H6.2A1.7 1.7 0 0 0 4.5 6.2v7.6a1.7 1.7 0 0 0 1.7 1.7h2.3"/>',
  edit: '<path d="M4.5 19.5h3.8L18.7 9.1a2.7 2.7 0 0 0-3.8-3.8L4.5 15.7Z"/><path d="m13.5 6.8 3.7 3.7"/>',
  trash: '<path d="M4.5 7h15M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7M6.5 7l.8 11.8A2 2 0 0 0 9.3 20.7h5.4a2 2 0 0 0 2-1.9L17.5 7M10.3 10.8v6M13.7 10.8v6"/>',
  filter: '<path d="M4 5.5h16l-6.2 7.2v5.6l-3.6 1.7v-7.3Z"/>',
  sort: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
  refresh: '<path d="M19.5 12A7.5 7.5 0 1 1 17.3 6.7"/><path d="M19.5 4v4.3h-4.3"/>',
  send: '<path d="M20.5 3.5 10.8 13.2M20.5 3.5l-6.2 17-3.5-7.3-7.3-3.5Z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.8h.01"/>',
  flag: '<path d="M5.5 20.5V4.5M5.5 4.5h11l-2.2 4.2 2.2 4.3h-11"/>',
  logout: '<path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4"/><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15"/>',
  camera: '<path d="M4 8.7c0-.9.7-1.7 1.6-1.7h2.2l1.5-2.2h5.4L16.2 7h2.2c.9 0 1.6.8 1.6 1.7v8.6c0 .9-.7 1.7-1.6 1.7H5.6c-.9 0-1.6-.8-1.6-1.7Z"/><circle cx="12" cy="12.9" r="3.3"/>',
  image: '<rect x="4" y="4.5" width="16" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.6"/><path d="m4.5 17 4.8-4.6 3.4 3.1 2.6-2.4 4.2 3.9"/>',
  upload: '<path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M5 20h14"/>',
  crop: '<path d="M7 3.5V17h13.5M3.5 7H17v13.5"/>',

  // ── القراءة ──
  book: '<path d="M12 6.8c-1.8-1.5-4.3-2.2-8-2v12.6c3.7-.2 6.2.5 8 2 1.8-1.5 4.3-2.2 8-2V4.8c-3.7-.2-6.2.5-8 2Z"/><path d="M12 6.8v12.6"/>',
  eye: '<path d="M2.8 12S6.2 5.8 12 5.8s9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.7"/>',
  sliders: '<path d="M4 7.5h8.5M16.5 7.5H20M4 16.5h3.5M11.5 16.5H20"/><circle cx="14.5" cy="7.5" r="2"/><circle cx="9.5" cy="16.5" r="2"/>',
  scroll: '<rect x="6.5" y="3.5" width="11" height="17" rx="2"/><path d="M6.5 9.5h11M6.5 14.5h11"/>',
  pages: '<rect x="3.5" y="5" width="7.5" height="14" rx="1.5"/><rect x="13" y="5" width="7.5" height="14" rx="1.5"/>',
  fitWidth: '<path d="M4 5v14M20 5v14M7.5 12h9M10 9.5 7.5 12l2.5 2.5M14 9.5l2.5 2.5-2.5 2.5"/>',
  fitHeight: '<path d="M5 4h14M5 20h14M12 7.5v9M9.5 10 12 7.5l2.5 2.5M9.5 14l2.5 2.5 2.5-2.5"/>',
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4M11 8.3v5.4M8.3 11h5.4"/>',
  gap: '<rect x="5" y="3.5" width="14" height="6.5" rx="1.5"/><rect x="5" y="14" width="14" height="6.5" rx="1.5"/>',
  layers: '<path d="M12 4 20.5 8.5 12 13 3.5 8.5Z"/><path d="m3.5 12.8 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5" opacity=".55"/>',
  translate: '<path d="M4 5.5h9M8.5 3.5v2M6 5.5c.6 3.3 2.7 6 6 7.5M11 5.5c-.7 3.6-3.3 6.6-7 8"/><path d="m12.5 20.5 4-9.5 4 9.5M14 17h5"/>',
  // فقاعتان: «A» الأصل و«ع» العربي — زرّ الترجمة في القارئ
  translateAr:
    '<path d="M3 5.2A2.2 2.2 0 0 1 5.2 3h6.6A2.2 2.2 0 0 1 14 5.2v4.6a2.2 2.2 0 0 1-2.2 2.2H8.6L5.5 14.5V12h-.3A2.2 2.2 0 0 1 3 9.8Z"/>' +
    '<path d="m6.6 9.6 1.9-4.6 1.9 4.6M7.3 8.1h2.4"/>' +
    '<path d="M16.5 9.5h2.3a2.2 2.2 0 0 1 2.2 2.2v4.6a2.2 2.2 0 0 1-2.2 2.2h-.3v2.5l-3.1-2.5h-3.2a2.2 2.2 0 0 1-2.2-2.2v-1.8"/>' +
    '<text x="15.4" y="17.3" font-size="7.2" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui, sans-serif">ع</text>',
  skipNext: '<path d="M16 6.5 9.5 12l6.5 5.5Z"/><path d="M7.5 6.5v11"/>',
  skipPrev: '<path d="m8 6.5 6.5 5.5L8 17.5Z"/><path d="M16.5 6.5v11"/>',

  // ── الحالة ──
  alert: '<path d="M12 4.2 20.6 19H3.4Z"/><path d="M12 10v4M12 16.6h.01"/>',
  offline: '<path d="M4 4l16 16"/><path d="M8.7 8.7A4.6 4.6 0 0 0 7 12.5a3.5 3.5 0 0 0 .5 7h9.8M18.8 15.3A3.4 3.4 0 0 0 17 9.7a5.5 5.5 0 0 0-7.1-3.4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.3 10.5V8a3.7 3.7 0 0 1 7.4 0v2.5"/>',
  shield: '<path d="M12 3.5 19 6.2v5.3c0 4.2-2.8 7.4-7 8.9-4.2-1.5-7-4.7-7-8.9V6.2Z"/>',
  puzzle:
    '<path d="M3.6 8.9a1.5 1.5 0 0 1 1.5-1.5h3.5a2.2 2.2 0 1 1 3 0h3.5a1.5 1.5 0 0 1 1.5 1.5v3.5a2.2 2.2 0 1 1 0 3v3.5a1.5 1.5 0 0 1-1.5 1.5h-10a1.5 1.5 0 0 1-1.5-1.5Z"/>',
  // التشغيل: مثلث بزوايا مدوّرة، مزاح قليلًا ليبدو في المنتصف بصريًا
  pause: '<rect x="7" y="5.5" width="3.4" height="13" rx="1"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1"/>',
  play: '<path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6Z"/>',
};

/** رموزٌ لها حالة «مفعّل» تُملأ فيها بدل أن تُحدَّد. */
const FILLABLE = new Set(['heart', 'library', 'star', 'bell', 'play', 'pause']);

/**
 * @param {keyof typeof P} name
 * @param {{ size?: number, filled?: boolean, cls?: string }} [opts]
 */
export function glyph(name, { size = 22, filled = false, cls = 'icon', id } = {}) {
  const body = P[name] ?? P.info;
  const fill = filled && FILLABLE.has(name) ? 'currentColor' : 'none';
  return (
    `<svg${id ? ` id="${id}"` : ''} class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" ` +
    `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/** نفسها عقدةً. */
export function glyphNode(name, opts) {
  const t = document.createElement('template');
  t.innerHTML = glyph(name, opts);
  return /** @type {SVGElement} */ (t.content.firstElementChild);
}

/**
 * زرّ أيقونة: الاسم للوصول (`aria-label`) وللتلميح على سطح المكتب (`title`).
 * النص لا يُكرَّر بجانب الرمز — الاسم يُقرأ ولا يُرى.
 */
export function iconButton(name, label, { cls = 'icon-btn', size = 22, act, arg, filled } = {}) {
  const attrs = [`class="${cls}"`, 'type="button"', `aria-label="${label}"`, `title="${label}"`];
  if (act) attrs.push(`data-act="${act}"`);
  if (arg !== undefined) attrs.push(`data-arg="${arg}"`);
  return `<button ${attrs.join(' ')}>${glyph(name, { size, filled })}</button>`;
}

export const GLYPH_NAMES = Object.freeze(Object.keys(P));
