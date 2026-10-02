/**
 * «حساب جديد» — ثلاث خانات لا أكثر: الصورة، الاسم، اسم المستخدم. ثم «إنشاء».
 *
 * المعرّف الداخلي يولّده الخادم (UUID ثابت لا يُرى). الصورة: من الجهاز أو من
 * ألوان VANTARA الجاهزة (حرف الاسم على تدرّج زجاجي). تُرفع بعد الدخول للحساب
 * الجديد، فلا رفع بلا جلسة. الـPIN لا يُطلب هنا؛ يُضاف لاحقًا من الإعدادات.
 */

import { encodeStatic, TARGETS } from '../v35/media-encode.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** تدرّجات VANTARA للصورة الجاهزة. */
const PRESETS = [
  ['#8f5cff', '#3b1d8f'],
  ['#3b82f6', '#0e2a6b'],
  ['#e0303a', '#5c0d14'],
  ['#14b8a6', '#0b3d38'],
  ['#f59e0b', '#6b3a05'],
  ['#ec4899', '#5e0f37'],
  ['#64748b', '#1e2633'],
  ['#22c55e', '#0d3d1f'],
];

const USERNAME = /^[a-z0-9_.]{3,20}$/;

/** صورة جاهزة: الحرف الأول على تدرّج، 512px webp. */
async function presetBlob(colors, name) {
  const { w, budget } = TARGETS.avatar;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = w;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, w, w);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(1, colors[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, w);
  const shine = g.createRadialGradient(w * 0.3, w * 0.22, 0, w * 0.3, w * 0.22, w * 0.8);
  shine.addColorStop(0, 'rgba(255,255,255,.28)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = shine;
  g.fillRect(0, 0, w, w);
  g.fillStyle = 'rgba(255,255,255,.94)';
  g.font = `700 ${Math.round(w * 0.44)}px "Vantara Sans", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText([...String(name || '؟').trim()][0] || '؟', w / 2, w / 2 + w * 0.02);
  return encodeStatic(canvas, budget);
}

/** صورة من الجهاز: قصّ مربّع من المنتصف إلى 512. */
async function photoBlob(file) {
  const { w, budget } = TARGETS.avatar;
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = w;
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, w, w);
  bitmap.close?.();
  return encodeStatic(canvas, budget);
}

/**
 * @param {{ sync: any, mount?: HTMLElement, onCreated: (user: any) => Promise<void>|void, onClose?: () => void }} deps
 */
export function openAddAccount({ sync, mount = document.body, onCreated, onClose }) {
  let preset = 0;
  let photo = null;
  let photoUrl = null;
  let busy = false;

  const root = el('div', 'vacct');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'حساب جديد');
  const panel = el('form', 'vacct__panel');
  panel.noValidate = true;

  const head = el('div', 'vacct__head');
  const close = el('button', 'vacct__close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'إغلاق');
  head.append(el('h2', 'vacct__title', 'حساب جديد'), close);

  const face = el('button', 'vacct__face');
  face.type = 'button';
  face.setAttribute('aria-label', 'اختر صورة من جهازك');
  const faceInitial = el('span', 'vacct__initial', '؟');
  face.append(faceInitial);
  const file = el('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.hidden = true;

  const swatches = el('div', 'vacct__swatches');
  swatches.setAttribute('role', 'radiogroup');
  swatches.setAttribute('aria-label', 'لون الصورة');
  const photoBtn = el('button', 'vacct__swatch vacct__swatch--photo');
  photoBtn.type = 'button';
  photoBtn.setAttribute('aria-label', 'صورة من جهازك');
  photoBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><circle cx="9" cy="10.5" r="1.6"/><path d="m20.5 16-5-5-7.5 7.5"/></svg>';
  const swatchButtons = PRESETS.map((colors, i) => {
    const b = el('button', 'vacct__swatch');
    b.type = 'button';
    b.style.background = `linear-gradient(150deg, ${colors[0]}, ${colors[1]})`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `لون ${i + 1}`);
    b.onclick = () => {
      preset = i;
      photo = null;
      paintFace();
    };
    return b;
  });
  swatches.append(photoBtn, ...swatchButtons);

  const field = (label, input, hint) => {
    const wrap = el('label', 'vacct__field');
    wrap.append(el('span', 'vacct__label', label), input);
    if (hint) wrap.append(hint);
    return wrap;
  };
  const name = el('input', 'vacct__input');
  name.maxLength = 32;
  name.autocomplete = 'off';
  name.placeholder = 'الاسم اللي يظهر للكل';
  name.dir = 'auto';
  const userWrap = el('div', 'vacct__user');
  const username = el('input', 'vacct__input vacct__input--user');
  username.maxLength = 20;
  username.autocomplete = 'off';
  username.autocapitalize = 'none';
  username.spellcheck = false;
  username.dir = 'ltr';
  username.placeholder = 'username';
  userWrap.append(el('span', 'vacct__at', '@'), username);
  const userHint = el('small', 'vacct__hint', 'حروف إنجليزية صغيرة وأرقام و _ . — من 3 إلى 20');

  const error = el('p', 'vacct__error');
  error.setAttribute('role', 'alert');
  const create = el('button', 'vacct__create', 'إنشاء');
  create.type = 'submit';

  panel.append(head, face, file, swatches, field('الاسم', name), field('اسم المستخدم', userWrap, userHint), error, create);
  root.append(panel);
  mount.append(root);
  requestAnimationFrame(() => root.classList.add('vacct--in'));
  setTimeout(() => name.focus(), 260);

  function paintFace() {
    const initial = [...name.value.trim()][0] || '؟';
    faceInitial.textContent = initial;
    if (photoUrl && photo) {
      face.style.background = `center / cover no-repeat url("${photoUrl}")`;
      faceInitial.hidden = true;
    } else {
      const c = PRESETS[preset];
      face.style.background = `linear-gradient(150deg, ${c[0]}, ${c[1]})`;
      faceInitial.hidden = false;
    }
    swatchButtons.forEach((b, i) => b.setAttribute('aria-checked', String(!photo && i === preset)));
    photoBtn.setAttribute('aria-checked', String(Boolean(photo)));
  }

  function validate() {
    const u = username.value.trim().toLowerCase();
    const okName = name.value.trim().length > 0;
    const okUser = USERNAME.test(u);
    userHint.classList.toggle('vacct__hint--bad', Boolean(u) && !okUser);
    create.disabled = busy || !okName || !okUser;
    return okName && okUser;
  }

  const pick = () => file.click();
  face.onclick = pick;
  photoBtn.onclick = pick;
  file.onchange = () => {
    const f = file.files?.[0];
    if (!f) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photo = f;
    photoUrl = URL.createObjectURL(f);
    paintFace();
  };
  name.oninput = () => {
    paintFace();
    validate();
  };
  username.oninput = () => {
    const clean = username.value.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_.]/g, '');
    if (clean !== username.value) username.value = clean;
    error.textContent = '';
    validate();
  };

  function dismiss() {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    root.classList.remove('vacct--in');
    setTimeout(() => root.remove(), 220);
  }
  close.onclick = () => {
    dismiss();
    onClose?.();
  };

  panel.onsubmit = async (e) => {
    e.preventDefault();
    if (!validate() || busy) return;
    busy = true;
    create.disabled = true;
    create.textContent = 'ننشئ الحساب…';
    error.textContent = '';
    const out = await sync.createAccount({ username: username.value.trim().toLowerCase(), displayName: name.value.trim() }).catch(() => ({ ok: false, data: { error: 'network' } }));
    if (!out.ok) {
      busy = false;
      create.textContent = 'إنشاء';
      validate();
      const code = out.data?.error;
      error.textContent =
        code === 'username_taken' ? 'اسم المستخدم مأخوذ. جرّب غيره.'
          : code === 'limit_reached' ? 'وصلتم للحد: عشرة حسابات.'
            : code === 'bad_username' ? 'اسم المستخدم غير صالح.'
              : code === 'network' ? 'ما فيه اتصال. حاول مرة ثانية.'
                : code === 'unauthorized' ? 'هالجهاز غير معتمد بعد. ادخل حسابك أولًا.'
                : 'تعذّر إنشاء الحساب. حاول مرة ثانية.';
      return;
    }
    try {
      create.textContent = 'ندخلك…';
      const user = await sync.signIn(out.data.account.userId);
      // الصورة بعد الدخول (الرفع يحتاج جلسة). فشلها لا يمنع الحساب: يبقى الحرف
      try {
        const blob = photo ? await photoBlob(photo) : await presetBlob(PRESETS[preset], name.value);
        const url = (await sync.uploadMedia(blob)).url;
        sync.enqueue('profile.patch', { fields: { avatarKey: url } });
      } catch {
        // بلا صورة الآن، تُضاف من الملف الشخصي
      }
      dismiss();
      await onCreated(user);
    } catch {
      busy = false;
      create.textContent = 'إنشاء';
      validate();
      error.textContent = 'أُنشئ الحساب لكن تعذّر الدخول. اختره من القائمة.';
    }
  };

  paintFace();
  validate();
  return { close: dismiss };
}
