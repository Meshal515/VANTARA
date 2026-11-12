/**
 * تعليم الحلقات كمشاهَدة — منطق واحد للأنمي والسينما، بلا شكل بيانات جديد.
 *
 * - سجل الجهاز: نفس سجل التقدم الحالي (`episodes[key] = { position, duration, done, at }`).
 *   التعليم يضع `done` ولا يمسّ موضع التوقف ولا المدة؛ الإلغاء يرجع `done:false` ويُبقي التقدم،
 *   ولا يحذف إلا سجلًا لم يكن فيه غير العلامة.
 * - الحساب: نفس جدول `chapter_marks` (`chapter.mark` / `chapter.markMany`) بمفتاح
 *   `anime:<id>#ep:<n>` للأنمي و`cinema:<IMDb>#ep:<s>:<n>` للسينما، فيصل لكل الأجهزة.
 */

export const cinemaEpisodeKey = (id, season, n) => `cinema:${id}#ep:${season}:${n}`;
export const cinemaLocalKey = (season, n) => `${season ?? 0}:${n}`;

/** أوضاع التحديد في ورقة «علّم حلقات». */
export const MARK_MODES = Object.freeze([
  { id: 'one', label: 'حلقة' },
  { id: 'range', label: 'من ← إلى' },
  { id: 'upto', label: 'كل ما قبلها' },
  { id: 'season', label: 'الموسم كله' },
]);

const whole = (v, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
};

/**
 * أرقام الحلقات التي يشملها التحديد، مقصوصة على 1..total ومرتبة بلا تكرار.
 * one: الحلقة a — range: من a إلى b (بأي ترتيب) — upto: 1..a — season: 1..total.
 * @param {'one'|'range'|'upto'|'season'} mode
 * @param {{ a?: number, b?: number, total: number }} o
 * @returns {number[]}
 */
