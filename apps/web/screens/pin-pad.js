/**
 * لوحة PIN بهوية VANTARA — زجاج داكن فوق ما خلفها، صورة الحساب، نقاط، وأزرار
 * دائرية زجاجية كهاتف حديث. تعمل خارج القشرة (شاشة «من يتابع؟») وداخلها
 * (الإعدادات، القفل عند فتح التطبيق).
 *
 *   enter    إدخال رمز موجود: `submit(pin)` يرجع { ok } أو { error, retryAt }.
 *   create   رمز جديد: اختيار 4 أو 6 أرقام، إدخال، تأكيد، ثم `submit(pin)`.
 *
 * الأرقام فقط. الإرسال تلقائي عند اكتمال الخانات. الخطأ: اهتزاز + نبضة لمس،
 * والقفل: عدّاد تنازلي والأزرار معطّلة حتى ينتهي.
 */

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const BACKSPACE =
  '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z"/><path d="m16 9-6 6M10 9l6 6"/></svg>';

const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * @param {{
 *   mode?: 'enter'|'create', digits?: 4|6, title: string, subtitle?: string,
 *   avatar?: string|null, initial?: string, cancelLabel?: string|null, solid?: boolean,
 *   submit: (pin: string) => Promise<{ ok?: boolean, error?: string, retryAt?: number|null }>,
 *   onCancel?: () => void, onDone?: () => void, mount?: HTMLElement,
 * }} opts
 */
