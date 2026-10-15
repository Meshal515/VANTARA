/**
 * شاشة الغرفة («مشاهدة معًا» قبل البدء) داخل المشغّل — للكمبيوتر والجوال.
 *
 *   خلفية: بنر العمل صافيًا بلا ضبابية، وتعتيم من الأسفل فقط.
 *   أعلى: «مشاهدة معًا» ونقطة الاتصال، وزر خروج.
 *   الشعار (أو الاسم) كبيرًا وتحته سطر واحد: النوع · الحلقة · عنوانها.
 *   شريط سفلي واحد: الوجوه متراكبة (المدعو ينبض حتى يدخل) · جملة حالة واحدة حيّة ·
 *   سطر السيرفر «KWM · 720p · جاهز · غيّر» · «⋯» (فيه ديلاي فيديوك) · زر البدء بلون القسم.
 *   عند «ابدأ»: عدّ 3-2-1 مشترك يبدأ بعده الكل في اللحظة نفسها.
 *
 * عرض فقط: كل القرارات عند together-player.js والمشغّل.
 */

import { stateLabel } from '../../v35/together.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const btn = (cls, html, onClick, label) => {
  const b = el('button', cls);
  b.type = 'button';
  b.innerHTML = html;
  if (label) b.setAttribute('aria-label', label);
  b.onclick = (e) => { e.stopPropagation(); onClick(); };
  return b;
};
const ICON = {
  close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  more: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5.5 19 12 8 18.5Z"/></svg>',
  server: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="3.5" y="4" width="17" height="6.5" rx="2"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="2"/><path d="M12 7.25h5M12 16.75h5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
};

/** «+10.0 ث» / «0 ث». */
export const offsetLabel = (ms) => (ms ? `${ms > 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(1)} ث` : '0 ث');

/** المدعوون الذين لم يدخلوا بعد (الدعوة «للكل» لا تُعدّ أسماءً). */
export function pendingInvitees(invited, roster, me, personOf) {
  if (!Array.isArray(invited)) return [];
  const inside = new Set(roster.map((r) => r.userId));
  return invited.filter((id) => id !== me && !inside.has(id)).map((id) => personOf(id));
}

/** أسماء قصيرة: «منصور» / «منصور ودحمي» / «منصور ودحمي و2 غيرهم». */
const names = (list) => `${list.slice(0, 2).join(' و')}${list.length > 2 ? ` و${list.length - 2} غيرهم` : ''}`;

/** جملة الحالة الواحدة في الشريط — حيّة وبلا تكرار. */
export function lobbyHeadline({ host, me = null, prepared, failed, blocked, connection, roster = [], pending = [] }) {
  if (connection !== 'live') return connection === 'reconnecting' ? 'انقطع الاتصال · نعيد الاتصال…' : 'جاري الاتصال بالغرفة…';
  if (blocked) return 'المتصفح يحتاج ضغطة منك لتشغيل الفيديو';
  if (failed) return 'تعذّر سيرفرك · اختر سيرفرًا آخر';
  if (!prepared) return 'نجهّز فيديوك…';
  const others = roster.filter((r) => r.userId !== me);
  const waiting = pending.map((p) => p.displayName);
  const broken = others.filter((r) => r.state === 'failed').map((r) => r.name);
  const preparing = others.filter((r) => r.state === 'preparing').map((r) => r.name);
  if (waiting.length) return `${names(waiting)} ${waiting.length > 1 ? 'ما دخلوا' : 'ما دخل'} بعد`;
  if (broken.length) return `سيرفر ${names(broken)} تعذّر`;
  if (preparing.length) return `${names(preparing)} ${preparing.length > 1 ? 'يجهّزون' : 'يجهّز'}…`;
  if (!others.length) return host ? 'فيديوك جاهز · ابدأ متى ما تبي' : 'فيديوك جاهز · بانتظار المضيف';
  return host ? 'الكل جاهز' : 'الكل جاهز · بانتظار المضيف';
}

/**
 * @param {HTMLElement} host
 * @param {object} m النموذج: art, kindText, episodeText, roster, pending, me, host, prepared, failed, blocked,
 *   connection, server{code,quality}, offset, accent, countdownTo, now()
 * @param {object} a الأفعال: avatar, start, resume, changeServer, leave, setOffset
 */
