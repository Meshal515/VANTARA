/**
 * التنبيه الجانبي داخل التطبيق.
 *
 * غير حاجب بقصد: يظهر في زاوية، ولا يأخذ التركيز، ولا يوقف القراءة. الحاجب في
 * منتصف الشاشة أثناء فصل مفتوح أسوأ من لا تنبيه.
 *
 * ولا يوجد أي إشعار من نظام التشغيل: لا FCM، ولا إذن إشعارات، ولا تنبيه
 * والتطبيق مغلق. هذا المسار كله داخل VANTARA وهو مفتوح.
 */

/** أكثر من ثلاثة في وقت واحد يصبح حائطًا لا تنبيهًا. */
const MAX_VISIBLE = 3;
const LIFETIME_MS = 5_000;

let host = null;

function ensureHost() {
  if (host?.isConnected) return host;
  host = document.createElement('div');
  host.className = 'toasts';
  // منطقة حيّة مهذّبة: قارئ الشاشة يسمعها بين الفقرات لا يقطع بها
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  document.body.append(host);
  return host;
}

/**
 * يعرض تنبيهًا ويرجع دالة إخفائه.
 *
 * `onOpen` اختياري: النقر يفتح المكان الصحيح داخل التطبيق ثم يُخفي التنبيه.
 */
export function showToast({ title, body = '', onOpen = null, lifetimeMs = LIFETIME_MS, avatar = null }) {
  const root = ensureHost();
  while (root.childElementCount >= MAX_VISIBLE) root.firstElementChild?.remove();

  const card = document.createElement(onOpen ? 'button' : 'div');
  card.className = avatar ? 'toast toast--person' : 'toast';
  if (onOpen) card.type = 'button';

  // وجه المرسل أولًا: «مشعل أرسل لك فريم» تُعرف من الصورة قبل أن تُقرأ
  if (avatar) {
    const face = document.createElement(avatar.src ? 'img' : 'span');
    face.className = 'toast__face';
    if (avatar.src) {
      face.alt = '';
      face.src = avatar.src;
    } else {
      face.textContent = [...String(avatar.name || '؟')][0] ?? '؟';
    }
    card.append(face);
  }
  const copy = document.createElement('span');
  copy.className = 'toast__copy';
  const heading = document.createElement('strong');
  heading.className = 'toast__title';
  heading.textContent = title;
  copy.append(heading);

  if (body) {
    const text = document.createElement('span');
    text.className = 'toast__body';
    text.textContent = body;
    copy.append(text);
  }
  card.append(copy);

  let timer = null;
  const dismiss = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    card.classList.add('toast--out');
    // الإزالة بعد الانتقال، وبمهلة احتياطية: التبويب المخفي لا يُشغّل
    // `transitionend` فيبقى العنصر إلى الأبد
    const remove = () => card.remove();
    card.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, 400);
  };

  let suppressClick = false;
  if (onOpen) {
    card.addEventListener('click', () => {
      if (suppressClick) return;
      dismiss();
      onOpen();
    });
  }

  // سحبٌ لأعلى يُخفيه: تنبيه فوق الشريط العلوي لا يحجز أزراره
  let startY = null;
  card.addEventListener('pointerdown', (e) => (startY = e.clientY));
  card.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    const dy = Math.min(0, e.clientY - startY);
    card.style.transform = `translateY(${dy}px)`;
    if (dy < -28) {
      startY = null;
      suppressClick = true;
      dismiss();
    }
  });
  const reset = () => {
    startY = null;
    if (!card.classList.contains('toast--out')) card.style.transform = '';
  };
  card.addEventListener('pointerup', reset);
  card.addEventListener('pointercancel', reset);

  root.append(card);
  // إطار واحد قبل الحركة: بلا ذلك يُرسم في موضعه النهائي بلا انتقال
  requestAnimationFrame(() => card.classList.add('toast--in'));
  timer = setTimeout(dismiss, lifetimeMs);
  return dismiss;
}
