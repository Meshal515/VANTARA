/**
 * قطع الاجتماع المشتركة: الأصدقاء والمجلس يرسمان الأشخاص والأوقات بنفس اليد.
 *
 * شارة المالك تأتي من الخادم (`accounts.badge`) — لا يضعها أحد لنفسه.
 */

import { gsap } from '../vendor/gsap.esm.js';

export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
export const parse = (text, fallback) => {
  try {
    return JSON.parse(text ?? '') ?? fallback;
  } catch {
    return fallback;
  }
};
const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
/** GSAP ما لم يطلب النظام تقليل الحركة؛ `null` = الحالة النهائية فورًا. */
export const motion = () => (reduced() ? null : gsap);

/**
 * شارة المالك: درعٌ صغير بحرف V مفرّغ. ليست علامة توثيق زرقاء: لونها ذهبي
 * هادئ، وحجمها من حجم السطر فلا تكسر ارتفاعه.
 */
export function ownerBadge() {
  const s = el('span', 'sx-badge');
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', 'مالك المجلس');
  s.innerHTML =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.1 13.7 3.6v4.2c0 3.3-2.3 5.8-5.7 7C4.6 13.6 2.3 11.1 2.3 7.8V3.6Z" fill="currentColor"/><path d="m5.3 6.1 2.7 4.6 2.7-4.6" fill="none" stroke="var(--bg)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return s;
}

/** الأشخاص من المرآة: الاسم، الصورة، والشارة. */
export function people(sync) {
  const me = () => sync.user?.userId;
  const profile = (id) => sync.rows('profiles', (p) => p.user_id === id)[0];
  const account = (id) => sync.rows('accounts', (a) => a.user_id === id)[0];
  const nameOf = (id) => profile(id)?.display_name || account(id)?.username || 'صديق';
  return {
    me,
    nameOf,
    isOwner: (id) => account(id)?.badge === 'owner',
    personOf: (id) => ({ userId: id, displayName: nameOf(id), avatarKey: profile(id)?.avatar_key ?? null }),
    friendIds: () =>
      sync
        .rows('accounts', () => true)
        .map((a) => a.user_id)
        .filter((id) => id !== me()),
    memberIds: () => sync.rows('accounts', () => true).map((a) => a.user_id),
  };
}

/** اسمٌ بشارته إن كان المالك. `you`: «أنت» مكان اسمك. */
export function nameNode(kit, id, { cls = 'sx-name', you = false } = {}) {
  const wrap = el('span', `${cls}-wrap`);
  wrap.append(el('bdi', cls, you && id === kit.me() ? 'أنت' : kit.nameOf(id)));
  if (kit.isOwner(id)) wrap.append(ownerBadge());
  return wrap;
}

/** «12 د»، «3 س»، «أمس»: قصيرة، للأطراف لا للجمل. */
export function shortAgo(at, now = Date.now()) {
  if (!at) return '';
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} س`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'أمس';
  if (days < 7) return `${days} ي`;
  return new Date(at).toLocaleDateString('ar', { day: 'numeric', month: 'short', numberingSystem: 'latn' });
}
export const clockTime = (at) => new Date(at).toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit', numberingSystem: 'latn' });
export function dayLabel(at, now = Date.now()) {
  const start = new Date(now).setHours(0, 0, 0, 0);
  if (at >= start) return 'اليوم';
  if (at >= start - 86_400_000) return 'أمس';
  return new Date(at).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long', numberingSystem: 'latn' });
}

/** حالة الحضور بكلمة: يقرأ/يشاهد/متصل/خامل/منذ. */
export function presenceState(p) {
  const status = p?.status ?? 'OFFLINE';
  const watching = p?.screen === 'ANIME' || String(p?.seriesRef ?? '').startsWith('anime:');
  if (status === 'READING') return { tone: 'live', verb: watching ? 'يشاهد' : 'يقرأ', watching };
  if (status === 'ONLINE') return { tone: 'on', verb: 'متصل' };
  if (status === 'IDLE') return { tone: 'idle', verb: 'خامل' };
  return { tone: 'off', verb: p?.lastSeenAt ? shortAgo(p.lastSeenAt) : '' };
}

/** لمسة: انكماش قصير ورجوع بلا ارتداد مبالغ. */
export function pressable(node, scale = 0.97) {
  node.addEventListener('pointerdown', () => motion()?.to(node, { scale, duration: 0.1, ease: 'power2.out' }));
  const up = () => motion()?.to(node, { scale: 1, duration: 0.28, ease: 'power3.out' });
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('pointerleave', up);
  return node;
}

/**
 * ضغطة مطوّلة (تلغي اللمسة العادية بعدها)، والتمرير يلغيها. زر الفأرة الأيمن
 * يفتحها أيضًا.
 */
export function onLongPress(node, run, ms = 420) {
  let t = null;
  let start = null;
  node.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY };
    t = setTimeout(() => {
      t = null;
      node.dataset.longPressed = '1';
      navigator.vibrate?.(10);
      run();
    }, ms);
  });
  const cancel = () => {
    clearTimeout(t);
    t = null;
  };
  node.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel();
  });
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cancel();
    node.dataset.longPressed = '1';
    run();
  });
  node.addEventListener(
    'click',
    (e) => {
      if (!node.dataset.longPressed) return;
      delete node.dataset.longPressed;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
}

/** ورقة إجراءات حديثة: صفوف كبيرة، والخطِر أحمر وفي الآخر. */
export function actionList(items, close) {
  const list = el('div', 'sx-actions');
  for (const it of items.filter(Boolean)) {
    const b = el('button', `sx-action${it.danger ? ' sx-action--danger' : ''}`);
    b.type = 'button';
    b.innerHTML = it.icon;
    b.append(el('span', null, it.label));
    b.onclick = () => {
      close();
      it.run();
    };
    list.append(b);
  }
  motion()?.fromTo(list.children, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.24, ease: 'power2.out', stagger: 0.03, clearProps: 'all' });
  return list;
}

/** حرف المجلس حين لا صورة له: أول حرف من اسمه بلا «ال». */
export function roomInitial(name) {
  const n = String(name || 'مجلس').trim().replace(/^ال/, '');
  return [...n][0] ?? 'م';
}
