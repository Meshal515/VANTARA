/**
 * مركز الإعدادات: صفحة رئيسية لفئات، وكل فئة تفتح صفحة خياراتها وحدها (`settingsPane` بنظام
 * الصفحات نفسه). الخيارات القديمة كلها باقية بمفاتيحها؛ هنا ترتيبها فقط، و«المظهر والتخصيص» كاملة.
 */

import { ACCENTS, BRAND_DEFAULT, brandOf, readAppearance, stylesOf, workStyleOf } from './appearance.js';
import { modeOf, readStructure, setUnifyContent, setUnifyScreens, TEMPLATES, writeStructure } from './experience.js';
import { homePreview, previewPicture, workPreview } from './look-previews.js';

/** الفئات بترتيب المالك. `groups`: مجموعات الإعدادات القديمة التي انتقلت إليها (للاختبار والتوثيق). */
export const CATEGORIES = Object.freeze([
  { id: 'appearance', icon: 'palette', title: 'المظهر والتخصيص', sub: 'البطاقات والألوان وبنية العرض', groups: ['المظهر'] },
  { id: 'accounts', icon: 'switchUser', title: 'الحسابات والخوادم', sub: 'تبديل الحساب واعتماد جوال جديد', groups: ['الحساب'] },
  { id: 'playback', icon: 'play', title: 'التشغيل والترجمة', sub: 'الترجمة العربية وملفاتها', groups: ['الترجمة', 'ملفات الترجمة على الجوال'] },
  { id: 'addons', icon: 'puzzle', title: 'المستودعات والإضافات', sub: 'مصادر المحتوى التي أضفتها', groups: [] },
  { id: 'privacy', icon: 'lock', title: 'الخصوصية والتخزين', sub: 'رمز PIN وما يراه أصدقاؤك والتنبيهات', groups: ['الخصوصية', 'ما يراه أصدقاؤك', 'ما تراه أنت', 'التنبيهات', 'المحتوى'] },
  { id: 'sync', icon: 'refresh', title: 'المزامنة والنسخ الاحتياطي', sub: 'حالة المزامنة والمزامنة الآن', groups: ['حالة المزامنة'] },
  { id: 'advanced', icon: 'settings', title: 'الإعدادات المتقدمة', sub: 'أدوات Debug والواجهة الأصلية ومنطقة الخطر', groups: ['أدوات Debug', 'الواجهة الأصلية', 'فحص المصادر', 'منطقة الخطر'] },
]);
export const categoryOf = (id) => CATEGORIES.find((c) => c.id === id) ?? null;

export const SECTION_NAMES = Object.freeze({ manga: 'المانجا', anime: 'الأنمي', cinema: 'السينما' });

/**
 * بطاقة «المظهر والتخصيص» في رأس الفئات: الأقسام الثلاثة بلقطاتها الحقيقية وألوانها الحالية،
 * فتُرى الواجهة قبل أن تُفتح. مقاس اللقطات محجوز (aspect-ratio) فلا تقفز البطاقة.
 */
export function appearanceFeature({ el, glyph }, run, storage) {
  const doc = globalThis.document;
  const look = readAppearance(storage);
  const mode = modeOf(readStructure(storage));
  const c = categoryOf('appearance');
  const b = el('button', 'settings-feature');
  b.type = 'button';
  b.onclick = run;
  const shots = el('span', 'settings-feature-shots');
  shots.setAttribute('aria-hidden', 'true');
  for (const section of ['manga', 'anime', 'cinema']) {
    const f = el('span', 'look-frame');
    f.append(previewPicture(doc, (vp) => homePreview(section, vp), ''));
    const hex = ACCENTS.find((x) => x.id === look.accent?.[section])?.hex;
    if (hex) f.style.setProperty('--sw', hex);
    shots.append(f);
  }
  const text = el('span', 'settings-feature-text');
  text.append(el('strong', null, c.title), el('small', null, { independent: 'كل قسم بشاشته', screens: 'شاشات موحّدة', content: 'محتوى موحّد' }[mode]));
  b.append(shots, text);
  b.insertAdjacentHTML('beforeend', glyph('chevron', { cls: 'icon chev' }));
  return b;
}

/**
 * صفحة «المظهر والتخصيص».
 * @param {HTMLElement} body
 * @param {{ el: Function, glyph: Function, openSheet: Function, closeSheet: Function, toast: Function,
 *   patchAppearance: Function, apply: Function, rerender: Function, storage?: Storage }} ctx
 */
