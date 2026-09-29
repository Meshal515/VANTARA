import { glyph } from './icons.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

export const duration = (ms) => {
  const value = Math.max(0, Number(ms) || 0);
  const mins = Math.floor(value / 60000);
  if (value > 0 && mins === 0) return 'أقل من دقيقة';
  if (mins < 60) return `${mins} د`;
  return `${Math.floor(mins / 60)} س ${String(mins % 60).padStart(2, '0')} د`;
};

/** اللون من بكسلات الغلاف نفسه إن سمحت استجابة الصورة بقراءتها؛ محفوظ لكل غلاف. */
function coverTone(img, key, bar) {
  const cacheKey = `vantara.cover-tone.${key}`;
  try {
    const saved = localStorage.getItem(cacheKey);
    if (saved && /^#[0-9a-f]{6}$/.test(saved)) { bar.style.setProperty('--insight-color', saved); return; }
  } catch { /* storage disabled */ }
  const sample = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 12;
      const c = canvas.getContext('2d', { willReadFrequently: true });
      c.drawImage(img, 0, 0, 12, 12);
      const pixels = c.getImageData(0, 0, 12, 12).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 160) continue;
        const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
        const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
        if (max - min < 20 || max < 35 || min > 215) continue;
        r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++;
      }
      if (!n) return;
      const hex = [r, g, b].map((v) => Math.round(v / n * 0.55 + 28).toString(16).padStart(2, '0')).join('');
      bar.style.setProperty('--insight-color', `#${hex}`);
      try { localStorage.setItem(cacheKey, `#${hex}`); } catch { /* storage disabled */ }
    } catch { /* cross-origin covers retain the calm theme fallback */ }
  };
  if (img.complete && img.naturalWidth) sample();
  else img.addEventListener('load', sample, { once: true });
}

