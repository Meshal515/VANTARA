/**
 * «من يتابع؟» — شاشة اختيار الحساب، بتصميم v35.
 *
 * اختيار الحساب **هو** تسجيل الدخول. لا كلمة مرور، ولا PIN، ولا معرّف يُكتب.
 * VANTARA تطبيق خاص بين أصدقاء، والاحتكاك هنا لا يشتري أمانًا يُذكر — يشتري
 * تأخيرًا في كل فتح.
 *
 *   فتح التطبيق → صور الحسابات → سحب → «متابعة» → داخل.
 *
 * الخلفية حريرٌ يأخذ لونه من صورة الحساب الذي في المنتصف، والشعار يتلوّن
 * معه. والحساب المستخدم الآن على جهاز آخر مقفل (انظر `gate-policy.js`) —
 * إلا حساب هذا الجهاز نفسه، فالخروج ثم العودة لا يقفل صاحبه خارج حسابه.
 */

import { gateEntry, rememberGateAccount, rememberedGateAccount } from '../lib/gate-policy.js';
import { cachedSilkPalette, createSilk, followImage, silkPaletteForSrc } from '../lib/silk.js';
import { logoColorFromPalette, rgb01ToHex, silkPaletteFor } from '../lib/silk-palette.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** «قبل 32 دقيقة» بلا مكتبة تواريخ. */
function agoLabel(timestamp) {
  if (!timestamp) return 'لم يدخل بعد';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'قبل لحظات';
  if (minutes < 60) return `آخر ظهور قبل ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `آخر ظهور قبل ${hours} ساعة`;
  return `آخر ظهور قبل ${Math.floor(hours / 24)} يوم`;
}

function statusLine(account) {
  if (account.status === 'READING') return 'يقرأ الآن';
  if (account.status === 'ONLINE') return 'متصل الآن';
  if (account.status === 'IDLE') return 'خامل';
  return agoLabel(account.lastSeenAt);
}

const LOCK_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.85" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"></rect>' +
  '<path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>';

function readableSrc(src) {
  try {
    const u = new URL(src, location.href);
    return u.origin === location.origin || u.pathname.startsWith('/v1/media/');
  } catch {
    return false;
  }
}

/** اللوحة الفورية: المحفوظة من تحليل سابق للصورة، وإلا لون الحساب أو اسمه. */
function immediatePalette(account) {
  return cachedSilkPalette(account.avatarKey) ?? silkPaletteFor(account);
}

export async function screenAccounts({ sync, mount, onSignedIn }) {
  const gate = el('main', 'gate');
  const backdrop = el('div', 'gate__backdrop');
  const canvas = el('canvas', 'gate__canvas');
  backdrop.append(canvas);
  backdrop.setAttribute('aria-hidden', 'true');
  const shade = el('div', 'gate__shade');
  shade.setAttribute('aria-hidden', 'true');

  const inner = el('section', 'gate__inner');
  const brand = el('header', 'gate__brand');
  brand.setAttribute('aria-label', 'VANTARA');
  const logo = el('div', 'gate__logo-mark');
  logo.setAttribute('aria-hidden', 'true');
  brand.append(logo, el('h1', 'gate__question', 'من يتابع؟'));

  const flow = el('div', 'gate-flow');
  flow.tabIndex = 0;
  flow.setAttribute('role', 'listbox');
  flow.setAttribute('aria-label', 'اختر حسابك');
  const stage = el('div', 'gate-flow__stage');
  flow.append(stage);

  const caption = el('div', 'gate__caption');
  const nameEl = el('h2', 'gate__name', '');
  const statusEl = el('p', 'gate__status', '');
  caption.append(nameEl, statusEl);

  const enter = el('button', 'gate__enter');
  enter.type = 'button';
  const message = el('p', 'gate__message');
  const hint = el('div', 'gate__hint', 'اسحب يمينًا أو يسارًا للتبديل');

  inner.append(brand, flow, caption, enter, message, hint);
  gate.append(backdrop, shade, inner);
  mount(gate);

  // ───────────────────────── الحسابات ─────────────────────────

  let accounts = [];
  try {
    accounts = await sync.accounts();
  } catch {
    message.classList.add('gate__message--error');
    message.textContent = 'تعذّر الوصول إلى الخادم. تحقّق من الاتصال.';
    return () => {};
  }
  if (accounts.length === 0) {
    message.textContent = 'لا توجد حسابات.';
    return () => {};
  }

  const remembered = rememberedGateAccount();
  // يبدأ من حساب هذا الجهاز: الفتح التالي لمسة واحدة لا سحبًا
  const startAt = Math.max(0, accounts.findIndex((a) => a.userId === remembered));

  const silk = createSilk(canvas, immediatePalette(accounts[startAt]));
  const tint = (palette) => {
    silk.setPalette(palette);
    gate.style.setProperty('--gate-logo', logoColorFromPalette(palette));
  };

  // ───────────────────────── البطاقات ─────────────────────────

  const followers = [];
  const faces = accounts.map((account, index) => {
    const card = el('div', 'gate-card');
    card.dataset.index = String(index);
    card.setAttribute('role', 'option');
    const face = el('div', 'gate-card__face');
    const fallbackFace = () => {
      const p = immediatePalette(account);
      const initial = el('div', 'gate-card__avatar', [...String(account.displayName || '؟')][0] || '؟');
      initial.style.background =
        `linear-gradient(150deg,${rgb01ToHex(p[3])},${rgb01ToHex(p[2])} 56%,${rgb01ToHex(p[1])})`;
      face.replaceChildren(initial);
    };
    if (account.avatarKey) {
      const img = el('img', 'gate-card__avatar');
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      img.addEventListener('error', fallbackFace, { once: true });
      // صورة تُقرأ بكسلاتها (أصلنا أو خادم الوسائط): الحرير يتبعها إن تحركت
      if (readableSrc(account.avatarKey)) img.crossOrigin = 'anonymous';
      img.src = account.avatarKey;
      // متحركة: تتحرك في بطاقتها دائمًا، والحرير يتبعها وهي المختارة فقط
      if (img.crossOrigin) {
        followers.push(followImage(img, (palette) => {
          if (accounts[currentIndex] === account) tint(palette);
        }));
      }
      void silkPaletteForSrc(account.avatarKey).then((palette) => {
        if (palette && accounts[currentIndex] === account) tint(palette);
      });
      face.append(img);
    } else {
      fallbackFace();
    }
    card.append(face);
    if (account.active) card.append(el('span', 'gate-card__live'));
    stage.append(card);
    return card;
  });

  // ───────────────────────── الحركة (v35) ─────────────────────────

  let busy = false;
  let pos = startAt;
  let target = startAt;
  let currentIndex = -1;
  let raf = null;
  let drag = null;
  let width = 150;

  const count = accounts.length;
  const wrappedOffset = (i, v) => {
    let o = (((i - v) % count) + count) % count;
    if (o > count / 2) o -= count;
    return o;
  };
  const indexAt = (v) => ((Math.round(v) % count) + count) % count;

  function paint() {
    const pitch = width * 1.04;
    faces.forEach((card, i) => {
      const o = wrappedOffset(i, pos);
      const d = Math.abs(o);
      const r = Math.pow(d, 0.58);
      const tilt = Math.min(38 * r, 68) * Math.sign(o);
      const scale = Math.max(0.68, 1 - 0.12 * d);
      card.style.transform =
        `translate(-50%,-50%) translateX(${o * pitch}px) translateZ(${-0.42 * width * r}px) ` +
        `rotateY(${-tilt}deg) scale(${scale})`;
      const edge = Math.min(1, Math.max(0, (count / 2 - d) / 0.5));
      card.style.opacity = String(Math.max(0, 1 - 0.16 * d) * (count === 1 ? 1 : edge));
      card.style.zIndex = String(100 - Math.round(d * 10));
      card.classList.toggle('gate-card--center', d < 0.5);
      card.setAttribute('aria-selected', d < 0.5 ? 'true' : 'false');
    });
  }

  function updateSelected(force = false) {
    const i = indexAt(pos);
    if (!force && i === currentIndex) return;
    currentIndex = i;
    const account = accounts[i];
    const { locked } = gateEntry(account, remembered);
    nameEl.textContent = account.displayName;
    statusEl.textContent = statusLine(account);
    statusEl.classList.toggle('gate__status--live', Boolean(account.active));
    enter.disabled = locked || busy;
    enter.classList.toggle('gate__enter--locked', locked);
    enter.innerHTML = locked
      ? `<span class="gate__enter-lock">${LOCK_SVG}</span><span>متابعة</span>`
      : '<span>متابعة</span>';
    enter.setAttribute('aria-label', locked ? `حساب ${account.displayName} مستخدم الآن` : `متابعة بحساب ${account.displayName}`);
    message.classList.remove('gate__message--error');
    message.textContent = locked ? 'مستخدم الآن على جهاز آخر.' : '';
    tint(immediatePalette(account));
  }

  function settle(to) {
    if (raf !== null) cancelAnimationFrame(raf);
    target = to;
    const step = () => {
      const rem = target - pos;
      if (Math.abs(rem) < 0.0004) {
        pos = target;
        paint();
        updateSelected(true);
        raf = null;
        return;
      }
      pos += rem * 0.16;
      paint();
      updateSelected();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  const nudge = (by) => settle(Math.round(target) + by);

  function measure() {
    const first = faces[0];
    if (!first) return;
    width = first.getBoundingClientRect().width || 150;
    paint();
  }

  flow.addEventListener('pointerdown', (e) => {
    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    flow.setPointerCapture?.(e.pointerId);
    target = pos;
    drag = { id: e.pointerId, x: e.clientX, pos, v: 0, t: performance.now(), moved: 0 };
  });
  flow.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const pitch = width * 1.04;
    const now = performance.now();
    const before = pos;
    const dx = e.clientX - drag.x;
    drag.moved = Math.max(drag.moved, Math.abs(dx));
    // الاتجاه كما في v35: السحب لليسار يُحضر التالي في واجهة RTL
    pos = drag.pos - dx / pitch;
    drag.v = ((pos - before) / Math.max(now - drag.t, 1)) * 1000;
    drag.t = now;
    paint();
    updateSelected();
  });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const wasDrag = drag.moved > 6;
    const carried = Math.max(-2, Math.min(2, drag.v * 0.18));
    drag = null;
    settle(Math.round(pos + carried));
    if (!wasDrag && e.target.closest?.('.gate-card--center')) void chooseCurrent();
  };
  flow.addEventListener('pointerup', endDrag);
  flow.addEventListener('pointercancel', endDrag);
  flow.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') nudge(1);
    else if (e.key === 'ArrowRight') nudge(-1);
    else if (e.key === 'Enter' || e.key === ' ') void chooseCurrent();
    else return;
    e.preventDefault();
  });

  const resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(stage);

  // ───────────────────────── الدخول ─────────────────────────

  async function chooseCurrent() {
    const account = accounts[currentIndex];
    if (!account || busy || gateEntry(account, remembered).locked) return;
    busy = true;
    enter.disabled = true;
    message.classList.remove('gate__message--error');
    message.textContent = '';
    try {
      const user = await sync.signIn(account.userId);
      rememberGateAccount(account.userId);
      await onSignedIn(user);
    } catch (error) {
      busy = false;
      enter.disabled = false;
      if (error?.code === 'device_untrusted' && sync.requestDevice) return void showApproval(account);
      message.classList.add('gate__message--error');
      message.textContent = error?.status ? 'تعذّر الدخول. حاول مرة أخرى.' : 'ما فيه اتصال بالخادم. تأكد من النت وحاول مرة ثانية.';
    }
  }

  // ─────────────── جوال جديد: رمز يُعتمد مرة، ثم الدخول وحده ───────────────
  //
  // السيرفر لا يقبل إلا جوالًا اعتُمد. الجوال الجديد يطلب رمزًا قصيرًا، صاحبه
  // يرسله لمشعل، ومشعل يعتمده (سير «اعتماد جوال» في GitHub). التطبيق يسأل كل
  // بضع ثوانٍ، وأول ما يُعتمد يدخل بلا أي لمسة. الرمز وحده لا يفتح شيئًا: مربوط
  // بهذا الجوال.
  let approvalTimer = 0;
  let approval = null;
  async function showApproval(account) {
    clearTimeout(approvalTimer);
    approval?.remove();
    approval = el('div', 'gate-approval');
    approval.setAttribute('role', 'status');
    approval.append(el('strong', 'gate-approval__title', 'هالجوال جديد'));
    approval.append(el('p', 'gate-approval__text', 'من أي جوال داخل VANTARA: الإعدادات ← اعتماد جوال جديد، واكتب هالرمز. أول ما يُعتمد تدخل على طول.'));
    const codeEl = el('button', 'gate-approval__code', '····-····');
    codeEl.type = 'button';
    codeEl.setAttribute('aria-label', 'انسخ الرمز');
    const status = el('p', 'gate-approval__status', 'نجهّز الرمز…');
    approval.append(codeEl, status);
    message.textContent = '';
    message.classList.remove('gate__message--error');
    message.after(approval);
    enter.hidden = true;

    let code = '';
    let expiresAt = 0;
    try {
      ({ code, expiresAt } = await sync.requestDevice());
    } catch {
      status.textContent = 'ما قدرنا نطلب رمز. تأكد من النت.';
      enter.hidden = false;
      return;
    }
    codeEl.textContent = code;
    codeEl.onclick = async () => {
      try {
        await navigator.clipboard.writeText(code);
        status.textContent = 'انسخ ✓ — الصقه لمشعل';
      } catch {
        status.textContent = 'اضغط مطوّلًا على الرمز وانسخه';
      }
    };
    status.textContent = 'ننتظر الاعتماد…';
    const poll = async () => {
      if (!approval?.isConnected) return;
      if (Date.now() > expiresAt) {
        status.textContent = 'انتهت مدة الرمز.';
        const again = el('button', 'gate-approval__again', 'رمز جديد');
        again.type = 'button';
        again.onclick = () => void showApproval(account);
        status.append(' ', again);
        return;
      }
      try {
        const { paired } = await sync.claimDevice();
        if (paired) {
          status.textContent = 'اعتُمد ✓ — ندخلك…';
          approval.remove();
          approval = null;
          enter.hidden = false;
          return void chooseCurrent();
        }
      } catch {
        // انقطاع لحظي: السؤال التالي يكفي
      }
      approvalTimer = setTimeout(poll, 4000);
    };
    approvalTimer = setTimeout(poll, 4000);
  }
  enter.addEventListener('click', () => void chooseCurrent());

  measure();
  updateSelected(true);

  return () => {
    if (raf !== null) cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    for (const stop of followers) stop();
    clearTimeout(approvalTimer);
    silk.destroy();
  };
}
