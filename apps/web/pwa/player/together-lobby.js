/**
 * شاشة الغرفة («مشاهدة معًا» قبل البدء) داخل المشغّل — للكمبيوتر والجوال.
 *
 *   بنر الحلقة خلفية · شعار العمل أو اسمه · الحلقة وعنوانها
 *   الأفاتارات بحالاتها (جاهز / يجهّز / تعذّر) والمدعوون الذين لم يدخلوا «بانتظار…»
 *   سيرفرك وحالته (جاهز ومتوقف عند البداية) وزر تغييره · ديلاي فيديوك أنت
 *   المضيف: «ابدأ للجميع» · الضيف: «بانتظار المضيف» · «اطلع من الغرفة»
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
  leave: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 8l-4 4 4 4M5 12h10"/></svg>',
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

/** سطر الحالة الكبير تحت الأشخاص. */
export function lobbyHeadline({ host, prepared, failed, blocked, connection, roster, pending }) {
  if (connection !== 'live') return connection === 'reconnecting' ? 'انقطع الاتصال · نعيد الاتصال…' : 'جاري الاتصال بالغرفة…';
  if (blocked) return 'المتصفح يحتاج ضغطة منك لتشغيل الفيديو';
  if (failed) return 'تعذّر تشغيل سيرفرك · اختر سيرفرًا آخر';
  if (!prepared) return 'نجهّز فيديوك من سيرفرك…';
  const waitingFor = pending.length ? `بانتظار ${pending.slice(0, 2).map((p) => p.displayName).join(' و')}${pending.length > 2 ? ` و${pending.length - 2} غيرهم` : ''}…` : '';
  const notReady = roster.filter((r) => r.state === 'preparing' || r.state === 'failed').length;
  if (host) return waitingFor || (notReady ? `${roster.length - notReady} من ${roster.length} جاهزين · ابدأ متى ما تبي` : 'الكل جاهز · ابدأ متى ما تبي');
  return waitingFor ? `فيديوك جاهز · ${waitingFor}` : 'فيديوك جاهز ومتوقف عند البداية · بانتظار المضيف';
}

/**
 * @param {HTMLElement} host
 * @param {object} m النموذج
 * @param {object} a الأفعال
 */