export function pinPad(opts) {
  const mount = opts.mount ?? document.body;
  let digits = opts.digits === 6 ? 6 : 4;
  let mode = opts.mode ?? 'enter';
  let step = mode === 'create' ? 'choose' : 'enter';
  let first = '';
  let value = '';
  let busy = false;
  let lockTimer = 0;

  const root = el('div', opts.solid ? 'vpin vpin--solid' : 'vpin');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  const panel = el('div', 'vpin__panel');

  const face = el('div', 'vpin__face');
  if (opts.avatar) {
    const img = el('img');
    img.alt = '';
    img.src = opts.avatar;
    img.addEventListener('error', () => face.replaceChildren(el('span', 'vpin__initial', opts.initial || '؟')), { once: true });
    face.append(img);
  } else face.append(el('span', 'vpin__initial', opts.initial || '؟'));

  const title = el('h2', 'vpin__title', opts.title);
  const subtitle = el('p', 'vpin__subtitle', opts.subtitle ?? '');
  const lengths = el('div', 'vpin__lengths');
  lengths.setAttribute('role', 'radiogroup');
  lengths.setAttribute('aria-label', 'طول الرمز');
  const dots = el('div', 'vpin__dots');
  dots.setAttribute('aria-live', 'polite');
  const note = el('p', 'vpin__note', '');
  note.setAttribute('role', 'status');
  const pad = el('div', 'vpin__pad');

  const keys = [];
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'cancel', '0', 'back']) {
    const b = el('button', 'vpin__key');
    b.type = 'button';
    if (k === 'cancel') {
      b.className = 'vpin__key vpin__key--text';
      b.textContent = opts.cancelLabel === null ? '' : opts.cancelLabel ?? 'إلغاء';
      if (opts.cancelLabel === null) b.disabled = true, b.style.visibility = 'hidden';
      b.onclick = () => cancel();
    } else if (k === 'back') {
      b.className = 'vpin__key vpin__key--text';
      b.innerHTML = BACKSPACE;
      b.setAttribute('aria-label', 'احذف رقمًا');
      b.onclick = () => erase();
    } else {
      b.textContent = k;
      b.dataset.digit = k;
      b.onclick = () => press(k);
    }
    keys.push(b);
    pad.append(b);
  }

  panel.append(face, title, subtitle, lengths, dots, note, pad);
  root.append(panel);
  mount.append(root);
  requestAnimationFrame(() => root.classList.add('vpin--in'));

  function paintDots() {
    dots.replaceChildren(
      ...Array.from({ length: digits }, (_, i) => {
        const d = el('i', i < value.length ? 'vpin__dot vpin__dot--on' : 'vpin__dot');
        return d;
      }),
    );
    dots.setAttribute('aria-label', `${value.length} من ${digits}`);
  }

  function paintLengths() {
    lengths.hidden = step !== 'choose' && step !== 'create';
    lengths.replaceChildren(
      ...[4, 6].map((n) => {
        const b = el('button', `vpin__len${digits === n ? ' vpin__len--on' : ''}`, `${n} أرقام`);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(digits === n));
        b.onclick = () => {
          digits = n;
          value = '';
          paintLengths();
          paintDots();
        };
        return b;
      }),
    );
  }

  function setStep(next) {
    step = next;
    value = '';
    if (mode === 'create') {
      if (step === 'choose' || step === 'create') {
        subtitle.textContent = opts.subtitle ?? 'اختر طول الرمز ثم اكتبه';
        step = 'create';
      } else if (step === 'confirm') subtitle.textContent = 'اكتبه مرة ثانية للتأكيد';
    }
    paintLengths();
    paintDots();
  }

  const setKeysDisabled = (on) => keys.forEach((k) => k.dataset.digit !== undefined && (k.disabled = on));

  function shake(message) {
    note.textContent = message;
    note.classList.add('vpin__note--error');
    panel.classList.remove('vpin__panel--shake');
    void panel.offsetWidth;
    panel.classList.add('vpin__panel--shake');
    try {
      navigator.vibrate?.(40);
    } catch {
      // لا اهتزاز: الحركة تكفي
    }
    value = '';
    paintDots();
  }

  function lockUntil(retryAt) {
    clearInterval(lockTimer);
    setKeysDisabled(true);
    value = '';
    paintDots();
    note.classList.add('vpin__note--error');
    const tick = () => {
      const left = retryAt - Date.now();
      if (left <= 0) {
        clearInterval(lockTimer);
        setKeysDisabled(false);
        note.classList.remove('vpin__note--error');
        note.textContent = 'جرّب الحين';
        return;
      }
      note.textContent = `محاولات كثيرة. جرّب بعد ${clock(left)}`;
    };
    tick();
    lockTimer = setInterval(tick, 500);
  }

  async function complete() {
    if (mode === 'create') {
      if (step === 'create') {
        first = value;
        setStep('confirm');
        return;
      }
      if (value !== first) {
        setStep('create');
        shake('الرمزان غير متطابقين. ابدأ من جديد');
        return;
      }
    }
    busy = true;
    setKeysDisabled(true);
    note.classList.remove('vpin__note--error');
    note.textContent = '';
    let out;
    try {
      out = await opts.submit(value);
    } catch {
      out = { error: 'network' };
    }
    busy = false;
    if (out?.ok) {
      root.classList.add('vpin--done');
      setTimeout(() => close(), 160);
      opts.onDone?.();
      return;
    }
    setKeysDisabled(false);
    if (out?.error === 'pin_locked' && out.retryAt) return lockUntil(out.retryAt);
    if (out?.error === 'network') return shake('ما فيه اتصال. حاول مرة ثانية');
    if (mode === 'create') {
      setStep('create');
      return shake(out?.message ?? 'تعذّر الحفظ. حاول مرة ثانية');
    }
    shake(out?.message ?? 'رمز غير صحيح');
  }

  function press(d) {
    if (busy || value.length >= digits) return;
    value += d;
    note.textContent = '';
    note.classList.remove('vpin__note--error');
    paintDots();
    if (value.length === digits) setTimeout(() => void complete(), 90);
  }
  function erase() {
    if (busy || !value) return;
    value = value.slice(0, -1);
    paintDots();
  }
  function cancel() {
    if (opts.cancelLabel === null) return;
    close();
    opts.onCancel?.();
  }

  function onKey(e) {
    if (/^[0-9٠-٩]$/.test(e.key)) press(String('0123456789٠١٢٣٤٥٦٧٨٩'.indexOf(e.key) % 10));
    else if (e.key === 'Backspace') erase();
    else if (e.key === 'Escape') cancel();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
  document.addEventListener('keydown', onKey, true);

  function close() {
    clearInterval(lockTimer);
    document.removeEventListener('keydown', onKey, true);
    root.classList.remove('vpin--in');
    setTimeout(() => root.remove(), 220);
  }

  setStep(step);
  return { close, lockUntil };
}
