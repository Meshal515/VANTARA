/**
 * تعديل الملف الشخصي — على الملف نفسه لا في استمارة.
 *
 * ما تراه هو ملفك كما يراه أصدقاؤك: البانر، الصورة فوقه، الاسم مكان الاسم،
 * والنبذة مكان النبذة. كل صورة عليها زرّ كاميرا، واختيار صورة يفتح القصّ
 * بملء الشاشة (سحب للتحريك، إصبعان أو المنزلق للتكبير) ثم تُضغط على الجهاز
 * قبل الرفع.
 *
 * الحفظ يرفع الصور أولًا ثم يكتب الحقول التي تغيّرت فقط. والفشل يُقال بسببه
 * (كبيرة، ليست صورة، لا اتصال) ويبقيك حيث أنت. والخروج بتعديلات لم تُحفظ
 * يسأل قبل أن يرميها، وحذف صورة يطلب تأكيدًا.
 */

import { glyph, iconButton } from './icons.js';
import { MediaError, TARGETS, drawCrop, encodeAnimated, encodeStatic, sniffAnimated } from './media-encode.js';

const NAME_MAX = 40;
const BIO_MAX = 160;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/**
 * القصّ: الصورة تتحرك تحت إطارٍ ثابت (دائرة للصورة، مستطيل للبانر).
 * يرجع مستطيل القصّ بإحداثيات الصورة الأصلية مع الصورة نفسها، أو `null`
 * إن ألغيت، أو `{error}` إن لم يفتحها الجهاز. الترميز بعده في media-encode.
 */
function openCropper(file, kind, { animated = false } = {}) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const round = kind === 'avatar';
    const aspect = TARGETS[kind].w / TARGETS[kind].h;
    const root = el('div', 'v35 pe-crop');
    root.innerHTML = `
      <header class="pe-crop-top">
        ${iconButton('close', 'إلغاء', { act: 'cancel' })}
        <strong>${round ? 'اضبط صورتك' : 'اضبط البانر'}</strong>
        <button class="btn btn-primary pe-crop-use" type="button" data-act="use">استخدم</button>
      </header>
      <div class="pe-stage"><img alt="" draggable="false"><div class="pe-mask${round ? ' pe-mask--round' : ''}"></div></div>
      <div class="pe-zoom">${glyph('image', { size: 18 })}<input type="range" min="1" max="4" step="0.01" value="1" aria-label="التكبير">${glyph('image', { size: 26 })}</div>
      <p class="pe-hint">${animated ? 'متحركة وتبقى متحركة. ' : ''}اسحب لتحريك الصورة، وافتح إصبعيك للتكبير</p>`;
    document.body.append(root);
    const stage = root.querySelector('.pe-stage');
    const img = root.querySelector('.pe-stage img');
    const range = root.querySelector('input[type=range]');
    const view = { scale: 1, x: 0, y: 0, base: 1 };
    let frame = { w: 0, h: 0 };

    const clamp = () => {
      const w = img.naturalWidth * view.base * view.scale;
      const h = img.naturalHeight * view.base * view.scale;
      const maxX = Math.max(0, (w - frame.w) / 2);
      const maxY = Math.max(0, (h - frame.h) / 2);
      view.x = Math.min(maxX, Math.max(-maxX, view.x));
      view.y = Math.min(maxY, Math.max(-maxY, view.y));
    };
    const paint = () => {
      clamp();
      img.style.transform = `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.base * view.scale})`;
    };
    const layout = () => {
      const r = stage.getBoundingClientRect();
      const fw = Math.min(r.width - 32, (r.height - 32) * aspect);
      frame = { w: fw, h: fw / aspect };
      root.style.setProperty('--frame-w', `${frame.w}px`);
      root.style.setProperty('--frame-h', `${frame.h}px`);
      // تبدأ الصورة مغطّيةً الإطار كله
      view.base = Math.max(frame.w / img.naturalWidth, frame.h / img.naturalHeight);
      paint();
    };

    const pointers = new Map();
    let pinch = null;
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
      }
    });
    stage.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        view.scale = Math.min(4, Math.max(1, pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)));
        range.value = String(view.scale);
      } else if (pointers.size === 1) {
        view.x += e.clientX - prev.x;
        view.y += e.clientY - prev.y;
      }
      paint();
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        view.scale = Math.min(4, Math.max(1, view.scale - e.deltaY * 0.002));
        range.value = String(view.scale);
        paint();
      },
      { passive: false },
    );
    range.oninput = () => {
      view.scale = Number(range.value);
      paint();
    };

    const done = (value) => {
      window.removeEventListener('resize', layout);
      // الرابط يبقى حيًّا مع الصورة: الترميز يرسم منها بعد الإغلاق
      if (!value?.img) URL.revokeObjectURL(url);
      root.remove();
      resolve(value);
    };
    root.querySelector('[data-act="cancel"]').onclick = () => done(null);
    root.querySelector('[data-act="use"]').onclick = () => {
      // ما داخل الإطار بإحداثيات الصورة الأصلية
      const k = view.base * view.scale;
      const sw = frame.w / k;
      const sh = frame.h / k;
      const sx = img.naturalWidth / 2 - view.x / k - sw / 2;
      const sy = img.naturalHeight / 2 - view.y / k - sh / 2;
      done({ rect: { sx, sy, sw, sh }, img, url });
    };
    root.cropper = { cancel: () => done(null) };
    img.onload = () => {
      layout();
      window.addEventListener('resize', layout);
    };
    img.onerror = () => done({ error: 'decode' });
    img.src = url;
  });
}

