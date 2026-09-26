/**
 * المجلس — محادثة الأصدقاء.
 *
 * شاشة كاملة فوق التطبيق (لا تبويب)، تُفتح من بابها في الأصدقاء وتُغلق للمكان
 * نفسه. خطٌّ زمني واحد من الأقدم للأحدث: الرسائل (نص، صوت) والترشيحات
 * والفريمات — كلها أنواع منظّمة بمعرّفاتها، لا نص يُحلَّل. الرد يشير لمعرّف.
 *
 * الإرسال متفائل بمعرّف ثابت (opId): تظهر رسالتك فورًا «تُرسل»، والخادم يثبتها
 * بنفس المعرّف فلا تتكرر بعد انقطاع. والحذف ثلاثة لا تختلط: إخفاء لدي، حذف
 * رسالتي للجميع، وحذف المالك لرسالة غيره — والخادم يفحص كل واحد.
 *
 * المزامنة الحالية (النبضة ثم السحب) هي الوقت الحقيقي هنا: لا نظام ثانٍ.
 */

import { glyph } from './icons.js';
import { REACTIONS } from './majlis.js';
import { displayTitle, refForTitle } from './work-ref.js';
import { actionList, clockTime, dayLabel, el, motion, nameNode, onLongPress, parse, people, presenceState, pressable, roomInitial } from './social-kit.js';
import { formatDuration, isPlaying, nextSpeed, seekVoice, setVoiceSpeed, startRecording, toggleVoice } from './voice.js';

const GROUP_GAP_MS = 5 * 60_000;
const MAX_ITEMS = 400;
const isAnime = (ref) => typeof ref === 'string' && ref.startsWith('anime:');

/**
 * الخط الزمني: رسائل وترشيحات وفريمات، بلا ما أخفيته لديك وبلا المحذوف من
 * الترشيحات والفريمات. الرسالة المحذوفة تبقى مكانها بسطر «حُذفت».
 */
export function timeline(sync, me) {
  const hidden = new Set(sync.rows('majlis_hidden', (h) => h.user_id === me).map((h) => h.target));
  const items = [
    ...sync.rows('majlis_messages', (m) => !hidden.has(`msg:${m.id}`)).map((m) => ({ key: `msg:${m.id}`, type: 'msg', at: m.created_at, from: m.sender_id, row: m })),
    ...sync.rows('recommendations', (r) => !r.removed && !hidden.has(`rec:${r.id}`)).map((r) => ({ key: `rec:${r.id}`, type: 'rec', at: r.created_at, from: r.from_id, row: r })),
    ...sync.rows('frames', (f) => !f.removed && !hidden.has(`frame:${f.id}`)).map((f) => ({ key: `frame:${f.id}`, type: 'frame', at: f.created_at, from: f.from_id, row: f })),
  ];
  items.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || String(a.key).localeCompare(String(b.key)));
  const out = items.slice(-MAX_ITEMS);
  // التجميع: نفس المرسل خلال خمس دقائق في نفس اليوم = مجموعة واحدة
  for (let i = 0; i < out.length; i++) {
    const prev = out[i - 1];
    const next = out[i + 1];
    const same = (a, b) => a && b && a.from === b.from && Math.abs((b.at ?? 0) - (a.at ?? 0)) < GROUP_GAP_MS && dayLabel(a.at) === dayLabel(b.at);
    out[i].first = !same(prev, out[i]);
    out[i].last = !same(out[i], next);
  }
  return out;
}

/**
 * @param {{
 *   sync: any, mount: HTMLElement,
 *   avatarNode: Function, mountImage: Function, workFromRef: Function,
 *   preview: (work: object, opts?: object) => void, openFrame: (id: string) => void, openProfile: (id: string) => void,
 *   openSheet: Function, closeSheet: Function, toast: (t: string) => void,
 *   presence: () => Promise<any[]>, mediaUrl: (key: string) => string,
 *   pageImage?: Function | null, markSeen: (kind: string, id: string) => void,
 *   library: () => Array<{ ref: string, title: string, cover: string | null, anime: boolean }>,
 *   encodeAvatar: (file: File) => Promise<Blob>, onClose: () => void,
 * }} ctx
 */
