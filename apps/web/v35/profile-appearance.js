import { applyProfileTheme, DEFAULT_BACKGROUND, DEFAULT_CARD, normalizeProfileTheme, matchedProfileTheme, reverseProfileGradient } from './profile-theme.js';
import { createProfileColorPicker } from './profile-color-picker.js';
import { observeProfileContrast } from './profile-contrast.js';
import { silkPaletteForSrc } from '../lib/silk.js';

export function createProfileAppearance(host, draft, onChange, { works = [] } = {}) {
  Object.assign(draft, normalizeProfileTheme(draft));
  const root = document.createElement('section');
  root.className = 'pe-appearance';
  root.setAttribute('aria-label', 'مظهر الملف');
  root.innerHTML = `
    <div class="pe-appearance-heading"><h2>مظهر ملفك</h2><button class="pe-theme-reset" type="button">إرجاع الافتراضي</button><span>ألوانك، ظاهرة لكل من يزور ملفك</span></div>
    <div class="pe-preview" aria-label="معاينة ألوان الملف">
      <div class="pe-preview-banner"></div>
      <div class="pe-preview-content">
        <span class="pe-preview-avatar"></span><strong class="pe-preview-name"></strong>
        <p class="pe-preview-bio"></p>
        <div class="pe-preview-card pe-preview-stats"><span><b>12</b><small>أعمال</small></span><span><b>1,537</b><small>فصول</small></span><span><b>1,561</b><small>قراءات</small></span></div>
        <div class="pe-preview-shelf" aria-label="معاينة الأغلفة بلا صناديق"></div>
        <div class="pe-preview-card pe-preview-history"><span class="pe-preview-history-cover"></span><span><b class="pe-preview-history-title"></b><small>الفصل 12 · اليوم</small></span></div>
      </div><span class="pe-preview-label">معاينة</span>
    </div>
    <div class="pe-match-options" role="group" aria-label="طقم من صورك">
      <button type="button" data-match="banner" aria-label="طقم مع البانر"><span class="pe-match-art pe-match-art--banner"></span><span>طقم مع البانر</span></button>
      <button type="button" data-match="avatar" aria-label="طقم مع الأفتار"><span class="pe-match-art pe-match-art--avatar"></span><span>طقم مع الأفتار</span></button>
      <button type="button" data-match="both" aria-label="طقم مع البانر والأفتار"><span class="pe-match-art pe-match-art--both"></span><span>طقم مع الاثنين</span></button>
    </div>
    <p class="pe-match-status" role="status" hidden></p>
    <button class="pe-gradient-reverse" type="button" hidden><span aria-hidden="true">⇄</span><span>عكس التدرّج</span></button>
    <details class="pe-settings pe-background-settings"><summary><span>خلفية البروفايل</span><i class="pe-background-chip"></i><small class="pe-background-description"></small></summary><div class="pe-settings-body">
      <div class="pe-theme-modes" role="group" aria-label="نوع الخلفية"><button type="button" data-mode="default">الافتراضي</button><button type="button" data-mode="solid">لون ثابت</button><button type="button" data-mode="gradient">تدرّج</button></div>
      <div class="pe-background-controls"><div class="pe-background-color"></div><div class="pe-gradient-controls"><div class="pe-gradient-color"></div>
      <div class="pe-directions" role="group" aria-label="اتجاه التدرّج"><button type="button" data-angle="180">↓ رأسي</button><button type="button" data-angle="90">→ أفقي</button><button type="button" data-angle="135">↘ مائل</button></div></div></div>
    </div></details>
    <details class="pe-settings pe-card-settings"><summary><span>لون البطاقات</span><i class="pe-card-chip"></i><small class="pe-card-description"></small></summary><div class="pe-settings-body">
      <p class="pe-theme-hint">الإحصائيات، الأول في أفضل 5، يقرأ الآن وآخر المشاهدات.</p>
      <div class="pe-theme-modes" role="group" aria-label="لون البطاقات"><button type="button" data-card-mode="default">الافتراضي</button><button type="button" data-card-mode="custom">لون مخصّص</button></div><div class="pe-card-color"></div>
    </div></details>`;
  host.append(root);
  const editor = host.closest('.pe');
  const preview = root.querySelector('.pe-preview');
  const previewContrast = observeProfileContrast(preview, draft);
  const editorContrast = editor ? observeProfileContrast(editor, draft, editor.querySelector('.pe-scroll')) : null;
  let mode = draft.backgroundGradient ? 'gradient' : draft.backgroundColor ? 'solid' : 'default';
  let cardMode = draft.cardColor ? 'custom' : 'default';
  let secondColor = draft.backgroundGradient || '#283457';
  let angle = draft.backgroundAngle ?? 135;
  let images = {}, matched = null, requestId = 0, matching = false, reversed = false;
  const controls = [];
  const stopMatching = () => { matched = null; reversed = false; requestId++; matching = false; root.querySelector('.pe-match-status').hidden = true; };
  function colorControl(selector, key, label, fallback) {
    const host = root.querySelector(selector);
    const picker = createProfileColorPicker(host, {
      label, value: draft[key] || fallback,
      onChange(color) {
        stopMatching(); draft[key] = color;
        if (key === 'backgroundGradient') secondColor = color;
        paint(); onChange();
      },
      onValidity: onChange,
    });
    controls.push({ host, key, fallback, picker });
  }
  colorControl('.pe-background-color', 'backgroundColor', 'اللون الأساسي', DEFAULT_BACKGROUND);
  colorControl('.pe-gradient-color', 'backgroundGradient', 'اللون الثاني', '#283457');
  colorControl('.pe-card-color', 'cardColor', 'لون البطاقات', DEFAULT_CARD);
  for (const button of root.querySelectorAll('[data-mode]')) button.onclick = () => {
    stopMatching(); mode = button.dataset.mode;
    draft.backgroundColor = mode === 'default' ? null : draft.backgroundColor || DEFAULT_BACKGROUND;
    draft.backgroundGradient = mode === 'gradient' ? secondColor : null;
    draft.backgroundAngle = mode === 'gradient' ? angle : null;
    controls.forEach(({ picker }) => picker.clearError()); paint(); onChange();
  };
  for (const button of root.querySelectorAll('[data-card-mode]')) button.onclick = () => {
    stopMatching(); cardMode = button.dataset.cardMode;
    draft.cardColor = cardMode === 'default' ? null : draft.cardColor || DEFAULT_CARD;
    controls.forEach(({ picker }) => picker.clearError()); paint(); onChange();
  };
  for (const button of root.querySelectorAll('[data-angle]')) button.onclick = () => {
    stopMatching(); angle = Number(button.dataset.angle); draft.backgroundAngle = angle; paint(); onChange();
  };
  async function matchImages(kind, keepDirection = false) {
    if (!keepDirection) reversed = false;
    const request = ++requestId;
    matched = kind; matching = true;
    const status = root.querySelector('.pe-match-status'); status.hidden = false; status.textContent = 'نختار ألوان صورك…';
    paint(); onChange();
    const palette = async (src) => {
      if (!src) return null;
      let timer;
      try { return await Promise.race([silkPaletteForSrc(src).catch(() => null), new Promise((resolve) => { timer = setTimeout(() => resolve(null), 6000); })]); }
      finally { clearTimeout(timer); }
    };
    const [banner, avatar] = await Promise.all([kind === 'avatar' ? null : palette(images.banner), kind === 'banner' ? null : palette(images.avatar)]);
    if (request !== requestId || !root.isConnected) return;
    matching = false;
    const result = matchedProfileTheme(kind, banner, avatar);
    if (!result) { matched = null; status.textContent = 'تعذّر قراءة ألوان الصورة. اختر اللون يدويًا أو جرّب صورة ثانية.'; }
    else {
      Object.assign(draft, kind === 'both' && reversed ? reverseProfileGradient(result) : result);
      mode = kind === 'both' ? 'gradient' : 'solid'; cardMode = 'custom';
      secondColor = draft.backgroundGradient || secondColor; angle = result.backgroundAngle ?? 135;
      controls.forEach(({ picker }) => picker.clearError());
      status.textContent = kind === 'both' ? reversed ? 'من الأفتار إلى البانر.' : 'من البانر إلى الأفتار.' : 'لون من صورتك، بدون تدرّج.';
    }
    paint(); onChange();
  }
  for (const button of root.querySelectorAll('[data-match]')) button.onclick = () => void matchImages(button.dataset.match);
  root.querySelector('.pe-gradient-reverse').onclick = () => {
    Object.assign(draft, reverseProfileGradient(draft)); secondColor = draft.backgroundGradient; reversed = !reversed;
    controls.forEach(({ picker }) => picker.clearError());
    if (matched === 'both') root.querySelector('.pe-match-status').textContent = reversed ? 'من الأفتار إلى البانر.' : 'من البانر إلى الأفتار.';
    paint(); onChange();
  };
  root.querySelector('.pe-theme-reset').onclick = () => {
    stopMatching(); Object.assign(draft, normalizeProfileTheme()); mode = cardMode = 'default';
    controls.forEach(({ picker }) => picker.clearError()); paint(); onChange();
  };
  for (const details of root.querySelectorAll('.pe-settings')) details.addEventListener('toggle', () => {
    if (!details.open) { for (const control of controls) if (details.contains(control.host)) control.picker.clearError(); onChange(); }
    editorContrast?.refresh();
  });
  function paint() {
    root.querySelector('.pe-background-controls').hidden = mode === 'default';
    root.querySelector('.pe-gradient-controls').hidden = mode !== 'gradient';
    root.querySelector('.pe-card-color').hidden = cardMode === 'default';
    for (const button of root.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    for (const button of root.querySelectorAll('[data-card-mode]')) button.setAttribute('aria-pressed', String(button.dataset.cardMode === cardMode));
    for (const button of root.querySelectorAll('[data-angle]')) button.setAttribute('aria-pressed', String(Number(button.dataset.angle) === angle));
    for (const { key, fallback, picker } of controls) { picker.setValue(key === 'backgroundGradient' ? secondColor : draft[key] || fallback); picker.setDisabled(matching); }
    applyProfileTheme(preview, draft); if (editor) applyProfileTheme(editor, draft);
    previewContrast.update(draft); editorContrast?.update(draft);
    root.querySelector('.pe-background-chip').style.background = draft.backgroundGradient ? `linear-gradient(${angle}deg, ${draft.backgroundColor}, ${draft.backgroundGradient})` : draft.backgroundColor || DEFAULT_BACKGROUND;
    root.querySelector('.pe-card-chip').style.background = draft.cardColor || DEFAULT_CARD;
    root.querySelector('.pe-background-description').textContent = mode === 'gradient' ? 'تدرّج' : mode === 'solid' ? 'لون ثابت' : 'الافتراضي';
    root.querySelector('.pe-card-description').textContent = cardMode === 'custom' ? 'مخصّص' : 'الافتراضي';
    const reverse = root.querySelector('.pe-gradient-reverse'); reverse.hidden = !draft.backgroundGradient; reverse.disabled = matching;
    root.querySelector('.pe-theme-reset').disabled = !matching && !draft.backgroundColor && !draft.backgroundGradient && !draft.cardColor;
    for (const button of root.querySelectorAll('[data-match]')) {
      const kind = button.dataset.match;
      button.disabled = matching || (kind !== 'avatar' && !images.banner) || (kind !== 'banner' && !images.avatar);
      button.setAttribute('aria-pressed', String(matched === kind));
      button.title = button.disabled && !matching ? 'أضف الصورة أولًا' : '';
    }
  }
  const shelf = root.querySelector('.pe-preview-shelf');
  const samples = works.length ? works.slice(0, 2) : [{ title: 'عملك المفضل' }, { title: 'من مكتبتك' }];
  for (const work of samples) {
    const item = document.createElement('span'); item.className = 'pe-preview-work';
    const cover = document.createElement('span'); cover.className = 'pe-preview-work-cover';
    if (work.cover) cover.style.backgroundImage = `url("${work.cover}")`;
    const title = document.createElement('bdi'); title.textContent = work.title;
    item.append(cover, title); shelf.append(item);
  }
  root.querySelector('.pe-preview-history-title').textContent = samples[0].title;
  if (samples[0].cover) root.querySelector('.pe-preview-history-cover').style.backgroundImage = `url("${samples[0].cover}")`;
  paint();
  return {
    destroy() { requestId++; controls.forEach(({ picker }) => picker.destroy()); previewContrast.destroy(); editorContrast?.destroy(); },
    hasInvalid: () => matching || controls.some(({ host, picker }) => !host.closest('[hidden]') && host.closest('.pe-settings').open && picker.invalid()),
    preview({ name, bio, avatar, banner }) {
      const changed = images.avatar !== avatar || images.banner !== banner; images = { avatar, banner };
      root.querySelector('.pe-preview-name').textContent = name || 'اسمك';
      root.querySelector('.pe-preview-bio').textContent = bio || 'ملفك، بألوانك';
      const face = root.querySelector('.pe-preview-avatar'); face.style.backgroundImage = avatar ? `url("${avatar}")` : ''; face.textContent = avatar ? '' : [...(name || '؟')][0];
      root.querySelector('.pe-preview-banner').style.backgroundImage = banner ? `url("${banner}")` : '';
      root.querySelector('.pe-match-art--banner').style.backgroundImage = banner ? `url("${banner}")` : '';
      root.querySelector('.pe-match-art--avatar').style.backgroundImage = avatar ? `url("${avatar}")` : '';
      root.querySelector('.pe-match-art--both').style.backgroundImage = banner && avatar ? `url("${avatar}"), url("${banner}")` : '';
      if (changed) { if (matched) void matchImages(matched, true); else paint(); }
    },
  };
}