/**
 * @param {{
 *   sync: any,
 *   profile: { displayName: string, bio: string|null, avatarKey: string|null, defaultAvatar?: string|null, bannerKey: string|null },
 *   openSheet: (build: (body: HTMLElement) => (void|(() => void))) => void,
 *   closeSheet: () => boolean,
 *   toast: (text: string) => void,
 *   onSaved: (fields: Record<string, string|null>) => void,
 *   onClose: (saved: boolean) => void,
 * }} ctx
 */
export function openProfileEditor(ctx) {
  const start = { ...ctx.profile };
  const draft = { ...ctx.profile, avatarBlob: null, bannerBlob: null };
  let saving = false;
  let cropping = false;
  let preparing = false;

  const root = el('div', 'v35 pe');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'تعديل الملف');
  root.innerHTML = `
    <header class="pe-top">
      ${iconButton('close', 'إغلاق', { act: 'close' })}
      <strong>تعديل الملف</strong>
      <button class="btn btn-primary pe-save" type="button" data-act="save" disabled>حفظ</button>
    </header>
    <div class="pe-scroll">
      <div class="pe-banner" data-act="banner" role="button" tabindex="0" aria-label="غيّر البانر">
        <div class="pe-banner-img"></div>
        <span class="pe-cam pe-cam--banner">${glyph('camera', { size: 18 })}<span>البانر</span></span>
      </div>
      <div class="pe-id">
        <button class="pe-face" type="button" data-act="avatar" aria-label="غيّر صورتك">
          <span class="pe-face-img"></span>
          <span class="pe-cam pe-cam--face">${glyph('camera', { size: 16 })}</span>
        </button>
        <label class="pe-field">
          <span class="pe-label">الاسم <em id="peNameCount"></em></span>
          <input class="pe-name" id="peName" maxlength="${NAME_MAX}" autocomplete="nickname" dir="auto" enterkeyhint="next">
        </label>
        <label class="pe-field">
          <span class="pe-label">النبذة <em id="peBioCount"></em></span>
          <textarea class="pe-bio" id="peBio" maxlength="${BIO_MAX}" rows="3" dir="auto" placeholder="سطر أو سطرين عنك وعن اللي تقرأه"></textarea>
        </label>
        <p class="pe-error" id="peError" role="alert" hidden></p>
      </div>
    </div>
    <input type="file" accept="image/*" id="peFile" hidden>`;
  document.body.append(root);
  const q = (id) => root.querySelector(`#${id}`);
  const nameInput = q('peName');
  const bioInput = q('peBio');
  nameInput.value = draft.displayName ?? '';
  bioInput.value = draft.bio ?? '';

  const objectUrls = new Set();
  const preview = (blob) => {
    const u = URL.createObjectURL(blob);
    objectUrls.add(u);
    return u;
  };
  function paintImages() {
    const banner = root.querySelector('.pe-banner-img');
    const bannerSrc = draft.bannerBlob ? preview(draft.bannerBlob) : draft.bannerKey;
    banner.style.backgroundImage = bannerSrc ? `url("${bannerSrc}")` : '';
    banner.classList.toggle('pe-banner-img--empty', !bannerSrc);
    const face = root.querySelector('.pe-face-img');
    const faceSrc = draft.avatarBlob ? preview(draft.avatarBlob) : draft.avatarKey || draft.defaultAvatar;
    face.replaceChildren();
    if (faceSrc) {
      const img = el('img');
      img.src = faceSrc;
      img.alt = '';
      face.append(img);
    } else {
      face.append(el('span', 'pe-initial', [...(nameInput.value.trim() || '؟')][0]));
    }
  }
  const dirty = () =>
    Boolean(draft.avatarBlob || draft.bannerBlob) ||
    nameInput.value.trim() !== (start.displayName ?? '') ||
    (bioInput.value.trim() || null) !== (start.bio || null) ||
    draft.avatarKey !== start.avatarKey ||
    draft.bannerKey !== start.bannerKey;
  function refresh() {
    const name = nameInput.value.trim();
    q('peNameCount').textContent = `${nameInput.value.length}/${NAME_MAX}`;
    q('peBioCount').textContent = `${bioInput.value.length}/${BIO_MAX}`;
    q('peNameCount').classList.toggle('pe-near', nameInput.value.length > NAME_MAX - 6);
    q('peBioCount').classList.toggle('pe-near', bioInput.value.length > BIO_MAX - 20);
    root.querySelector('.pe-save').disabled = saving || preparing || !dirty() || !name;
    nameInput.setAttribute('aria-invalid', String(!name));
    if (!draft.avatarKey && !draft.avatarBlob && !draft.defaultAvatar) paintImages();
  }
  function showError(text) {
    const e = q('peError');
    e.classList.remove('pe-note');
    e.setAttribute('role', 'alert');
    e.textContent = text;
    e.hidden = !text;
  }
  /** حالة لا خطأ: تجهيز صورة متحركة يأخذ ثواني، والصمت يبدو تعليقًا. */
  function showNote(text) {
    const e = q('peError');
    e.classList.toggle('pe-note', Boolean(text));
    e.setAttribute('role', 'status');
    e.textContent = text;
    e.hidden = !text;
  }

  // ── الصور ──
  let pendingKind = null;
  function pick(kind) {
    const has = kind === 'avatar' ? draft.avatarBlob || draft.avatarKey : draft.bannerBlob || draft.bannerKey;
    if (!has) return choose(kind);
    ctx.openSheet((body) => {
      body.append(el('h3', null, kind === 'avatar' ? 'صورتك' : 'البانر'));
      const choose1 = sheetItem('image', 'اختر صورة جديدة', () => {
        ctx.closeSheet();
        choose(kind);
      });
      const remove = sheetItem('trash', kind === 'avatar' ? 'احذف الصورة' : 'احذف البانر', () => confirmRemove(kind), true);
      body.append(choose1, remove);
    });
  }
  function confirmRemove(kind) {
    ctx.openSheet((body) => {
      body.append(el('h3', null, kind === 'avatar' ? 'تحذف صورتك؟' : 'تحذف البانر؟'));
      body.append(
        el(
          'p',
          null,
          kind === 'banner' ? 'يرجع البانر الحريري بلون صورتك.' : draft.defaultAvatar ? 'ترجع صورتك الأساسية.' : 'يرجع مكانها أول حرف من اسمك.',
        ),
      );
      const row = el('div', 'sheet-actions');
      const keep = el('button', 'btn btn-secondary', 'خلّها');
      keep.type = 'button';
      keep.onclick = () => ctx.closeSheet();
      const del = el('button', 'btn btn-danger', 'احذف');
      del.type = 'button';
      del.onclick = () => {
        if (kind === 'avatar') {
          draft.avatarBlob = null;
          draft.avatarKey = null;
        } else {
          draft.bannerBlob = null;
          draft.bannerKey = null;
        }
        ctx.closeSheet();
        paintImages();
        refresh();
      };
      row.append(keep, del);
      body.append(row);
    });
  }
  function choose(kind) {
    pendingKind = kind;
    q('peFile').value = '';
    q('peFile').click();
  }
  q('peFile').onchange = async () => {
    const file = q('peFile').files?.[0];
    const kind = pendingKind;
    if (!file || !kind) return;
    if (file.type && !file.type.startsWith('image/')) return void showError('هذا الملف مو صورة.');
    showError('');
    const animated = await sniffAnimated(file).catch(() => null);
    cropping = true;
    const crop = await openCropper(file, kind, { animated: Boolean(animated) });
    cropping = false;
    if (!crop) return;
    if (crop.error) return void showError('الجهاز ما قدر يفتح هالصورة. جرّب صيغة ثانية مثل JPG أو PNG أو GIF.');
    let blob;
    preparing = true;
    refresh();
    try {
      if (animated) {
        showNote('نجهّز الصورة المتحركة…');
        blob = await encodeAnimated(file, animated, crop.rect, kind, (p) => showNote(`نجهّز الصورة المتحركة… ${Math.round(p * 100)}٪`));
      } else {
        blob = await encodeStatic(drawCrop(crop.img, crop.rect, TARGETS[kind]), TARGETS[kind].budget);
      }
    } catch (error) {
      showError(
        error instanceof MediaError && error.code === 'too_large'
          ? 'الصورة كبيرة حتى بعد الضغط. جرّب مقطعًا أقصر أو صورة أصغر.'
          : 'ما قدرنا نجهّز الصورة. جرّب صورة ثانية.',
      );
      return;
    } finally {
      URL.revokeObjectURL(crop.url);
      preparing = false;
      showNote('');
      refresh();
    }
    if (kind === 'avatar') draft.avatarBlob = blob;
    else draft.bannerBlob = blob;
    showError('');
    paintImages();
    refresh();
  };
  function sheetItem(icon, label, run, danger = false) {
    const b = el('button', `sheet-item${danger ? ' sheet-item--danger' : ''}`);
    b.type = 'button';
    b.innerHTML = glyph(icon);
    b.append(el('span', null, label));
    b.onclick = run;
    return b;
  }

  // ── الحفظ ──
  async function save() {
    const name = nameInput.value.trim();
    if (!name || saving) return;
    saving = true;
    const btn = root.querySelector('.pe-save');
    btn.disabled = true;
    showError('');
    try {
      const fields = {};
      if (draft.avatarBlob) {
        btn.textContent = 'رفع الصورة…';
        fields.avatarKey = (await ctx.sync.uploadMedia(draft.avatarBlob)).url;
      } else if (draft.avatarKey !== start.avatarKey) fields.avatarKey = draft.avatarKey;
      if (draft.bannerBlob) {
        btn.textContent = 'رفع البانر…';
        fields.bannerKey = (await ctx.sync.uploadMedia(draft.bannerBlob)).url;
      } else if (draft.bannerKey !== start.bannerKey) fields.bannerKey = draft.bannerKey;
      if (name !== start.displayName) fields.displayName = name;
      const bio = bioInput.value.trim() || null;
      if (bio !== (start.bio || null)) fields.bio = bio;
      if (Object.keys(fields).length) {
        ctx.sync.enqueue('profile.patch', { fields });
        ctx.onSaved(fields);
      }
      ctx.toast('حُفظ ملفك');
      close(true);
    } catch (error) {
      const status = error?.status;
      showError(
        status === 413
          ? 'الصورة أكبر من المسموح. جرّب صورة أصغر.'
          : status === 415
            ? 'هذا الملف مو صورة.'
            : status === 401
              ? 'انتهت الجلسة. ادخل حسابك مرة ثانية.'
              : 'ما قدرنا نرفع الصورة. تأكد من الاتصال وجرّب ثانية.',
      );
      btn.textContent = 'حفظ';
      saving = false;
      refresh();
    }
  }

  // ── الإغلاق ──
  function requestClose() {
    if (saving) return;
    if (!dirty()) return close(false);
    ctx.openSheet((body) => {
      body.append(el('h3', null, 'تتجاهل التعديلات؟'));
      body.append(el('p', null, 'اللي غيّرته ما انحفظ.'));
      const row = el('div', 'sheet-actions');
      const keep = el('button', 'btn btn-secondary', 'كمّل التعديل');
      keep.type = 'button';
      keep.onclick = () => ctx.closeSheet();
      const drop = el('button', 'btn btn-danger', 'تجاهل');
      drop.type = 'button';
      drop.onclick = () => {
        ctx.closeSheet();
        close(false);
      };
      row.append(keep, drop);
      body.append(row);
    });
  }
  let closed = false;
  function close(saved) {
    if (closed) return;
    closed = true;
    for (const u of objectUrls) URL.revokeObjectURL(u);
    root.classList.add('pe--out');
    setTimeout(() => root.remove(), 180);
    ctx.onClose(saved);
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'close') requestClose();
    if (act === 'save') void save();
    if (act === 'avatar') pick('avatar');
    if (act === 'banner') pick('banner');
  });
  root.querySelector('.pe-banner').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') pick('banner');
  });
  nameInput.addEventListener('input', refresh);
  bioInput.addEventListener('input', refresh);
  // لوحة المفاتيح تغطي نصف الشاشة: الحقل النشط يُرفع فوقها
  for (const input of [nameInput, bioInput]) {
    input.addEventListener('focus', () => setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250));
  }
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      bioInput.focus();
    }
  });

  paintImages();
  refresh();

  return {
    /** رجوع أندرويد: القصّ ثم الورقة ثم «تتجاهل؟». */
    handleBack() {
      if (cropping) {
        document.querySelector('.pe-crop')?.cropper?.cancel();
        return true;
      }
      if (ctx.closeSheet()) return true;
      requestClose();
      return true;
    },
    get open() {
      return !closed;
    },
  };
}
