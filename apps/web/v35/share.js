/**
 * الترشيح: عمل أو فصلٌ بعينه، لشخص أو للجميع.
 *
 * خطوتان: وجوه الأصدقاء و«الجميع»، ثم بطاقة ما ترشّحه ورسالتك ومن تخفيه عنه
 * في المجلس. الرجوع خطوة لا يضيّع ما كتبت. نفس الورقة من صفحة العمل ومن
 * القارئ — هناك يكون الترشيح للفصل الذي أمامك.
 */

import { glyph } from './icons.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function face(person, size) {
  if (person.everyone) {
    const s = el('span', 'avatar-letter share-everyone');
    s.innerHTML = glyph('users', { size: Math.round(size * 0.42) });
    s.style.cssText = `width:${size}px;height:${size}px;border-radius:99px;flex:none`;
    return s;
  }
  if (person.avatarKey) {
    const img = el('img');
    img.src = person.avatarKey;
    img.alt = '';
    img.style.cssText = `width:${size}px;height:${size}px;border-radius:99px;object-fit:cover;flex:none`;
    return img;
  }
  const s = el('span', 'avatar-letter', [...String(person.displayName || '؟')][0]);
  s.style.cssText = `width:${size}px;height:${size}px;border-radius:99px;flex:none`;
  return s;
}

/**
 * @param {{
 *   sync: any,
 *   friends: Array<{userId: string, displayName: string, avatarKey: string|null}>,
 *   openSheet: (build: (body: HTMLElement) => void) => void,
 *   closeSheet: () => void,
 *   sheetBody: () => HTMLElement,
 *   toast: (text: string) => void,
 *   work: { ref: string, title: string, cover: string|null },
 *   chapter?: { label: string, number: number|null } | null,
 * }} ctx
 */
export function openShareSheet(ctx) {
  const { work, chapter, friends } = ctx;
  const draft = { message: '' };
  const what = chapter ? `${chapter.label} من ${work.title}` : work.title;

  const pickStep = (body) => {
    const head = el('div', 'share-head');
    head.append(el('h3', null, chapter ? 'رشّح هذا الفصل' : 'شارك العمل'));
    const name = el('p', null, what);
    name.dir = 'auto';
    head.append(name);
    body.append(head);
    const grid = el('div', 'share-grid');
    const target = (person, onPick) => {
      const b = el('button', 'share-person');
      b.type = 'button';
      b.append(face(person, 58), el('span', null, person.displayName));
      b.onclick = onPick;
      return b;
    };
    grid.append(target({ displayName: 'الجميع', everyone: true }, () => composeStep(null)));
    for (const f of friends) grid.append(target(f, () => composeStep(f)));
    body.append(grid);
    if (!friends.length) body.append(el('p', null, 'ما عندك أصدقاء بعد.'));
  };

  const composeStep = (person) => {
    const body = ctx.sheetBody();
    body.innerHTML = '<div class="sheet-handle"></div>';
    const head = el('div', 'share-step-head');
    const back = el('button', 'icon-btn');
    back.type = 'button';
    back.setAttribute('aria-label', 'رجوع');
    back.title = 'رجوع';
    back.innerHTML = glyph('back');
    back.onclick = () => {
      body.innerHTML = '<div class="sheet-handle"></div>';
      pickStep(body);
    };
    const who = el('div', 'share-to');
    who.append(face(person ?? { everyone: true }, 32), el('strong', null, person ? person.displayName : 'الجميع'));
    head.append(back, who);
    body.append(head);

    const card = el('div', 'share-work-card');
    const cover = el('div', 'share-work-cover');
    if (work.cover) {
      const img = el('img');
      img.src = work.cover;
      img.alt = '';
      img.onerror = () => img.remove();
      cover.append(img);
    }
    const copy = el('div');
    const t = el('strong', null, work.title);
    t.dir = 'auto';
    copy.append(t, el('span', null, chapter ? chapter.label : 'يوصل غلاف العمل مع رسالتك'));
    card.append(cover, copy);
    body.append(card);

    const note = el('textarea', 'search-input share-note');
    note.rows = 3;
    note.maxLength = 300;
    note.placeholder = chapter ? 'ليش هالفصل؟ (اختياري)' : 'وش رأيك فيه؟ (اختياري)';
    note.value = draft.message;
    note.oninput = () => (draft.message = note.value);
    body.append(note);

    const hidden = new Set();
    const others = friends.filter((f) => f.userId !== person?.userId);
    if (others.length) {
      body.append(el('div', 'settings-group-label', 'يظهر في المجلس لأصدقائك'));
      for (const f of others) {
        const row = el('label', 'share-hide');
        row.append(face(f, 32), el('span', null, `أخفِه عن ${f.displayName}`));
        const input = el('input');
        input.type = 'checkbox';
        input.className = 'switch-input';
        input.setAttribute('role', 'switch');
        input.onchange = () => (input.checked ? hidden.add(f.userId) : hidden.delete(f.userId));
        row.append(input);
        body.append(row);
      }
    }

    const send = el('button', 'btn btn-primary btn-block share-send');
    send.type = 'button';
    send.innerHTML = `${glyph('send')}<span>أرسل</span>`;
    send.onclick = () => {
      // «الجميع» ترشيح واحد بلا مستلم: الخادم يوصله لكل الأصدقاء إلا المخفيّين
      ctx.sync.enqueue('recommendation.send', {
        toId: person?.userId ?? null,
        seriesRef: work.ref,
        seriesTitle: work.title,
        coverUrl: work.cover ?? null,
        message: draft.message.trim() || null,
        hiddenFrom: [...hidden],
        ...(chapter ? { chapterLabel: chapter.label, chapterNumber: chapter.number } : {}),
      });
      ctx.closeSheet();
      ctx.toast(person ? `انرسل لـ ${person.displayName}` : 'انرسل للجميع');
    };
    body.append(send);
  };

  ctx.openSheet(pickStep);
}