export function createRoom(ctx) {
  const { sync } = ctx;
  const kit = people(sync);
  const me = kit.me;
  let node = null;
  let scroller = null;
  let list = null;
  let replyTo = null;
  let recording = null;
  let failedVoice = null;
  let presence = [];
  const shown = new Set();
  const speeds = new Map();
  let lastRead = 0;

  const meta = () => sync.rows('majlis_meta', (m) => m.id === 'main')[0] ?? null;
  const roomName = () => meta()?.name || 'المجلس';
  const workOf = (ref, title, cover) => {
    const id = ref ?? refForTitle(title) ?? 'ext:عمل';
    const known = sync.rows('works', (w) => w.series_ref === id)[0];
    return ctx.workFromRef(id, known?.title ?? title, known?.cover_url ?? cover);
  };

  // ───────────────────────── الرأس ─────────────────────────

  function roomAvatar(size) {
    const pic = el('span', 'mc-room-pic');
    pic.style.width = pic.style.height = `${size}px`;
    const m = meta();
    if (m?.avatar_key) {
      const img = new Image();
      img.alt = '';
      img.src = ctx.mediaUrl(m.avatar_key);
      pic.append(img);
    } else {
      pic.classList.add('is-initial');
      pic.style.fontSize = `${Math.round(size * 0.42)}px`;
      pic.textContent = roomInitial(roomName());
    }
    return pic;
  }
  function header() {
    const head = el('header', 'mc-head');
    const back = el('button', 'mc-icon');
    back.type = 'button';
    back.setAttribute('aria-label', 'رجوع');
    back.innerHTML = glyph('back', { size: 22 });
    back.onclick = close;
    const id = el('div', 'mc-id');
    const copy = el('span', 'mc-id-text');
    const online = kit.friendIds().filter((u) => ['ONLINE', 'READING', 'IDLE'].includes(presence.find((p) => p.userId === u)?.status)).length;
    copy.append(el('b', null, roomName()), el('small', null, `${kit.memberIds().length} أعضاء${online ? ` · ${online} متصل` : ''}`));
    id.append(roomAvatar(38), copy);
    const members = el('button', 'mc-icon mc-members');
    members.type = 'button';
    members.setAttribute('aria-label', 'أعضاء المجلس');
    members.innerHTML = glyph('members', { size: 24 });
    members.onclick = openMembers;
    head.append(back, id, members);
    if (kit.isOwner(me())) {
      const more = el('button', 'mc-icon');
      more.type = 'button';
      more.setAttribute('aria-label', 'إعدادات المجلس');
      more.innerHTML = glyph('more', { size: 22 });
      more.onclick = openRoomSettings;
      head.append(more);
    }
    return head;
  }

  /** الأعضاء فوق المحادثة: لا تنقّل، والإغلاق يرجعك لنفس مكانك. */
  function openMembers() {
    ctx.openSheet((body) => {
      body.classList.add('mc-sheet');
      body.append(el('h3', null, `في ${roomName()}`));
      const box = el('div', 'mc-mlist');
      const ids = kit.memberIds().sort((a, b) => (a === me() ? -1 : b === me() ? 1 : kit.nameOf(a).localeCompare(kit.nameOf(b), 'ar')));
      for (const id of ids) {
        const p = presence.find((x) => x.userId === id);
        const st = presenceState(p);
        const row = el('button', `mc-mrow mc-mrow--${st.tone}`);
        row.type = 'button';
        const pic = el('span', 'mc-mrow-pic');
        pic.append(ctx.avatarNode(kit.personOf(id), 44));
        if (st.tone !== 'off') pic.append(el('span', 'sx-dot'));
        const text = el('span', 'mc-mrow-text');
        text.append(nameNode(kit, id, { cls: 'mc-mrow-name' }));
        const line =
          id === me()
            ? 'أنت'
            : st.tone === 'live'
              ? p?.seriesTitle && !p.workHidden
                ? `${st.verb} ${p.seriesTitle}`
                : `${st.verb} الآن`
              : st.tone === 'off'
                ? st.verb
                  ? `آخر ظهور ${st.verb}`
                  : 'غير متصل'
                : st.verb;
        const l = el('span', 'mc-mrow-line', line);
        l.dir = 'auto';
        text.append(l);
        if (kit.isOwner(id)) text.append(el('span', 'mc-mrow-role', 'المالك'));
        row.append(pic, text);
        row.onclick = () => {
          ctx.closeSheet();
          close();
          ctx.openProfile(id);
        };
        box.append(row);
      }
      body.append(box);
      motion()?.fromTo(box.children, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out', stagger: 0.04, clearProps: 'all' });
    });
  }

  /** اسم المجلس وصورته: للمالك وحده (والخادم يرفض غيره). */
  function openRoomSettings() {
    ctx.openSheet((body) => {
      body.classList.add('mc-sheet');
      body.append(el('h3', null, 'المجلس'));
      const pic = el('button', 'mc-edit-pic');
      pic.type = 'button';
      pic.append(roomAvatar(72), el('span', null, 'غيّر الصورة'));
      const file = el('input');
      file.type = 'file';
      file.accept = 'image/*';
      file.hidden = true;
      pic.onclick = () => file.click();
      file.onchange = async () => {
        const f = file.files?.[0];
        if (!f) return;
        try {
          ctx.toast('نرفع الصورة…');
          const blob = await ctx.encodeAvatar(f);
          const up = await sync.uploadMedia(blob);
          sync.enqueue('majlis.meta', { avatarKey: up.hash });
          ctx.closeSheet();
          ctx.toast('تغيّرت صورة المجلس');
        } catch {
          ctx.toast('ما قدرنا نرفع الصورة');
        }
      };
      const field = el('label', 'field');
      field.append(el('span', 'field-label', 'الاسم'));
      const input = el('input', 'field-input');
      input.maxLength = 40;
      input.value = meta()?.name ?? '';
      input.placeholder = 'المجلس';
      field.append(input);
      const save = el('button', 'btn btn-primary btn-block', 'احفظ');
      save.type = 'button';
      save.onclick = () => {
        const name = input.value.trim();
        if (name) sync.enqueue('majlis.meta', { name });
        ctx.closeSheet();
      };
      body.append(pic, file, field, save);
    });
  }

  // ───────────────────────── الرسائل ─────────────────────────

  function snippetOf(key) {
    const [type, ...rest] = String(key).split(':');
    const id = rest.join(':');
    if (type === 'msg') {
      const m = sync.rows('majlis_messages', (x) => x.id === id)[0];
      if (!m) return null;
      if (m.deleted) return { from: m.sender_id, text: 'رسالة محذوفة' };
      return { from: m.sender_id, text: m.kind === 'voice' ? 'رسالة صوتية' : String(m.body ?? '').slice(0, 90), icon: m.kind === 'voice' ? 'mic' : null };
    }
    if (type === 'rec') {
      const r = sync.rows('recommendations', (x) => x.id === id)[0];
      return r ? { from: r.from_id, text: r.series_title || 'ترشيح', icon: 'send' } : null;
    }
    if (type === 'frame') {
      const f = sync.rows('frames', (x) => x.id === id)[0];
      return f ? { from: f.from_id, text: `فريم · ${f.series_title || ''}`, icon: 'camera' } : null;
    }
    return null;
  }
  function quote(key) {
    const s = snippetOf(key);
    const q = el('button', 'mc-quote');
    q.type = 'button';
    if (!s) {
      q.append(el('span', 'mc-quote-text', 'رسالة غير متاحة'));
      q.disabled = true;
      return q;
    }
    q.append(nameNode(kit, s.from, { cls: 'mc-quote-name', you: true }));
    const t = el('span', 'mc-quote-text');
    if (s.icon) t.innerHTML = glyph(s.icon, { size: 13 });
    t.append(el('bdi', null, s.text));
    q.append(t);
    q.onclick = (e) => {
      e.stopPropagation();
      jumpTo(key);
    };
    return q;
  }

  function voiceWidget(m, mine) {
    const meta = parse(m.meta_json, {});
    const wave = Array.isArray(meta.waveform) && meta.waveform.length ? meta.waveform : Array(32).fill(0.2);
    const box = el('div', 'mc-voice');
    box.dataset.voice = m.id;
    const play = el('button', 'mc-voice-play');
    play.type = 'button';
    play.setAttribute('aria-label', 'شغّل');
    play.innerHTML = glyph(isPlaying(m.id) ? 'pause' : 'play', { size: 18, filled: true });
    const bars = el('div', 'mc-voice-bars');
    for (const v of wave) {
      const b = el('i');
      b.style.height = `${Math.round(18 + v * 82)}%`;
      bars.append(b);
    }
    const time = el('span', 'mc-voice-time', formatDuration(meta.durationMs ?? 0));
    const speed = el('button', 'mc-voice-speed', `${speeds.get(m.id) ?? 1}x`);
    speed.type = 'button';
    speed.onclick = (e) => {
      e.stopPropagation();
      const s = nextSpeed(speeds.get(m.id) ?? 1);
      speeds.set(m.id, s);
      speed.textContent = `${s}x`;
      setVoiceSpeed(m.id, s);
    };
    // كل الردود من DOM الحي بالمعرّف: إعادة رسم القائمة أثناء التشغيل لا تقطعه
    const live = () => list?.querySelector(`[data-voice="${CSS.escape(m.id)}"]`);
    const paint = (ms, playing) => {
      const w = live();
      if (!w) return;
      const ratio = meta.durationMs ? Math.min(1, ms / meta.durationMs) : 0;
      const all = w.querySelectorAll('.mc-voice-bars i');
      const upto = Math.round(ratio * all.length);
      all.forEach((b, i) => b.classList.toggle('on', i < upto));
      w.querySelector('.mc-voice-time').textContent = formatDuration(playing || ms > 0 ? ms : meta.durationMs ?? 0);
      w.querySelector('.mc-voice-play').innerHTML = glyph(playing ? 'pause' : 'play', { size: 18, filled: true });
    };
    let at = 0;
    play.onclick = (e) => {
      e.stopPropagation();
      if (!m.media_key) return;
      toggleVoice({
        id: m.id,
        src: ctx.mediaUrl(m.media_key),
        speed: speeds.get(m.id) ?? 1,
        onTime: (ms) => {
          at = ms;
          paint(ms, true);
        },
        onEnd: () => {
          at = 0;
          paint(0, false);
        },
        onPause: () => paint(at, false),
        onPlay: () => paint(at, true),
      });
    };
    bars.onclick = (e) => {
      e.stopPropagation();
      const r = bars.getBoundingClientRect();
      // RTL: البداية يمين
      const ratio = Math.min(1, Math.max(0, (r.right - e.clientX) / r.width));
      seekVoice(m.id, ratio);
    };
    box.append(play, bars, time, speed);
    if (mine) box.classList.add('mc-voice--mine');
    return box;
  }

  function recCard(r) {
    const work = workOf(r.series_ref, r.series_title, r.cover_url);
    const card = el('button', 'mc-work');
    card.type = 'button';
    const cover = el('span', 'mc-work-cover');
    void ctx.mountImage(cover, work);
    const text = el('span', 'mc-work-text');
    text.append(el('span', 'mc-work-kicker', isAnime(r.series_ref) ? 'ترشيح أنمي' : 'ترشيح'));
    text.append(el('bdi', 'mc-work-title', displayTitle(work.id, work.title?.english) || r.series_title || 'عمل'));
    if (r.chapter_label) text.append(el('span', 'mc-work-meta', r.chapter_label));
    text.append(el('span', 'mc-work-cta', isAnime(r.series_ref) ? 'افتح الأنمي' : 'افتح العمل'));
    card.append(cover, text);
    card.onclick = () => openWork(work, r.chapter_label ? { chapter: { label: r.chapter_label, number: r.chapter_number ?? null } } : {});
    const wrap = el('div', 'mc-card');
    wrap.append(card);
    if (r.message) {
      const note = el('p', 'mc-text', r.message);
      note.dir = 'auto';
      wrap.append(note);
    }
    return wrap;
  }

  function frameCard(f) {
    const pages = parse(f.pages_json, []);
    const card = el('button', 'mc-frame');
    card.type = 'button';
    const shot = el('span', 'mc-frame-shot');
    const work = workOf(null, f.series_title, f.cover_url);
    void ctx.mountImage(shot, work).then(() => firstPage(shot, f, pages));
    if (pages.length > 1) shot.append(el('span', 'mc-frame-count', `${pages.length} صفحات`));
    const cap = el('span', 'mc-frame-cap');
    cap.append(el('bdi', null, f.series_title || 'عمل'));
    if (f.chapter_label) cap.append(el('span', null, f.chapter_label));
    card.append(shot, cap);
    card.onclick = () => {
      ctx.markSeen('frame', f.id);
      close();
      ctx.openFrame(f.id);
    };
    const wrap = el('div', 'mc-card');
    wrap.append(card);
    if (f.message) {
      const note = el('p', 'mc-text', f.message);
      note.dir = 'auto';
      wrap.append(note);
    }
    return wrap;
  }
  function firstPage(shot, f, pages) {
    if (!ctx.pageImage || !pages.length) return;
    ctx
      .pageImage(f.source_id, pages[0])
      .then((src) => {
        const img = new Image();
        img.alt = '';
        img.onload = () => {
          shot.querySelector(':scope > img')?.remove();
          shot.prepend(img);
        };
        img.src = src;
      })
      .catch(() => {});
  }
  /** الأنمي يفتح صفحته (تحت المحادثة)، فتُغلق المحادثة قبله. */
  function openWork(work, opts) {
    if (isAnime(work.id)) close();
    ctx.preview(work, opts);
  }

  function reactionsOf(kind, id) {
    const rows = sync.rows('majlis_reactions', (r) => r.target_kind === kind && r.target_id === id && r.emoji);
    if (!rows.length) return null;
    const counts = new Map();
    for (const r of rows) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    const box = el('div', 'mc-reacts');
    for (const [emoji, n] of counts) box.append(el('span', null, n > 1 ? `${emoji} ${n}` : emoji));
    return box;
  }

  function itemNode(it) {
    const mine = it.from === me();
    const r = it.row;
    const item = el('div', `mc-item ${mine ? 'mc-item--mine' : 'mc-item--theirs'}${it.first ? ' is-first' : ''}${it.last ? ' is-last' : ''}`);
    item.dataset.key = it.key;
    if (!mine && it.first) item.append(nameNode(kit, it.from, { cls: 'mc-sender' }));
    const line = el('div', 'mc-line');
    if (!mine) {
      const ava = el('span', 'mc-ava');
      if (it.last) ava.append(ctx.avatarNode(kit.personOf(it.from), 28));
      line.append(ava);
    }
    const bubble = el('div', 'mc-bubble');
    if (it.type === 'msg' && r.reply_to && !r.deleted) bubble.append(quote(r.reply_to));
    if (it.type === 'msg') {
      if (r.deleted) {
        bubble.classList.add('mc-bubble--gone');
        const t = el('p', 'mc-text');
        t.innerHTML = glyph('trash', { size: 14 });
        t.append(el('span', null, r.deleted === 2 && r.deleted_by !== r.sender_id ? 'حذفها المالك' : 'حُذفت هذه الرسالة'));
        bubble.append(t);
      } else if (r.kind === 'voice') {
        bubble.classList.add('mc-bubble--voice');
        bubble.append(voiceWidget(r, mine));
      } else {
        const t = el('p', 'mc-text', r.body ?? '');
        t.dir = 'auto';
        bubble.append(t);
      }
    } else {
      bubble.classList.add('mc-bubble--card');
      bubble.append(it.type === 'rec' ? recCard(r) : frameCard(r));
      if (!mine) ctx.markSeen(it.type, r.id);
    }
    if (it.last || r._pending) {
      const meta = el('span', 'mc-meta');
      if (r._pending) meta.innerHTML = glyph('clock', { size: 12 });
      meta.append(el('time', null, clockTime(it.at)));
      bubble.append(meta);
    }
    line.append(bubble);
    item.append(line);
    if (it.type !== 'msg') {
      const chips = reactionsOf(it.type === 'rec' ? 'rec' : 'frame', r.id);
      if (chips) item.append(chips);
    }
    onLongPress(bubble, () => openActions(it));
    return item;
  }

  function openActions(it) {
    const r = it.row;
    const mine = it.from === me();
    const canDelete = (mine || kit.isOwner(me())) && !(it.type === 'msg' && r.deleted);
    const isText = it.type === 'msg' && r.kind === 'text' && !r.deleted;
    ctx.openSheet((body) => {
      body.classList.add('mc-sheet');
      if (it.type !== 'msg') {
        const kind = it.type;
        const current = sync.rows('majlis_reactions', (x) => x.target_kind === kind && x.target_id === r.id && x.user_id === me())[0]?.emoji ?? null;
        const row = el('div', 'mc-react-row');
        for (const emoji of REACTIONS) {
          const b = el('button', `mc-react${emoji === current ? ' is-on' : ''}`, emoji);
          b.type = 'button';
          b.onclick = () => {
            sync.enqueue('majlis.react', { targetKind: kind, targetId: r.id, emoji: emoji === current ? null : emoji });
            ctx.closeSheet();
          };
          row.append(b);
        }
        body.append(row);
      }
      body.append(
        actionList(
          [
            !(it.type === 'msg' && r.deleted) ? { icon: glyph('reply'), label: 'رد', run: () => setReply(it.key) } : null,
            isText
              ? {
                  icon: glyph('copy'),
                  label: 'نسخ',
                  run: () => navigator.clipboard?.writeText(r.body ?? '').then(() => ctx.toast('انسخت'), () => ctx.toast('ما قدرنا ننسخ')),
                }
              : null,
            { icon: glyph('eye'), label: 'إخفاء لدي', run: () => sync.enqueue('majlis.delete', { target: it.key, scope: 'me' }) },
            canDelete
              ? {
                  icon: glyph('trash'),
                  label: mine ? 'حذف للجميع' : 'حذف للجميع (المالك)',
                  danger: true,
                  run: () => sync.enqueue('majlis.delete', { target: it.key, scope: 'everyone' }),
                }
              : null,
          ],
          ctx.closeSheet,
        ),
      );
    });
  }

  function jumpTo(key) {
    const target = list?.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!target) return ctx.toast('الرسالة الأصلية ما عادت موجودة');
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const bubble = target.querySelector('.mc-bubble');
    bubble?.classList.remove('is-flash');
    void bubble?.offsetWidth;
    bubble?.classList.add('is-flash');
  }

  // ───────────────────────── الرسم ─────────────────────────

  function renderList() {
    if (!list) return;
    const fromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const items = timeline(sync, me());
    const nodes = [];
    let day = null;
    for (const it of items) {
      const d = dayLabel(it.at ?? 0);
      if (d !== day) {
        day = d;
        nodes.push(el('div', 'mc-day', d));
      }
      nodes.push(itemNode(it));
    }
    if (!items.length) {
      const empty = el('div', 'mc-empty');
      empty.append(el('b', null, 'أول رسالة لك'), el('span', null, 'قل شي، رشّح عملًا، أو أرسل صوت.'));
      nodes.push(empty);
    }
    list.replaceChildren(...nodes);

    const fresh = items.filter((it) => !shown.has(it.key));
    const firstPaint = shown.size === 0;
    for (const it of items) shown.add(it.key);
    const mineFresh = fresh.some((it) => it.from === me());
    if (firstPaint || fromBottom < 120 || mineFresh) {
      scroller.scrollTop = scroller.scrollHeight;
      jump.hidden = true;
    } else {
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - fromBottom;
      if (fresh.length) jump.hidden = false;
    }
    if (!firstPaint && fresh.length) {
      const g = motion();
      const fresher = fresh.map((it) => list.querySelector(`[data-key="${CSS.escape(it.key)}"]`)).filter(Boolean);
      g?.fromTo(fresher, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.26, ease: 'power2.out', stagger: 0.03, clearProps: 'all' });
    }
    markRead(items);
  }

  /** وصلت لآخر المحادثة = قرأتها. مرة لكل جديد، لا مع كل تمرير. */
  function markRead(items = timeline(sync, me())) {
    if (!scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 120) return;
    const latest = items.filter((it) => it.from !== me()).at(-1)?.at ?? 0;
    const readAt = sync.rows('majlis_reads', (r) => r.user_id === me())[0]?.read_at ?? 0;
    if (latest > readAt && latest > lastRead) {
      lastRead = latest;
      sync.enqueue('majlis.read', { at: latest });
    }
  }

  // ───────────────────────── الكتابة ─────────────────────────

  let field = null;
  let action = null;
  let replyBar = null;
  let bar = null;
  let recBar = null;
  let jump = null;

  function setReply(key) {
    replyTo = key;
    const s = key ? snippetOf(key) : null;
    replyBar.replaceChildren();
    replyBar.hidden = !s;
    if (!s) return;
    const text = el('span', 'mc-replybar-text');
    const who = el('span', 'mc-replybar-who');
    who.append(document.createTextNode('رد على '), nameNode(kit, s.from, { you: true }));
    text.append(who, el('bdi', 'mc-replybar-snip', s.text));
    const x = el('button', 'mc-icon mc-icon--sm');
    x.type = 'button';
    x.setAttribute('aria-label', 'إلغاء الرد');
    x.innerHTML = glyph('close', { size: 18 });
    x.onclick = () => setReply(null);
    replyBar.append(el('span', 'mc-replybar-rule'), text, x);
    motion()?.fromTo(replyBar, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out', clearProps: 'all' });
    field.focus();
  }

  function paintAction() {
    const hasText = field.value.trim().length > 0;
    const want = hasText ? 'send' : 'mic';
    if (action.dataset.mode === want) return;
    action.dataset.mode = want;
    action.setAttribute('aria-label', hasText ? 'أرسل' : 'سجّل رسالة صوتية');
    action.classList.toggle('is-send', hasText);
    const g = motion();
    const swap = () => (action.innerHTML = glyph(want, { size: 22 }));
    if (!g) return swap();
    g.timeline()
      .to(action, { scale: 0.6, opacity: 0, duration: 0.08, ease: 'power1.in', onComplete: swap })
      .to(action, { scale: 1, opacity: 1, duration: 0.18, ease: 'power2.out', clearProps: 'all' });
  }
  function grow() {
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 132)}px`;
  }
  function sendText() {
    const body = field.value.trim();
    if (!body) return;
    sync.enqueue('majlis.send', { kind: 'text', body, ...(replyTo ? { replyTo } : {}) });
    field.value = '';
    grow();
    setReply(null);
    paintAction();
  }

  async function startVoice() {
    if (recording) return;
    const levels = el('div', 'mc-rec-levels');
    const clock = el('time', 'mc-rec-time', '0:00');
    try {
      recording = await startRecording({
        onLevel: (lv) => {
          const b = el('i');
          b.style.height = `${Math.round(12 + lv * 88)}%`;
          levels.append(b);
          if (levels.children.length > 40) levels.firstChild.remove();
          clock.textContent = formatDuration(recording?.elapsed() ?? 0);
        },
        onLimit: () => void finishVoice(),
      });
    } catch (e) {
      recording = null;
      ctx.toast(e?.code === 'denied' ? 'اسمح لـVANTARA بالميكروفون من إعدادات الجوال' : 'التسجيل غير متاح على هالجهاز');
      return;
    }
    navigator.vibrate?.(12);
    const cancel = el('button', 'mc-icon mc-rec-cancel');
    cancel.type = 'button';
    cancel.setAttribute('aria-label', 'احذف التسجيل');
    cancel.innerHTML = glyph('trash', { size: 20 });
    cancel.onclick = () => {
      recording?.cancel();
      recording = null;
      showBar();
    };
    const send = el('button', 'mc-act is-send');
    send.type = 'button';
    send.setAttribute('aria-label', 'أرسل الصوت');
    send.innerHTML = glyph('send', { size: 22 });
    send.onclick = () => void finishVoice();
    const live = el('span', 'mc-rec-live');
    live.append(el('span', 'mc-rec-dot'), clock);
    recBar.replaceChildren(cancel, live, levels, send);
    bar.hidden = true;
    recBar.hidden = false;
    motion()?.fromTo(recBar, { opacity: 0 }, { opacity: 1, duration: 0.18 });
  }
  function showBar() {
    recBar.hidden = true;
    bar.hidden = false;
  }
  async function finishVoice() {
    const rec = recording;
    recording = null;
    showBar();
    if (!rec) return;
    const out = await rec.stop();
    if (!out) return ctx.toast('التسجيل قصير، ما انرسل');
    await sendVoice(out, replyTo);
    setReply(null);
  }
  /** الرفع ثم الرسالة. فشل الرفع لا يضيّع الصوت: يبقى زر «أعد الإرسال». */
  async function sendVoice(out, reply) {
    try {
      const up = await sync.uploadMedia(out.blob);
      sync.enqueue('majlis.send', { kind: 'voice', mediaKey: up.hash, meta: { durationMs: out.durationMs, waveform: out.waveform }, ...(reply ? { replyTo: reply } : {}) });
      failedVoice = null;
    } catch {
      failedVoice = { out, reply };
      ctx.toast('ما انرسل الصوت. اضغط «أعد» تحت');
    }
    paintFailed();
  }
  function paintFailed() {
    node?.querySelector('.mc-failed')?.remove();
    if (!failedVoice) return;
    const f = el('div', 'mc-failed');
    f.append(el('span', null, `رسالة صوتية (${formatDuration(failedVoice.out.durationMs)}) لم تُرسل`));
    const retry = el('button', null, 'أعد');
    retry.type = 'button';
    retry.onclick = () => void sendVoice(failedVoice.out, failedVoice.reply);
    const drop = el('button', null, 'احذف');
    drop.type = 'button';
    drop.onclick = () => {
      failedVoice = null;
      paintFailed();
    };
    f.append(retry, drop);
    node.querySelector('.mc-compose').prepend(f);
  }

  /** «+»: رشّح عملًا من مكتبتك — ترشيح حقيقي بمرجع العمل، لا نص. */
  function openAttach() {
    ctx.openSheet((body) => {
      body.classList.add('mc-sheet');
      body.append(el('h3', null, 'رشّح عملًا للمجلس'));
      const search = el('input', 'field-input mc-search');
      search.placeholder = 'ابحث في مكتبتك';
      const box = el('div', 'mc-pick');
      const note = field.value.trim();
      const paint = () => {
        const q = search.value.trim().toLowerCase();
        const items = ctx.library().filter((w) => !q || String(w.title).toLowerCase().includes(q));
        box.replaceChildren();
        if (!items.length) box.append(el('p', 'mc-pick-empty', 'ما لقينا شي في مكتبتك. افتح أي عمل واختر «رشّح» من صفحته.'));
        for (const w of items.slice(0, 60)) {
          const row = el('button', 'mc-pick-row');
          row.type = 'button';
          const cover = el('span', 'mc-pick-cover');
          void ctx.mountImage(cover, ctx.workFromRef(w.ref, w.title, w.cover));
          const t = el('span', 'mc-pick-text');
          t.append(el('bdi', null, w.title), el('small', null, w.anime ? 'أنمي' : 'مكتبتك'));
          row.append(cover, t);
          row.onclick = () => {
            sync.enqueue('recommendation.send', { seriesRef: w.ref, seriesTitle: w.title, coverUrl: w.cover, ...(note ? { message: note } : {}) });
            if (note) {
              field.value = '';
              grow();
              paintAction();
            }
            ctx.closeSheet();
          };
          box.append(row);
        }
      };
      search.oninput = paint;
      paint();
      if (note) body.append(el('p', 'mc-pick-note', `مع ملاحظتك: «${note.slice(0, 60)}»`));
      body.append(search, box);
    });
  }

  function composer() {
    const foot = el('footer', 'mc-compose');
    replyBar = el('div', 'mc-replybar');
    replyBar.hidden = true;
    bar = el('div', 'mc-bar');
    const plus = el('button', 'mc-icon');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'رشّح عملًا');
    plus.innerHTML = glyph('plus', { size: 22 });
    plus.onclick = openAttach;
    const wrap = el('div', 'mc-field');
    field = el('textarea');
    field.rows = 1;
    field.placeholder = 'رسالة';
    field.dir = 'auto';
    field.setAttribute('aria-label', 'اكتب رسالة');
    field.oninput = () => {
      grow();
      paintAction();
    };
    field.onkeydown = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendText();
      }
    };
    wrap.append(field);
    action = el('button', 'mc-act');
    action.type = 'button';
    action.onclick = () => (field.value.trim() ? sendText() : void startVoice());
    pressable(action, 0.92);
    bar.append(plus, wrap, action);
    recBar = el('div', 'mc-bar mc-bar--rec');
    recBar.hidden = true;
    foot.append(replyBar, bar, recBar);
    requestAnimationFrame(paintAction);
    return foot;
  }

  // ───────────────────────── فتح وإغلاق ─────────────────────────

  /** الكيبورد: الشاشة تتبع الجزء الظاهر فعلًا، فلا يختفي حقل الكتابة تحته. */
  const onViewport = () => {
    if (!node) return;
    const vv = window.visualViewport;
    const atBottom = scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    node.style.height = vv ? `${vv.height}px` : '';
    node.style.top = vv ? `${vv.offsetTop}px` : '';
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
  };

  function open(focus) {
    if (node) {
      if (focus) jumpTo(focus);
      return;
    }
    shown.clear();
    node = el('div', 'mc');
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', roomName());
    scroller = el('div', 'mc-scroll');
    list = el('div', 'mc-list');
    scroller.append(list);
    jump = el('button', 'mc-jump');
    jump.type = 'button';
    jump.hidden = true;
    jump.innerHTML = `${glyph('chevron', { size: 16 })}<span>رسائل جديدة</span>`;
    jump.onclick = () => {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
      jump.hidden = true;
    };
    scroller.addEventListener(
      'scroll',
      () => {
        if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80) {
          jump.hidden = true;
          markRead();
        }
      },
      { passive: true },
    );
    node.append(header(), scroller, jump, composer());
    ctx.mount.append(node);
    window.visualViewport?.addEventListener('resize', onViewport);
    window.visualViewport?.addEventListener('scroll', onViewport);
    onViewport();
    renderList();
    paintFailed();
    // الدخول على المحتوى لا على الحاوية: تحريك حاوية التمرير نفسها يعيدها لأولها في كروم
    const g = motion();
    g?.fromTo(node, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: 'power1.out', clearProps: 'opacity' });
    g?.fromTo([node.querySelector('.mc-head'), node.querySelector('.mc-compose')], { y: 10 }, { y: 0, duration: 0.3, ease: 'power3.out', clearProps: 'transform' });
    // حركة الدخول تعيد التمرير لأوله في كروم: المحادثة تُفتح على آخرها دائمًا
    const toEnd = () => scroller && (scroller.scrollTop = scroller.scrollHeight);
    toEnd();
    requestAnimationFrame(() => (focus ? jumpTo(focus) : toEnd()));
    void ctx
      .presence()
      .then((p) => {
        presence = p ?? [];
        node?.querySelector('.mc-head')?.replaceWith(header());
      })
      .catch(() => {});
  }

  function close() {
    if (!node) return false;
    recording?.cancel();
    recording = null;
    const n = node;
    node = null;
    list = null;
    window.visualViewport?.removeEventListener('resize', onViewport);
    window.visualViewport?.removeEventListener('scroll', onViewport);
    const g = motion();
    const done = () => {
      n.remove();
      ctx.onClose();
    };
    if (g) g.to(n, { opacity: 0, y: 14, duration: 0.2, ease: 'power2.in', onComplete: done });
    else done();
    return true;
  }

  return {
    open,
    close,
    isOpen: () => Boolean(node),
    onChange(tables) {
      if (!node) return;
      const watched = ['majlis_messages', 'majlis_hidden', 'recommendations', 'frames', 'majlis_reactions', 'profiles', 'accounts', 'works'];
      if (tables.some((t) => watched.includes(t))) renderList();
      if (tables.includes('majlis_meta') || tables.includes('accounts')) node.querySelector('.mc-head')?.replaceWith(header());
    },
  };
}