export function selectEpisodes(mode, { a = 1, b = a, total } = {}) {
  const max = Math.max(0, whole(total, 0));
  if (!max) return [];
  const clamp = (v) => Math.max(1, Math.min(max, whole(v, 1)));
  let lo;
  let hi;
  if (mode === 'one') lo = hi = clamp(a);
  else if (mode === 'range') {
    lo = Math.min(clamp(a), clamp(b));
    hi = Math.max(clamp(a), clamp(b));
  } else if (mode === 'upto') {
    lo = 1;
    hi = clamp(a);
  } else if (mode === 'season') {
    lo = 1;
    hi = max;
  } else return [];
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/**
 * يطبّق «شوهدت»/«لم تُشاهد» على سجل الجهاز لعمل واحد بلا أن يُفقد تقدّم موجود.
 * @param {Record<string, any>} episodes سجل الحلقات (يُعدَّل في مكانه)
 * @param {string[]} keys مفاتيح السجل (رقم الحلقة للأنمي، `s:n` للسينما)
 * @param {boolean} on
 * @param {number} [at]
 * @returns {number} كم سجلًا تغيّر فعلًا
 */
export function applyLocalMarks(episodes, keys, on, at = Date.now()) {
  let changed = 0;
  for (const k of keys) {
    const prev = episodes[k];
    const was = Boolean(prev?.done);
    if (was === on) continue;
    changed++;
    if (on) episodes[k] = { position: 0, duration: 0, ...(prev ?? {}), done: true, at: prev?.at ?? at };
    else if ((prev?.position ?? 0) > 0 || (prev?.duration ?? 0) > 0) episodes[k] = { ...prev, done: false };
    else delete episodes[k];
  }
  return changed;
}

/**
 * ما يتغيّر فعلًا (لعملية حساب واحدة): المفاتيح التي حالتها الحالية تخالف المطلوب.
 * @param {string[]} keys
 * @param {(key: string) => boolean} isSeen
 * @param {boolean} on
 */
export const changedKeys = (keys, isSeen, on) => keys.filter((k) => Boolean(isSeen(k)) !== on);

/**
 * عمليات المزامنة لتعليم مجموعة حلقات: `chapter.markMany` على دفعات (نفس حد الأنمي 2000).
 * @returns {{ op: string, payload: object }[]}
 */
export function syncOps(seriesRef, keys, on) {
  const ops = [];
  for (let i = 0; i < keys.length; i += 2000) ops.push({ op: 'chapter.markMany', payload: { seriesRef, keys: keys.slice(i, i + 2000), read: on } });
  return ops;
}

/**
 * «شوهدت» للسينما: علامة الحساب إن وُجدت لها صف (تشمل الإلغاء الصريح)، وإلا سجل الجهاز
 * (ما اكتمل تشغيله قبل هذه الميزة يبقى مشاهَدًا).
 * @param {{ read: number|boolean } | null | undefined} accountRow
 * @param {{ done?: boolean } | null | undefined} localRecord
 */
export const seenFrom = (accountRow, localRecord) => (accountRow ? Boolean(accountRow.read) : Boolean(localRecord?.done));

/**
 * ورقة «علّم حلقات» المشتركة: أوضاع التحديد (حلقة، نطاق، كل ما قبلها، الموسم كله) ثم
 * «علّمها شوهدت» أو «ألغِ تعليمها». المنطق في الدوال أعلاه؛ هذه الواجهة فقط.
 * @param {HTMLElement} body
 * @param {{ title: string, kicker?: string, total: number, start?: number, count: () => number,
 *   seasons?: { n: number, label: string, total: number }[] | null, season?: number,
 *   onSeason?: (n: number) => void, apply: (nums: number[], on: boolean) => number, el: Function, button: Function }} o
 */
export function buildMarkSheet(body, o) {
  const { el, button } = o;
  let mode = 'range';
  const head = el('div', 'an-sheet-head');
  const kicker = el('div', 'an-sheet-kicker');
  const title = el('div', 'an-sheet-title', o.title);
  title.dir = 'auto';
  head.append(kicker, title);
  const total = () => o.total;
  const paintCount = () => (kicker.textContent = `${o.kicker ? `${o.kicker} · ` : ''}شاهدت ${o.count()} من ${total()}`);
  paintCount();

  const modes = el('div', 'em-modes');
  modes.setAttribute('role', 'tablist');
  const field = (label) => {
    const f = el('label', 'field');
    f.append(el('span', 'field-label', label));
    const input = el('input', 'field-input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = '1';
    f.append(input);
    return { f, input };
  };
  const a = field('من الحلقة');
  const b = field('إلى الحلقة');
  const pair = el('div', 'an-mark-range em-fields');
  pair.append(a.f, b.f);
  const preview = el('p', 'em-preview');
  const nums = () => selectEpisodes(mode, { a: a.input.value, b: b.input.value, total: total() });
  const paintMode = () => {
    for (const t of modes.children) t.setAttribute('aria-selected', String(t.dataset.mode === mode));
    a.input.max = b.input.max = String(total());
    a.f.querySelector('.field-label').textContent = mode === 'one' ? 'الحلقة' : mode === 'upto' ? 'حتى الحلقة (شاملة)' : 'من الحلقة';
    b.f.hidden = mode !== 'range';
    a.f.hidden = mode === 'season';
    pair.classList.toggle('single', mode !== 'range');
    const list = nums();
    preview.textContent = !list.length ? 'لا حلقات' : list.length === 1 ? `الحلقة ${list[0]}` : `${list.length} حلقة (${list[0]}–${list[list.length - 1]})`;
  };
  for (const m of MARK_MODES) {
    const t = button('em-mode', m.label, () => {
      mode = m.id;
      paintMode();
    });
    t.dataset.mode = m.id;
    t.setAttribute('role', 'tab');
    modes.append(t);
  }
  a.input.oninput = b.input.oninput = paintMode;
  const start = Math.max(1, Math.min(total() || 1, o.start ?? 1));
  a.input.value = String(start);
  b.input.value = String(total() || 1);

  const result = el('p', 'em-result');
  result.setAttribute('role', 'status');
  const run = (on) => {
    const list = nums();
    const n = list.length ? o.apply(list, on) : 0;
    paintCount();
    result.textContent = n ? `${on ? 'عُلّمت' : 'أُلغي تعليم'} ${n} حلقة` : 'ما تغيّر شيء';
  };
  const act = el('div', 'an-mark-actions');
  act.append(button('btn btn-primary', 'علّمها شوهدت', () => run(true)), button('btn', 'ألغِ تعليمها', () => run(false)));

  const parts = [head];
  if (o.seasons?.length > 1) {
    const ss = el('div', 'em-seasons');
    for (const s of o.seasons) {
      const chip = button('em-season', s.label, () => {
        o.onSeason?.(s.n);
        o.total = s.total;
        for (const c of ss.children) c.setAttribute('aria-pressed', String(c === chip));
        a.input.value = '1';
        b.input.value = String(s.total);
        paintCount();
        paintMode();
      });
      chip.setAttribute('aria-pressed', String(s.n === o.season));
      ss.append(chip);
    }
    parts.push(ss);
  }
  parts.push(modes, pair, preview, act, result);
  body.append(...parts);
  paintMode();
  return { setMode: (m) => { mode = m; paintMode(); }, run };
}