export function renderLobby(host, m, a) {
  host.replaceChildren();
  host.classList.toggle('is-host', m.host);
  // الخلفية: بنر الحلقة
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

  // الأعلى: اطلع · نوع الغرفة والاتصال
  const top = el('div', 'pl-top');
  const chips = el('div', 'pl-chips');
  chips.append(el('span', 'pl-chip', `${m.kindText} · مشاهدة معًا · متزامنة`));
  const conn = el('span', `pl-chip pl-conn is-${m.connection === 'live' ? 'ok' : 'warn'}`);
  conn.append(el('i'), el('span', null, m.connectionText));
  chips.append(conn);
  top.append(chips, btn('pl-leave', `${ICON.leave}<span>اطلع من الغرفة</span>`, a.leave));

  // البطل: الشعار أو الاسم + الحلقة
  const hero = el('div', 'pl-hero');
  const name = el('h1', 'pl-title', m.art.title);
  name.dir = 'auto';
  if (m.art.logo) {
    const logo = new Image();
    logo.className = 'pl-logo';
    logo.alt = m.art.title;
    logo.src = m.art.logo;
    // لا شعار؟ الاسم الطبيعي
    logo.onload = () => { if (logo.naturalWidth > 1) name.replaceWith(logo); };
  }
  hero.append(name);
  if (m.episodeText || m.art.episodeTitle) {
    const ep = el('p', 'pl-ep');
    if (m.episodeText) ep.append(el('b', null, m.episodeText));
    if (m.art.episodeTitle) { const t = el('bdi', null, m.art.episodeTitle); ep.append(t); }
    hero.append(ep);
  }

  // الأشخاص
  const people = el('div', 'pl-people');
  for (const r of m.roster) {
    const p = el('div', `pl-person is-${r.state}`);
    const face = el('span', 'pl-face');
    face.append(a.avatar({ userId: r.userId, displayName: r.name, avatarKey: r.avatarKey ?? null }, 64));
    if (r.host) face.append(el('em', 'pl-crown', 'المضيف'));
    p.append(face, el('b', null, r.userId === m.me ? 'أنت' : r.name), el('small', null, r.state === 'failed' ? 'تعذّر السيرفر' : r.state === 'preparing' ? 'يجهّز…' : stateLabel(r.state)));
    people.append(p);
  }
  for (const person of m.pending) {
    const p = el('div', 'pl-person is-pending');
    const face = el('span', 'pl-face');
    face.append(a.avatar(person, 64));
    p.append(face, el('b', null, person.displayName), el('small', null, 'بانتظاره…'));
    people.append(p);
  }

  const headline = el('p', `pl-headline${m.failed ? ' is-bad' : ''}`, lobbyHeadline(m));
  headline.setAttribute('role', 'status');

  // سيرفرك + ديلاي فيديوك
  const card = el('div', 'pl-card');
  const server = el('div', 'pl-row');
  const sIcon = el('span', 'pl-row-icon');
  sIcon.innerHTML = ICON.server;
  const sText = el('span', 'pl-row-text');
  sText.append(el('small', null, 'سيرفرك'));
  const sVal = el('b');
  sVal.dir = 'ltr';
  sVal.textContent = m.server?.code ? `${m.server.code}${m.server.quality ? ` · ${m.server.quality}` : ''}` : '—';
  sText.append(sVal);
  const sState = el('span', `pl-state is-${m.failed ? 'bad' : m.prepared ? 'ok' : 'warn'}`);
  const sLabel = el('span', null, m.failed ? 'تعذّر' : m.prepared ? 'جاهز' : 'يتجهّز…');
  if (m.prepared && !m.failed) sLabel.append(el('span', 'pl-long', ' · متوقف عند البداية'));
  sState.append(el('i'), sLabel);
  server.append(sIcon, sText, sState, btn('pl-mini', 'غيّر', a.changeServer, 'غيّر السيرفر'));
  card.append(server);

  const delay = el('div', 'pl-row');
  const dIcon = el('span', 'pl-row-icon');
  dIcon.innerHTML = ICON.clock;
  const dText = el('span', 'pl-row-text');
  dText.append(el('small', null, 'ديلاي فيديوك (لك وحدك)'), el('b', null, m.offset ? 'مضبوط على مصدرك' : 'بدون'));
  const step = el('div', 'pl-step');
  step.dir = 'ltr';
  const out = el('output', null, offsetLabel(m.offset));
  out.setAttribute('aria-live', 'polite');
  step.append(btn('pl-step-btn', '−', () => a.setOffset(m.offset - 500), 'أخّر فيديوك نصف ثانية'), out, btn('pl-step-btn', '+', () => a.setOffset(m.offset + 500), 'قدّم فيديوك نصف ثانية'));
  delay.append(dIcon, dText, step);
  if (m.offset) delay.append(btn('pl-mini', 'صفّر', () => a.setOffset(0), 'إلغاء الديلاي'));
  card.append(delay);
  card.append(el('p', 'pl-hint', 'مصدرك فيه مقدمة زيادة؟ زِد الديلاي (+) حتى تشوفون نفس المشهد. ما يتغيّر شيء عند الباقين.'));

  // الأفعال
  const actions = el('div', 'pl-actions');
  if (m.blocked) actions.append(btn('pl-go', `${ICON.play}<span>تابع معهم</span>`, a.resume));
  else if (m.host) {
    const go = btn('pl-go', `${ICON.play}<span>ابدأ للجميع</span>`, a.start);
    go.disabled = !m.prepared || m.connection !== 'live';
    actions.append(go);
  } else {
    const wait = el('div', 'pl-wait');
    wait.append(el('i'), el('span', null, 'بانتظار المضيف يبدأ'));
    actions.append(wait);
  }

  const main = el('div', 'pl-main');
  const side = el('div', 'pl-side');
  side.append(people, headline, card, actions);
  main.append(hero, side);
  host.append(bg, top, main);
}
