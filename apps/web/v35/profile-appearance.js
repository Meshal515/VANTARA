import { applyProfileTheme, DEFAULT_BACKGROUND, DEFAULT_CARD, normalizeColor, normalizeProfileTheme, matchedProfileTheme, reverseProfileGradient } from './profile-theme.js';
import { silkPaletteForSrc } from '../lib/silk.js';

/** Two appearance settings with native mobile color pickers, HEX and a shared live preview. */
export function createProfileAppearance(host, draft, onChange) {
  const theme = normalizeProfileTheme(draft);
  Object.assign(draft, theme);
  const root = document.createElement('section');
  root.className = 'pe-appearance';
  root.setAttribute('aria-label', 'مظهر الملف');
  root.innerHTML = `
    <div class="pe-appearance-heading"><h2>مظهر ملفك</h2><span>يظهر لك ولأصدقائك</span></div>
    <div class="pe-preview" aria-label="معاينة ألوان الملف">
      <div class="pe-preview-banner"></div>
      <div class="pe-preview-content">
        <span class="pe-preview-avatar"></span><strong class="pe-preview-name"></strong>
        <p class="pe-preview-bio"></p>
        <div class="pe-preview-card"><strong>بطاقات ملفك</strong><span>أفضل 5 · المكتبة · آخر المشاهدات</span></div>
      </div>
      <span class="pe-preview-label">معاينة مباشرة</span>
    </div>
    <div class="pe-match-heading"><strong>طقم من صورك</strong><button class="pe-theme-reset" type="button">إرجاع الافتراضي</button><span>خلفية وبطاقات متناسقة بلمسة</span></div>
    <div class="pe-match-options" role="group" aria-label="طقم من صورك">
      <button type="button" data-match="banner" aria-label="طقم مع البانر"><span class="pe-match-art pe-match-art--banner"></span><span>طقم مع<br>البانر</span></button>
      <button type="button" data-match="avatar" aria-label="طقم مع الأفتار"><span class="pe-match-art pe-match-art--avatar"></span><span>طقم مع<br>الأفتار</span></button>
      <button type="button" data-match="both" aria-label="طقم مع البانر والأفتار"><span class="pe-match-art pe-match-art--both"></span><span>طقم مع<br>البانر والأفتار</span></button>
    </div>
    <p class="pe-match-status" role="status" hidden></p>
    <button class="pe-gradient-reverse" type="button" hidden>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/></svg>
      <span>عكس التدرّج</span>
    </button>
    <details class="pe-manual"><summary>اختيار الألوان يدويًا</summary><div class="pe-manual-body">
    <fieldset class="pe-theme-section"><legend>خلفية البروفايل</legend>
      <div class="pe-theme-modes" role="group" aria-label="نوع الخلفية">
        <button type="button" data-mode="default">الافتراضي</button>
        <button type="button" data-mode="solid">لون ثابت</button>
        <button type="button" data-mode="gradient">تدرّج</button>
      </div>
      <div class="pe-background-controls">
        <div class="pe-background-color"></div>
        <div class="pe-gradient-controls">
          <div class="pe-gradient-color"></div>
          <label class="pe-angle"><span>اتجاه التدرّج <output></output></span>
            <input type="range" min="0" max="360" step="15" aria-label="اتجاه التدرّج">
          </label>
        </div>
      </div>
    </fieldset>
    <fieldset class="pe-theme-section"><legend>لون البطاقات</legend>
      <p class="pe-theme-hint">لون بطاقات الإحصائيات والقراءة والأعمال في ملفك.</p>
      <div class="pe-theme-modes" role="group" aria-label="لون البطاقات">
        <button type="button" data-card-mode="default">الافتراضي</button>
        <button type="button" data-card-mode="custom">لون مخصّص</button>
      </div>
      <div class="pe-card-color"></div>
    </fieldset>
    </div></details>`;
  host.append(root);
  let mode = theme.backgroundGradient ? 'gradient' : theme.backgroundColor ? 'solid' : 'default';
  let cardMode = theme.cardColor ? 'custom' : 'default';
  // Switching between solid and gradient keeps the second color while editing.
  let secondColor = theme.backgroundGradient || '#283457';
  let angle = theme.backgroundAngle ?? 135;
  const controls = [];
  let images = {};
  let matched = null;
  let matchRequest = 0;
  let matching = false;
  let reversed = false;
  const stopMatching = () => {
    matched = null;
    reversed = false;
    matchRequest++;
    matching = false;
    root.querySelector('.pe-match-status').hidden = true;
  };
  const palettes = ['#08070c', '#201234', '#0c1830', '#14332d', '#43202a', '#f2e5d4'];

  function colorControl(selector, key, label, fallback) {
    const container = root.querySelector(selector);
    const id = `pe-${key}`;
    container.innerHTML = `
      <label class="pe-color-title" for="${id}-picker">${label}</label>
      <div class="pe-color-row">
        <input type="color" id="${id}-picker" aria-label="منتقي ${label}">
        <label class="pe-hex-label" for="${id}-hex">HEX</label>
        <input class="pe-hex" id="${id}-hex" type="text" dir="ltr" maxlength="7" spellcheck="false" autocomplete="off" aria-label="كود ${label}" aria-describedby="${id}-error">
      </div>
      <p class="pe-color-error" id="${id}-error" hidden>اكتب رمز لون من 6 خانات، مثل #8F5CFF</p>
      <div class="pe-swatches" role="group" aria-label="ألوان مقترحة لـ${label}"></div>`;
    const picker = container.querySelector('[type=color]');
    const hex = container.querySelector('.pe-hex');
    const error = container.querySelector('.pe-color-error');
    const value = () => key === 'backgroundGradient' ? secondColor : draft[key] || fallback;
    const update = (color) => {
      stopMatching();
      draft[key] = color;
      if (key === 'backgroundGradient') secondColor = color;
      hex.setAttribute('aria-invalid', 'false');
      error.hidden = true;
      hex.value = color.toUpperCase();
      picker.value = color;
      paint();
      onChange();
    };
    picker.oninput = () => update(picker.value);
    hex.oninput = () => {
      const text = hex.value.trim();
      const color = normalizeColor(text.startsWith('#') ? text : `#${text}`);
      hex.setAttribute('aria-invalid', String(!color));
      error.hidden = Boolean(color);
      if (color) update(color);
      else onChange();
    };
    for (const color of palettes) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'pe-swatch';
      swatch.style.setProperty('--swatch', color);
      swatch.setAttribute('aria-label', `اختر ${color}`);
      swatch.onclick = () => update(color);
      container.querySelector('.pe-swatches').append(swatch);
    }
    const control = {
      container, hex,
      refresh() {
        picker.value = value();
        if (hex.getAttribute('aria-invalid') !== 'true') hex.value = value().toUpperCase();
        for (const swatch of container.querySelectorAll('.pe-swatch')) {
          swatch.setAttribute('aria-pressed', String(swatch.style.getPropertyValue('--swatch') === value()));
        }
      },
      clearError() { hex.setAttribute('aria-invalid', 'false'); error.hidden = true; },
    };
    controls.push(control);
    return control;
  }
  const first = colorControl('.pe-background-color', 'backgroundColor', 'اللون الأساسي', DEFAULT_BACKGROUND);
  const second = colorControl('.pe-gradient-color', 'backgroundGradient', 'اللون الثاني', '#283457');
  const card = colorControl('.pe-card-color', 'cardColor', 'لون البطاقات', DEFAULT_CARD);
  const range = root.querySelector('.pe-angle input');
  range.value = String(angle);
  range.oninput = () => { stopMatching(); angle = Number(range.value); draft.backgroundAngle = angle; paint(); onChange(); };
  for (const button of root.querySelectorAll('[data-mode]')) {
    button.onclick = () => {
      stopMatching();
      mode = button.dataset.mode;
      draft.backgroundColor = mode === 'default' ? null : draft.backgroundColor || DEFAULT_BACKGROUND;
      draft.backgroundGradient = mode === 'gradient' ? secondColor : null;
      draft.backgroundAngle = mode === 'gradient' ? angle : null;
      first.clearError(); second.clearError();
      paint(); onChange();
    };
  }
  for (const button of root.querySelectorAll('[data-card-mode]')) {
    button.onclick = () => {
      stopMatching();
      cardMode = button.dataset.cardMode;
      draft.cardColor = cardMode === 'default' ? null : draft.cardColor || DEFAULT_CARD;
      card.clearError(); paint(); onChange();
    };
  }
  async function matchImages(kind, { keepDirection = false } = {}) {
    if (!keepDirection) reversed = false;
    const request = ++matchRequest;
    matched = kind;
    matching = true;
    const status = root.querySelector('.pe-match-status');
    status.textContent = 'نختار أجمل ألوان صورك…';
    status.hidden = false;
    paint(); onChange();
    const palette = async (src) => {
      if (!src) return null;
      let timer;
      try {
        return await Promise.race([silkPaletteForSrc(src).catch(() => null), new Promise((resolve) => { timer = setTimeout(() => resolve(null), 6000); })]);
      } finally { clearTimeout(timer); }
    };
    const [banner, avatar] = await Promise.all([kind === 'avatar' ? null : palette(images.banner), kind === 'banner' ? null : palette(images.avatar)]);
    if (request !== matchRequest || !root.isConnected) return;
    matching = false;
    const result = matchedProfileTheme(kind, banner, avatar);
    if (!result) {
      matched = null;
      status.textContent = 'ما قدرنا نقرأ ألوان الصورة. جرّب صورة ثانية أو اختر اللون يدويًا.';
    } else {
      Object.assign(draft, kind === 'both' && reversed ? reverseProfileGradient(result) : result);
      mode = kind === 'both' ? 'gradient' : 'solid';
      cardMode = 'custom';
      if (draft.backgroundGradient) secondColor = draft.backgroundGradient;
      angle = result.backgroundAngle ?? 135;
      range.value = String(angle);
      controls.forEach((control) => control.clearError());
      status.textContent = kind === 'both' ? reversed ? 'من لون الأفتار إلى لون البانر في تدرّج واحد.' : 'من لون البانر إلى لون الأفتار في تدرّج واحد.' : 'لون متناسق من صورتك، بدون تدرّج.';
    }
    paint(); onChange();
  }
  for (const button of root.querySelectorAll('[data-match]')) button.onclick = () => void matchImages(button.dataset.match);
  root.querySelector('.pe-gradient-reverse').onclick = () => {
    Object.assign(draft, reverseProfileGradient(draft));
    secondColor = draft.backgroundGradient;
    reversed = !reversed;
    controls.forEach((control) => control.clearError());
    if (matched === 'both') root.querySelector('.pe-match-status').textContent = reversed ? 'من لون الأفتار إلى لون البانر في تدرّج واحد.' : 'من لون البانر إلى لون الأفتار في تدرّج واحد.';
    paint(); onChange();
  };
  root.querySelector('.pe-manual').addEventListener('toggle', (event) => {
    if (!event.target.open) {
      // An incomplete HEX is not a chosen color. Closing manual controls restores the last valid choice.
      controls.forEach((control) => control.clearError());
      paint(); onChange();
    }
  });
  root.querySelector('.pe-theme-reset').onclick = () => {
    stopMatching();
    Object.assign(draft, normalizeProfileTheme());
    mode = 'default'; cardMode = 'default';
    controls.forEach((control) => control.clearError());
    paint(); onChange();
  };
  function paint() {
    root.querySelector('.pe-background-controls').hidden = mode === 'default';
    root.querySelector('.pe-gradient-controls').hidden = mode !== 'gradient';
    card.container.hidden = cardMode === 'default';
    for (const button of root.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    for (const button of root.querySelectorAll('[data-card-mode]')) button.setAttribute('aria-pressed', String(button.dataset.cardMode === cardMode));
    root.querySelector('.pe-angle output').textContent = `${angle}°`;
    for (const control of controls) control.refresh();
    applyProfileTheme(root.querySelector('.pe-preview'), draft);
    applyProfileTheme(host.closest('.pe'), draft);
    const reverse = root.querySelector('.pe-gradient-reverse');
    reverse.hidden = !draft.backgroundGradient;
    reverse.disabled = matching;
    root.querySelector('.pe-theme-reset').disabled = !matching && !draft.backgroundColor && !draft.backgroundGradient && !draft.cardColor;
    for (const button of root.querySelectorAll('[data-match]')) {
      const kind = button.dataset.match;
      button.disabled = matching || (kind !== 'avatar' && !images.banner) || (kind !== 'banner' && !images.avatar);
      button.setAttribute('aria-pressed', String(matched === kind));
      button.title = button.disabled && !matching ? 'أضف الصورة أولًا' : '';
    }
  }
  paint();
  return {
    destroy() { matchRequest++; },
    hasInvalid: () => matching || controls.some(({ container, hex }) => !container.closest('[hidden]') && hex.getAttribute('aria-invalid') === 'true'),
    preview({ name, bio, avatar, banner }) {
      const changed = images.avatar !== avatar || images.banner !== banner;
      images = { avatar, banner };
      root.querySelector('.pe-preview-name').textContent = name || 'اسمك';
      root.querySelector('.pe-preview-bio').textContent = bio || 'ملفك، بألوانك';
      const face = root.querySelector('.pe-preview-avatar');
      face.style.backgroundImage = avatar ? `url("${avatar}")` : '';
      face.textContent = avatar ? '' : [...(name || '؟')][0];
      root.querySelector('.pe-preview-banner').style.backgroundImage = banner ? `url("${banner}")` : '';
      root.querySelector('.pe-match-art--banner').style.backgroundImage = banner ? `url("${banner}")` : '';
      root.querySelector('.pe-match-art--avatar').style.backgroundImage = avatar ? `url("${avatar}")` : '';
      const both = root.querySelector('.pe-match-art--both');
      both.style.backgroundImage = banner && avatar ? `url("${avatar}"), url("${banner}")` : '';
      if (changed) {
        if (matched) void matchImages(matched, { keepDirection: true });
        else paint();
      }
    },
  };
}