export function renderAppearancePane(body, ctx) {
  const { el, glyph, openSheet, closeSheet } = ctx;
  const doc = body.ownerDocument ?? globalThis.document;
  const look = readAppearance(ctx.storage);
  const structure = readStructure(ctx.storage);
  const saveLook = (change) => {
    ctx.patchAppearance(change);
    ctx.apply();
    ctx.rerender();
  };
  const saveStructure = (next) => {
    writeStructure(next, ctx.storage);
    ctx.apply();
    ctx.rerender();
  };

  const head = (eyebrow, title, intro) => {
    const h = el('div', 'settings-group-label');
    const eb = el('span', 'settings-eyebrow', eyebrow);
    eb.dir = 'ltr';
    h.append(eb, el('span', 'settings-title', title));
    body.append(h);
    if (intro) body.append(el('p', 'look-intro', intro));
  };
  const tile = ({ pathOf, alt, title, sub, onClick, disabled = false, pressed = null, chip = null, badge = null }) => {
    const b = el('button', 'look-tile');
    b.type = 'button';
    if (pressed !== null) b.setAttribute('aria-pressed', String(pressed));
    if (disabled) b.disabled = true;
    else if (onClick) b.onclick = onClick;
    const frame = el('span', 'look-frame');
    frame.append(previewPicture(doc, pathOf, alt));
    if (badge) frame.append(el('span', 'look-badge', badge));
    const text = el('span', 'look-tile-text');
    const t = el('strong', null, title);
    text.append(t);
    if (chip) {
      const c = el('i', 'look-chip');
      c.style.setProperty('--sw', chip);
      t.prepend(c);
    }
    if (sub) text.append(el('small', null, sub));
    b.append(frame, text);
    return b;
  };
  const tiles = (cls = '') => el('div', `look-tiles${cls ? ` ${cls}` : ''}`);

  // ── بطاقات الأعمال: نمط صفحة العمل لكل قسم، مستقل عن غيره ──
  head('CARDS', 'بطاقات الأعمال', 'تصميم صفحة العمل لكل قسم على حدة.');
  const cards = tiles();
  for (const section of ['manga', 'anime', 'cinema']) {
    const list = stylesOf(section);
    const current = list.find((s) => s.id === workStyleOf(section, look)) ?? list[0];
    const soon = list.length === 1 && current.soon;
    cards.append(tile({
      pathOf: (vp) => workPreview(section, current.id, vp),
      alt: `صفحة عمل ${SECTION_NAMES[section]}: ${current.name}`,
      title: SECTION_NAMES[section],
      sub: soon ? 'قريبًا' : current.name,
      disabled: soon,
      badge: soon ? 'قريبًا' : null,
      onClick: () => openSheet((sheet) => {
        sheet.append(el('h3', null, `صفحة عمل ${SECTION_NAMES[section]}`));
        const grid = el('div', 'look-options');
        for (const s of list) {
          const on = s.id === current.id;
          const opt = tile({
            pathOf: (vp) => workPreview(section, s.id, vp),
            alt: `${s.name}: ${s.note}`,
            title: s.name,
            sub: s.note,
            pressed: on,
            onClick: () => {
              closeSheet();
              if (!on) saveLook((a) => ({ style: { ...a.style, [section]: s.id } }));
            },
          });
          grid.append(opt);
        }
        sheet.append(grid);
      }),
    }));
  }
  body.append(cards);

  // ── ألوان الأقسام: لقطة رئيسية كل قسم، ولونه المختار ──
  head('COLORS', 'ألوان الأقسام', 'اللون يظهر في الأزرار والتحديد ومؤشر التنقل؛ أسطح الشريط تبقى فحمية.');
  const colors = tiles();
  const swatchSheet = (title, current, resetLabel, resetHex, pick) => openSheet((sheet) => {
    sheet.append(el('h3', null, title));
    const grid = el('div', 'look-swatches');
    const reset = el('button', `look-swatch look-swatch--reset${current ? '' : ' on'}`);
    reset.type = 'button';
    reset.setAttribute('aria-pressed', String(!current));
    if (resetHex) reset.style.setProperty('--sw', resetHex);
    reset.append(el('i'), el('span', null, resetLabel));
    reset.onclick = () => { closeSheet(); pick(null); };
    grid.append(reset);
    for (const c of ACCENTS) {
      const b = el('button', `look-swatch${current === c.id ? ' on' : ''}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(current === c.id));
      b.style.setProperty('--sw', c.hex);
      b.append(el('i'), el('span', null, c.name));
      b.onclick = () => { closeSheet(); pick(c.id); };
      grid.append(b);
    }
    sheet.append(grid);
  });
  const DESIGNED = { manga: '#8f5cff', anime: '#3b82f6', cinema: '#c1121f' };
  for (const section of ['manga', 'anime', 'cinema']) {
    const chosen = ACCENTS.find((c) => c.id === look.accent?.[section]);
    colors.append(tile({
      pathOf: (vp) => homePreview(section, vp),
      alt: `رئيسية ${SECTION_NAMES[section]}`,
      title: SECTION_NAMES[section],
      sub: chosen?.name ?? 'لون القسم',
      chip: chosen?.hex ?? DESIGNED[section],
      onClick: () => swatchSheet(`لون ${SECTION_NAMES[section]}`, chosen?.id ?? null, 'لون القسم', null, (id) => saveLook((a) => {
        const accent = { ...a.accent };
        if (id) accent[section] = id;
        else delete accent[section];
        return { accent };
      })),
    }));
  }
  body.append(colors);
  const brandHex = brandOf(look);
  const brand = el('button', 'setting look-brand');
  brand.type = 'button';
  brand.innerHTML = glyph('spark');
  const bt = el('div');
  bt.append(el('strong', null, 'لون علامة VANTARA'), el('small', null, 'شعار التطبيق بلونه المستقل عن الأقسام'));
  const bv = el('span', 'value');
  const bc = el('i', 'look-chip');
  bc.style.setProperty('--sw', brandHex ?? BRAND_DEFAULT);
  bv.append(bc, doc.createTextNode(ACCENTS.find((c) => c.hex === brandHex)?.name ?? 'البنفسجي'));
  brand.append(bt, bv);
  brand.insertAdjacentHTML('beforeend', glyph('chevron', { cls: 'icon chev' }));
  brand.onclick = () => swatchSheet('لون علامة VANTARA', brandHex ? look.accent.brand : null, 'البنفسجي', BRAND_DEFAULT, (id) => saveLook((a) => {
    const accent = { ...a.accent };
    if (id) accent.brand = id;
    else delete accent.brand;
    return { accent };
  }));
  const brandList = el('div', 'settings-list');
  brandList.append(brand);
  body.append(brandList);

  // ── الخلفية الداكنة الصريحة ──
  head('DISPLAY', 'الخلفية');
  const dark = el('div', 'settings-list');
  dark.append(toggleRow(ctx, 'moon', 'الخلفية الداكنة الصريحة', 'أسود كامل بدل الداكن. على شاشات OLED يُطفأ البكسل الأسود فيوفّر شيئًا من الطاقة.', look.pureBlack, (on) => saveLook(() => ({ pureBlack: on }))));
  body.append(dark);

  // ── أنماط العرض والتكامل: ثلاث حالات فقط ──
  head('STRUCTURE', 'أنماط العرض والتكامل', 'العرض فقط يتغيّر: مكتباتك وتقدّمك وتشغيل كل نوع كما هي، وترجع متى شئت.');
  const mode = modeOf(structure);
  const toggles = el('div', 'settings-list');
  toggles.append(
    toggleRow(ctx, 'layers', 'توحيد الشاشات', 'تصميم VANTARA الموحّد لرئيسية كل قسم، وكل قسم بمحتواه ومكتبته', structure.unifyScreens, (on) => saveStructure(setUnifyScreens(structure, on))),
    toggleRow(
      ctx,
      'grid',
      'توحيد المحتوى',
      structure.unifyScreens
        ? 'رئيسية واحدة لكل أعمالك، كل عمل بوسم نوعه، ويختفي مبدّل الأقسام'
        : structure.contentPreferred ? 'يتاح بعد توحيد الشاشات، ويعود كما تركته' : 'يتاح بعد توحيد الشاشات',
      structure.unifyContent,
      (on) => saveStructure(setUnifyContent(structure, on)),
      { disabled: !structure.unifyScreens },
    ),
  );
  body.append(toggles);
  if (mode === 'independent') {
    body.append(el('p', 'look-caption', 'الآن: كل قسم بشاشته وتصميمه.'));
    const strip = tiles('look-tiles--static');
    for (const section of TEMPLATES) {
      const fig = el('figure', 'look-tile look-tile--static');
      const frame = el('span', 'look-frame');
      frame.append(previewPicture(doc, (vp) => homePreview(section, vp), `رئيسية ${SECTION_NAMES[section]}`));
      fig.append(frame, el('figcaption', null, SECTION_NAMES[section]));
      strip.append(fig);
    }
    body.append(strip);
  } else {
    // قرار المالك: لا اختيار قالب. التوحيد له تصميم واحد مخصص (الرئيسية الموحدة)، وتصاميم الأقسام تبقى لأقسامها.
    body.append(el('p', 'look-caption', mode === 'content'
      ? 'الآن: رئيسية واحدة لكل أعمالك بتصميم VANTARA الموحّد.'
      : 'الآن: تصميم VANTARA الموحّد لرئيسية كل قسم، بمحتواه.'));
  }
}

function toggleRow({ el, glyph }, icon, title, sub, checked, onChange, { disabled = false } = {}) {
  const d = el('label', `setting${disabled ? ' setting--disabled' : ''}`);
  d.innerHTML = glyph(icon);
  const t = el('div');
  t.append(el('strong', null, title));
  if (sub) t.append(el('small', null, sub));
  const input = el('input');
  input.type = 'checkbox';
  input.className = 'switch-input';
  input.setAttribute('role', 'switch');
  input.checked = checked;
  input.disabled = disabled;
  input.onchange = () => onChange(input.checked);
  d.append(t, input);
  return d;
}