export function createInsights({ sync, host, mountImage, openWork, workFromRef, toast }) {
  let person = null;
  let viewer = null;
  let filter = 'all';
  let requestId = 0;
  let currentResult = null;
  const me = () => sync.user?.userId;

  async function show() {
    if (viewer !== me()) {
      viewer = me();
      person = viewer;
      currentResult = null;
    }
    person ??= me();
    const id = ++requestId;
    host.dataset.kind = filter;
    host.replaceChildren();
    const total = el('div', 'insights-total');
    total.setAttribute('aria-live', 'polite');
    total.setAttribute('aria-label', 'إجمالي وقت المتابعة');
    const people = el('div', 'insights-people');
    people.setAttribute('aria-label', 'صاحب الإحصائيات');
    for (const a of sync.rows('accounts').sort((x, y) => Number(y.user_id === me()) - Number(x.user_id === me()))) {
      const profile = sync.rows('profiles', (p) => p.user_id === a.user_id)[0];
      const chip = el('button', `insights-person${a.user_id === person ? ' active' : ''}`);
      chip.type = 'button';
      chip.disabled = true;
      chip.dataset.userId = a.user_id;
      chip.setAttribute('aria-pressed', String(a.user_id === person));
      if (profile?.avatar_key) {
        const img = el('img'); img.src = profile.avatar_key; img.alt = ''; chip.append(img);
      } else chip.append(el('span', 'insights-avatar', (profile?.display_name || a.username || '?').slice(0, 1).toUpperCase()));
      chip.append(el('span', null, `${profile?.display_name || a.username}${a.user_id === me() ? ' (YOU)' : ''}`));
      chip.onclick = async () => {
        if (a.user_id === person) return;
        const selection = ++requestId;
        // لا نمسح إحصائية ظاهرة إلا بعدما نتحقق أن الشخص فتح مشاركتها.
        const result = await sync.insights(a.user_id);
        if (selection !== requestId || !host.isConnected || viewer !== me()) return;
        if (!result) { toast('تعذر تحميل الإحصائيات', 3000); return; }
        if (result.locked || !result.timeShared) { toast('مقفلها', 3000); return; }
        person = a.user_id;
        currentResult = result;
        render(result);
      };
      people.append(chip);
    }
    const filters = el('div', 'insights-filters');
    for (const [kind, label] of [['all', 'ALL'], ['manga', 'MANGA'], ['anime', 'ANIME'], ['cinema', 'CINMA']]) {
      const button = el('button', kind === filter ? 'active' : '', label);
      button.type = 'button';
      button.disabled = kind === 'cinema';
      button.setAttribute('aria-pressed', String(kind === filter));
      if (kind === 'cinema') button.innerHTML += glyph('lock', { size: 14 });
      button.onclick = () => {
        filter = kind;
        host.dataset.kind = kind;
        for (const other of filters.children) {
          other.classList.toggle('active', other === button);
          other.setAttribute('aria-pressed', String(other === button));
        }
        if (currentResult?.userId === person) render(currentResult);
      };
      filters.append(button);
    }
    const ranking = el('div', 'insights-ranking');
    host.append(total, people, filters, ranking);
    host.setAttribute('aria-busy', 'true');
    if (!currentResult) {
      total.classList.add('insights-loading');
      for (let i = 0; i < 4; i++) ranking.append(el('div', 'insights-placeholder'));
    }
    if (person === me() && currentResult?.userId === me()) render(currentResult);
    const result = await sync.insights(person);
    if (id !== requestId || !host.isConnected || viewer !== me()) return;
    host.setAttribute('aria-busy', 'false');
    for (const chip of people.children) chip.disabled = false;
    total.classList.remove('insights-loading');
    if (!result) {
      currentResult = null;
      total.textContent = '';
      ranking.replaceChildren();
      const retry = el('button', 'insights-retry');
      retry.type = 'button';
      retry.innerHTML = glyph('refresh', { size: 22 });
      retry.append(el('span', null, 'تعذر تحميل الإحصائيات'));
      retry.setAttribute('aria-label', 'تعذر تحميل الإحصائيات، أعد المحاولة');
      retry.onclick = () => void show();
      ranking.append(retry);
      return;
    }
    if (result.locked || !result.timeShared) {
      if (person !== me()) { person = me(); toast('مقفلها', 3000); void show(); }
      return;
    }
    currentResult = result;
    render(result);
  }

  function render(result) {
    const total = host.querySelector('.insights-total');
    const ranking = host.querySelector('.insights-ranking');
    if (!total || !ranking) return;
    total.classList.remove('insights-loading');
    host.setAttribute('aria-busy', 'false');
    host.dataset.kind = filter;
    for (const chip of host.querySelectorAll('.insights-person')) {
      const selected = chip.dataset.userId === person;
      chip.classList.toggle('active', selected);
      chip.setAttribute('aria-pressed', String(selected));
    }
    const content = (result.content ?? []).filter((r) => (r.section === filter || filter === 'all') && r.activeMs > 0)
      .sort((a, b) => b.activeMs - a.activeMs);
    const sum = content.reduce((sum, r) => sum + r.activeMs, 0);
    total.textContent = duration(sum);
    total.classList.toggle('insights-total--short', sum > 0 && sum < 60000);
    ranking.replaceChildren();
    if (!content.length) {
      const empty = el('div', 'insights-empty');
      empty.innerHTML = glyph('clock', { size: 28 });
      empty.append(el('span', null, 'لا وقت مسجّل بعد'));
      ranking.append(empty);
    }
    const max = Math.max(1, ...content.map((r) => r.activeMs));
    for (const item of content) {
      if (!item.activeMs) continue;
      const row = el('button', 'insights-rank');
      row.type = 'button';
      const fill = el('span', 'insights-bar');
      fill.style.width = `${item.activeMs / max * 100}%`;
      const track = el('span', 'insights-track');
      const cover = el('span', 'insights-cover');
      const work = workFromRef(item.seriesRef, item.title, item.coverUrl);
      void Promise.resolve(mountImage(cover, work)).then(() => {
        const img = cover.querySelector('img');
        if (img) coverTone(img, item.coverUrl || item.seriesRef, fill);
      }).catch(() => { /* retain the cover placeholder */ });
      fill.append(cover);
      track.append(fill);
      const text = el('span', 'insights-rank-copy');
      text.append(el('strong', null, item.title || work.title?.english || '—'), el('small', null, duration(item.activeMs)));
      row.append(track, text);
      row.setAttribute('aria-label', `${item.title || 'العمل'} · ${duration(item.activeMs)}`);
      row.onclick = () => void openWork(work);
      ranking.append(row);
    }
  }
  return { show };
}
