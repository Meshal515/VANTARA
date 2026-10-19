import { recipientFace } from './recipient.js';

export function momentComposeRange(positionMs, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const position = Math.max(0, Math.min(durationMs, Number(positionMs) || 0));
  return { startMs: Math.max(0, Math.round(position - 35000)), endMs: Math.min(Math.round(durationMs), Math.round(position + 35000)) };
}

/** Only reusable source hints travel to friends; local sessions and request credentials stay here. */
export function publicMomentHints(hints = []) {
  return (Array.isArray(hints) ? hints : []).slice(0, 12).flatMap((hint) => {
    if (!hint || typeof hint !== 'object') return [];
    const result = {};
    for (const field of ['sourceId', 'server', 'title', 'mimeType', 'type']) if (typeof hint[field] === 'string' && hint[field]) result[field] = hint[field].slice(0, 300);
    if (Number.isFinite(hint.quality)) result.quality = hint.quality;
    try {
      const url = new URL(hint.url), host = url.hostname.toLowerCase();
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && host.includes('.') && !host.endsWith('.local') && !host.endsWith('.localhost') && !/^(0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) && !host.includes(':')) result.url = url.href;
    } catch {}
    return Object.keys(result).length ? [result] : [];
  });
}

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const clock = (ms) => { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
function styles() {
  for (const file of ['moment-compose.css', 'recipient.css']) {
    if (document.querySelector(`link[data-moment-compose="${file}"]`)) continue;
    const link = el('link'); link.rel = 'stylesheet'; link.href = new URL(`./${file}`, import.meta.url).href; link.dataset.momentCompose = file; document.head.append(link);
  }
}

/** Shared source-backed editor. Saving/exporting is an explicit local callback, never an upload. */
export function openMomentComposer({ positionMs, durationMs, work = {}, episode = 1, friends = [], sourceHints = [], onSend, onSave, onShare, onPreview, onClose }) {
  const windowRange = momentComposeRange(positionMs, durationMs);
  if (!windowRange || windowRange.endMs <= windowRange.startMs) throw new Error('انتظر حتى تجهز مدة الفيديو');
  styles(); const previousFocus = document.activeElement, abort = new AbortController();
  let startMs = windowRange.startMs, endMs = windowRange.endMs, everyone = true, busy = false, closed = false;
  const selected = new Set(), people = friends.filter((person) => person && (person.userId ?? person.user_id ?? person.id));
  const overlay = el('div', 'moment-compose'); overlay.dir = 'rtl'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'شارك لحظة');
  const panel = el('section', 'mco-panel'), head = el('header', 'mco-head'), heading = el('div');
  heading.append(el('h2', '', 'شارك لحظة'), el('bdi', 'mco-work', typeof work.title === 'string' ? work.title : work.title?.english || 'لقطة'));
  const close = el('button', 'mco-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'إغلاق محرر اللقطة'); close.onclick = destroy;
  head.append(heading, close);
  const poster = el('div', 'mco-poster');
  if (typeof work.cover === 'string' && /^(https?:\/\/|\/)/.test(work.cover)) { const image = el('img'); image.alt = ''; image.src = work.cover; poster.append(image); }
  const preview = el('button', 'mco-preview', '▶  معاينة اللقطة'); preview.type = 'button'; preview.dataset.composeAction = 'preview'; poster.append(preview);
  const range = el('div', 'mco-range'), summary = el('p', 'mco-summary'); summary.setAttribute('aria-live', 'polite');
  const track = el('div', 'mco-track'), fill = el('i'); track.append(fill); track.setAttribute('aria-hidden', 'true');
  const fields = el('div', 'mco-bounds'), inputs = {}, outputs = {};
  for (const [key, label, value] of [['start', 'من', startMs], ['end', 'إلى', endMs]]) {
    const field = el('label', 'mco-bound'), name = el('span', '', label), output = el('output'), input = el('input');
    input.type = 'range'; input.min = String(windowRange.startMs); input.max = String(windowRange.endMs); input.step = '100'; input.value = String(value); input.dataset.bound = key; input.setAttribute('aria-label', key === 'start' ? 'بداية اللقطة' : 'نهاية اللقطة');
    input.oninput = () => {
      if (key === 'start') startMs = Math.max(windowRange.startMs, Math.min(endMs - 100, Number(input.value)));
      else endMs = Math.min(windowRange.endMs, Math.max(startMs + 100, Number(input.value)));
      paintRange();
    };
    inputs[key] = input; outputs[key] = output; field.append(name, output, input); fields.append(field);
  }
  range.append(summary, track, fields, el('p', 'mco-hint', 'اختر البداية والنهاية من 35 ثانية قبل موضعك وبعده.'));
  const recipients = el('fieldset', 'mco-recipients'); recipients.append(el('legend', '', 'أرسل إلى'));
  const recipientButtons = new Map(), recipientList = el('div', 'mco-people');
  for (const person of [{ everyone: true, displayName: 'الكل' }, ...people]) {
    const id = person.everyone ? 'everyone' : String(person.userId ?? person.user_id ?? person.id);
    const button = el('button', 'mco-person'); button.type = 'button'; button.dataset.recipient = id;
    button.append(recipientFace(person, { friends: people, size: 42 }), el('span', '', person.displayName ?? person.display_name ?? person.name ?? 'صديق'));
    button.onclick = () => {
      if (person.everyone) { everyone = true; selected.clear(); }
      else { everyone = false; selected.has(id) ? selected.delete(id) : selected.add(id); }
      paintRecipients();
    };
    recipientButtons.set(id, button); recipientList.append(button);
  }
  recipients.append(recipientList);
  const note = el('textarea', 'mco-note'); note.rows = 2; note.placeholder = 'أضف تعليقًا…'; note.maxLength = 1000; note.setAttribute('aria-label', 'تعليق على اللقطة');
  const status = el('p', 'mco-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const actions = el('div', 'mco-actions'), buttons = {};
  for (const [key, label, callback] of [['send', 'إرسال اللقطة', onSend], ['save', 'حفظ في الصور', onSave], ['share', 'مشاركة خارجية', onShare]]) {
    const button = el('button', `mco-action mco-action--${key}`, label); button.type = 'button'; button.dataset.composeAction = key; button.disabled = !callback; buttons[key] = button; actions.append(button);
    button.onclick = () => void invoke(key, callback);
  }
  preview.disabled = !onPreview; preview.onclick = () => void invoke('preview', onPreview);
  panel.append(head, poster, range, recipients, note, status, actions); overlay.append(panel); (document.fullscreenElement ?? document.body).append(overlay);
  function payload() {
    const hints = publicMomentHints(sourceHints);
    return { startMs, endMs, episode, work, sourceHints: hints, toIds: everyone ? [] : [...selected], broadcast: everyone, recipients: everyone ? people : people.filter((p) => selected.has(String(p.userId ?? p.user_id ?? p.id))), message: note.value?.trim() || '', moment: { version: 1, startMs, endMs, episode, sources: hints } };
  }
  function paintRange() {
    inputs.start.value = String(startMs); inputs.end.value = String(endMs);
    outputs.start.textContent = clock(startMs); outputs.end.textContent = clock(endMs);
    inputs.start.setAttribute('aria-valuetext', clock(startMs)); inputs.end.setAttribute('aria-valuetext', clock(endMs));
    summary.textContent = `${clock(startMs)} – ${clock(endMs)} · ${Math.ceil((endMs - startMs) / 1000)} ثانية`;
    const length = windowRange.endMs - windowRange.startMs;
    fill.style.left = `${(startMs - windowRange.startMs) / length * 100}%`; fill.style.width = `${(endMs - startMs) / length * 100}%`;
  }
  function paintRecipients() {
    for (const [id, button] of recipientButtons) button.setAttribute('aria-pressed', String(id === 'everyone' ? everyone : !everyone && selected.has(id)));
    buttons.send.disabled = busy || !onSend || !everyone && !selected.size;
  }
  async function invoke(action, callback) {
    if (busy || !callback || closed) return;
    busy = true; status.textContent = action === 'save' ? 'نحفظ اللقطة…' : action === 'share' ? 'نجهّز اللقطة للمشاركة…' : action === 'send' ? 'نرسل اللقطة…' : 'نجهّز المعاينة…';
    for (const button of [...Object.values(buttons), preview, ...recipientButtons.values(), ...Object.values(inputs)]) button.disabled = true;
    try {
      const data = payload(); if (action !== 'send') data.signal = abort.signal;
      const result = await callback(data);
      if (closed) return;
      if (result === false || result?.ok === false) throw new Error('failed');
      if (action === 'send') { destroy(); return; }
      status.textContent = action === 'save' ? 'حُفظت اللقطة' : action === 'share' ? 'تمت مشاركة اللقطة' : '';
    } catch (error) {
      if (!closed && error?.name !== 'AbortError') status.textContent = action === 'send' ? 'تعذّر إرسال اللقطة. حاول مرة أخرى.' : action === 'preview' ? 'تعذّرت المعاينة من هذا المصدر. جرّب مصدرًا آخر.' : 'تعذّر تجهيز اللقطة على هذا الجهاز. جرّب مصدرًا يدعم الحفظ أو التطبيق.';
    } finally {
      busy = false;
      if (!closed) {
        for (const input of [...recipientButtons.values(), ...Object.values(inputs)]) input.disabled = false;
        buttons.save.disabled = !onSave; buttons.share.disabled = !onShare; preview.disabled = !onPreview; paintRecipients();
      }
    }
  }
  function keyboard(event) {
    if (event.defaultPrevented || document.querySelector('.mv-viewer')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); destroy(); }
    else if (event.key === 'Tab') {
      const focusables = [...overlay.querySelectorAll('button,input,textarea')].filter((n) => !n.disabled), first = focusables[0], last = focusables.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  function destroy() {
    if (closed) return; closed = true; abort.abort(); document.removeEventListener('keydown', keyboard); overlay.remove(); previousFocus?.focus?.(); onClose?.();
  }
  overlay.onclick = (event) => { if (event.target === overlay) destroy(); }; document.addEventListener('keydown', keyboard); paintRange(); paintRecipients(); close.focus();
  return { destroy, handleBack() { if (closed) return false; destroy(); return true; } };
}