export function renderLobby(host, m, a) {
  clearInterval(host._countdown);
  const moreOpen = host.querySelector('.pl-more')?.hidden === false;
  host.replaceChildren();
  host.classList.toggle('is-host', m.host);
  if (m.accent) host.style.setProperty('--pl-accent', m.accent);

  // الخلفية: البنر صافيًا، وتعتيم من الأسفل فقط حيث النص
  const bg = el('div', 'pl-bg');
  if (m.art.banner) {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.src = m.art.banner;
    img.onerror = () => img.remove();
    bg.append(img);
  }
  bg.append(el('i', 'pl-shade'));

  // الأعلى: «مشاهدة معًا» ونقطة الاتصال · خروج
  const top = el('div', 'pl-top');
  const live = el('span', `pl-live is-${m.connection === 'live' ? 'ok' : 'warn'}`);
  live.append(el('i'), el('span', null, m.connection === 'live' ? 'مشاهدة معًا' : (m.connectionText ?? 'جاري الاتصال…')));
  top.append(live, btn('pl-close', ICON.close, a.leave, 'اطلع من الغرفة'));

  // الشعار أو الاسم، وسطر واحد تحته
  const hero = el('div', 'pl-hero');
  const name = el('h1', 'pl-title', m.art.title);
  name.dir = 'auto';
  if (m.art.logo) {
    const logo = new Image();
    logo.className = 'pl-logo';
    logo.alt = m.art.title;
    logo.src = m.art.logo;
    logo.onload = () => { if (logo.naturalWidth > 1 && name.isConnected) name.replaceWith(logo); };
  }
  hero.append(name);
  const meta = [...new Set([m.kindText, m.episodeText].filter(Boolean))];
  if (m.art.episodeTitle) meta.push(m.art.episodeTitle);
  if (meta.length) { const line = el('p', 'pl-meta', meta.join(' · ')); line.dir = 'auto'; hero.append(line); }

  // الشريط: الوجوه · الحالة والسيرفر · ⋯ والبدء
  const bar = el('div', 'pl-bar');
  const faces = el('div', 'pl-faces');
  const people = [...m.roster].sort((x, y) => Number(y.host) - Number(x.host));
  const shown = [
    ...people.map((r) => ({ person: { userId: r.userId, displayName: r.name, avatarKey: r.avatarKey ?? null }, state: r.state, host: r.host, label: `${r.userId === m.me ? 'أنت' : r.name} · ${r.state === 'failed' ? 'تعذّر السيرفر' : r.state === 'preparing' ? 'يجهّز' : stateLabel(r.state)}` })),
    ...m.pending.map((p) => ({ person: p, state: 'pending', host: false, label: `${p.displayName} · ما دخل بعد` })),
  ];
  for (const f of shown.slice(0, 5)) {
    const face = el('span', `pl-face is-${f.state}${f.host ? ' is-host' : ''}`);
    face.title = f.label;
    face.setAttribute('aria-label', f.label);
    face.append(a.avatar(f.person, 44));
    faces.append(face);
  }
  if (shown.length > 5) faces.append(el('span', 'pl-face pl-more-count', `+${shown.length - 5}`));

  const info = el('div', 'pl-info');
  const status = el('p', `pl-status${m.failed ? ' is-bad' : ''}`, lobbyHeadline(m));
  status.setAttribute('role', 'status');
  const server = el('p', 'pl-server');
  const code = el('bdi', null, m.server?.code ? `${m.server.code}${m.server.quality ? ` · ${m.server.quality}` : ''}` : 'سيرفرك');
  const state = el('span', `pl-server-state is-${m.failed ? 'bad' : m.prepared ? 'ok' : 'warn'}`, m.failed ? 'تعذّر' : m.prepared ? 'جاهز' : 'يتجهّز…');
  server.append(code, el('span', 'pl-dot', '·'), state, btn('pl-link', 'غيّر', a.changeServer, 'غيّر السيرفر'));
  info.append(status, server);

  const cta = el('div', 'pl-cta');
  const moreBtn = btn('pl-icon', ICON.more, () => { more.hidden = !more.hidden; moreBtn.setAttribute('aria-expanded', String(!more.hidden)); }, 'المزيد');
  moreBtn.setAttribute('aria-expanded', String(moreOpen));
  cta.append(moreBtn);
  if (m.blocked) cta.append(btn('pl-go', `${ICON.play}<span>تابع معهم</span>`, a.resume));
  else if (m.host) {
    const go = btn('pl-go', `${ICON.play}<span>ابدأ</span>`, a.start, 'ابدأ للجميع');
    go.disabled = !m.prepared || m.connection !== 'live';
    cta.append(go);
  } else cta.append(el('span', 'pl-wait', 'بانتظار المضيف'));
  bar.append(faces, info, cta);

  // «⋯»: ديلاي فيديوك (نادر الاستعمال، فمكانه هنا لا في الواجهة)
  const more = el('div', 'pl-more');
  more.hidden = !moreOpen;
  const row = el('div', 'pl-more-row');
  const label = el('span', 'pl-more-label');
  label.append(el('b', null, 'ديلاي فيديوك'), el('small', null, 'لك وحدك · إذا مصدرك متقدّم أو متأخر عنهم'));
  const step = el('div', 'pl-step');
  step.dir = 'ltr';
  const out = el('output', null, offsetLabel(m.offset));
  out.setAttribute('aria-live', 'polite');
  step.append(btn('pl-step-btn', '−', () => a.setOffset(m.offset - 500), 'أخّر فيديوك نصف ثانية'), out, btn('pl-step-btn', '+', () => a.setOffset(m.offset + 500), 'قدّم فيديوك نصف ثانية'));
  row.append(label, step);
  if (m.offset) row.append(btn('pl-link', 'صفّر', () => a.setOffset(0), 'إلغاء الديلاي'));
  more.append(row);

  host.append(bg, top, hero, more, bar);

  // العدّ التنازلي المشترك: رقم كبير فوق كل شيء حتى لحظة البدء
  if (m.countdownTo && m.now) {
    const count = el('div', 'pl-count');
    count.setAttribute('role', 'timer');
    const num = el('b');
    count.append(num, el('span', null, 'نبدأ مع بعض'));
    host.append(count);
    host.classList.add('is-counting');
    const tick = () => {
      const left = Math.ceil((m.countdownTo - m.now()) / 1000);
      if (left <= 0) { clearInterval(host._countdown); count.remove(); host.classList.remove('is-counting'); return; }
      if (num.textContent !== String(left)) { num.textContent = String(left); num.classList.remove('is-tick'); void num.offsetWidth; num.classList.add('is-tick'); }
    };
    tick();
    host._countdown = setInterval(tick, 100);
  } else host.classList.remove('is-counting');
}
