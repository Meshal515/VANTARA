/**
 * «رفيق» — واجهة المحادثة.
 *
 * شاشة نظيفة: رسائل، وبطاقات أعمال حقيقية تحت رد رفيق (كل زر فيها مربوط بمعرّف
 * العمل لا بعنوان يكتبه النموذج)، واقتراحات سريعة، وخانة كتابة. الرد يصل حرفًا
 * حرفًا (SSE)، والبطاقات بعد أن يتحقق منها الخادم.
 *
 * إعادة المحاولة ترسل نفس معرّف الرسالة: الخادم لا يكررها ولا يعيد النداء إن كان
 * الرد محفوظًا. إشارات الأنمي (سجل المشاهدة محلي على الجهاز) تُرسل مع الرسالة
 * ليعرف رفيق ما شاهدت.
 */

import { glyph } from './icons.js';

const STATUS_AR = { FINISHED: 'مكتمل', RELEASING: 'مستمر', NOT_YET_RELEASED: 'لم يبدأ', CANCELLED: 'ملغي', HIATUS: 'متوقف' };
const ERRORS = {
  rafiq_locked: 'سينباي لسا تحت التجربة ومفتوح لحساب واحد بس 🔒',
  rafiq_not_configured: 'سينباي مو مربوط بمفتاحه في الخادم للحين.',
  budget: 'خلص سقف سينباي لهالشهر 💸 يرجع أول الشهر الجاي.',
  upstream: 'DeepSeek ما رد علينا 😵 جرّب مرة ثانية.',
  bad_output: 'الرد جاء خربان، جرّب مرة ثانية.',
  offline: 'ما فيه نت؟ تأكد من الاتصال وجرّب.',
};

const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

/** سجل المشاهدة المحلي → إشارات مختصرة للخادم (حلقات شوهدت، هل اكتمل، آخر مرة). */
export function localSignals(watch) {
  return Object.values(watch ?? {})
    .filter((w) => Number.isInteger(Number(w?.id)))
    .map((w) => {
      const eps = Object.entries(w.episodes ?? {});
      const watched = eps.filter(([, e]) => e?.done).length || (eps.length ? Math.max(...eps.map(([n]) => Number(n) || 0)) - 1 : 0);
      const total = Number.isFinite(Number(w.total)) && w.total ? Number(w.total) : null;
      return { id: Number(w.id), title: typeof w.title === 'string' ? w.title : undefined, watched: Math.max(0, watched), total, done: Boolean(total && watched >= total), at: Number(w.at) || undefined };
    })
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, 150);
}

/** يقرأ دفق SSE: يستدعي `on(event, data)` لكل حدث مكتمل. */
export async function readEvents(response, on) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = (block) => {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    try {
      on(event, JSON.parse(data));
    } catch {
      // حدث تالف: يُتجاهل
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      flush(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
    }
  }
  if (buffer.trim()) flush(buffer);
}

/**
 * @param {{ sync: any, host: HTMLElement, el: Function, toast: (m: string) => void,
 *           openSheet: Function, closeSheet: Function, genreAr: (g: string) => string,
 *           openAnime: (card: object) => void, openManga: (card: object) => Promise<string|null>,
 *           readWatch: () => object }} deps
 */
export function createRafiq(deps) {
  const { sync, host, el, toast } = deps;
  const state = {
    loaded: false,
    enabled: null,
    configured: true,
    conversationId: null,
    messages: [],
    suggestions: [],
    busy: false,
    pending: null, // { clientId, text } آخر رسالة لم يصل ردها
  };
  let list;
  let chips;
  let input;
  let sendBtn;

  // ── الإتاحة ──
  async function check() {
    const res = await sync.translation('/v1/rafiq/state').catch(() => null);
    if (res?.status !== 200) return state.enabled;
    state.enabled = Boolean(res.body?.enabled);
    if (state.enabled) {
      state.configured = res.body.configured !== false;
      state.conversationId = res.body.conversationId ?? null;
      state.messages = Array.isArray(res.body.messages) ? res.body.messages : [];
      state.suggestions = Array.isArray(res.body.suggestions) ? res.body.suggestions : [];
      state.loaded = true;
    }
    return state.enabled;
  }

  // ── الهيكل ──
  function build() {
    host.replaceChildren();
    host.classList.add('rf');
    list = el('div', 'rf-list');
    list.setAttribute('role', 'log');
    list.setAttribute('aria-live', 'polite');
    chips = el('div', 'rf-chips');
    const composer = el('form', 'rf-composer');
    input = el('textarea', 'rf-input');
    input.rows = 1;
    input.maxLength = 800;
    input.placeholder = 'قول لسينباي وش مزاجك اليوم…';
    input.setAttribute('aria-label', 'رسالتك لسينباي');
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
      sendBtn.disabled = state.busy || !input.value.trim();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        composer.requestSubmit();
      }
    });
    sendBtn = el('button', 'rf-send');
    sendBtn.type = 'submit';
    sendBtn.innerHTML = glyph('send');
    sendBtn.setAttribute('aria-label', 'أرسل');
    sendBtn.disabled = true;
    composer.append(input, sendBtn);
    composer.onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || state.busy) return;
      input.value = '';
      input.style.height = 'auto';
      sendBtn.disabled = true;
      void send({ text });
    };
    const dock = el('div', 'rf-dock');
    dock.append(chips, composer);
    host.append(list, dock);
  }

  function renderAll() {
    if (!list) build();
    list.replaceChildren();
    if (!state.messages.length) list.append(welcome());
    for (const m of state.messages) list.append(messageNode(m));
    renderChips(lastChips());
    scrollDown(false);
  }

  function welcome() {
    const box = el('div', 'rf-welcome');
    box.insertAdjacentHTML('beforeend', `<div class="rf-mark">${glyph('spark')}</div>`);
    box.append(el('h2', null, 'هلا! أنا سينباي 👋'));
    box.append(el('p', null, 'أعرف وش قريت ووش شاهدت، وأطلع لك الشي اللي فعلًا يناسبك — مو أي شي مشهور وخلاص. قول لي مزاجك 🔥'));
    if (!state.configured) box.append(el('p', 'rf-warn', ERRORS.rafiq_not_configured));
    return box;
  }

  const lastChips = () => {
    const last = [...state.messages].reverse().find((m) => m.role === 'assistant');
    return last?.chips?.length ? last.chips : state.suggestions;
  };

  function renderChips(items) {
    chips.replaceChildren();
    for (const text of (items ?? []).slice(0, 5)) {
      const b = el('button', 'rf-chip', text);
      b.type = 'button';
      b.onclick = () => !state.busy && void send({ text });
      chips.append(b);
    }
    chips.hidden = !chips.childElementCount;
  }

  function scrollDown(smooth = true) {
    requestAnimationFrame(() => list.lastElementChild?.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'instant' }));
  }

  // ── الرسائل ──
  function messageNode(m) {
    const row = el('div', `rf-msg rf-msg--${m.role}`);
    const bubble = el('div', 'rf-bubble', m.content ?? '');
    row.append(bubble);
    if (m.cards?.length) {
      const cards = el('div', 'rf-cards');
      for (const c of m.cards) cards.append(cardNode(c));
      row.append(cards);
    }
    return row;
  }

  function cardNode(card) {
    const box = el('article', `rf-card${card.exploration ? ' rf-card--explore' : ''}`);
    if (card.color) box.style.setProperty('--rf-tint', card.color);
    const media = el('div', 'rf-cover');
    if (card.cover) {
      const img = el('img');
      img.src = card.cover;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onerror = () => img.remove();
      media.append(img);
    }
    const kindTag = el('span', 'rf-kind', card.kind === 'anime' ? 'أنمي' : 'مانجا');
    media.append(kindTag);
    const info = el('div', 'rf-info');
    if (card.exploration) info.append(el('span', 'rf-explore', 'تجربة جديدة ✨'));
    info.append(el('h3', null, card.title));
    const facts = [];
    if (card.count) facts.push(card.kind === 'anime' ? `${card.count} حلقة` : `${card.count} فصل`);
    if (card.status && STATUS_AR[card.status]) facts.push(STATUS_AR[card.status]);
    if (card.score) facts.push(`★ ${(card.score / 10).toFixed(1)}`);
    if (facts.length) info.append(el('div', 'rf-facts', facts.join(' · ')));
    if (card.genres?.length) info.append(el('div', 'rf-genres', card.genres.slice(0, 3).map(deps.genreAr).join('، ')));
    if (card.progress) info.append(el('div', 'rf-progress', card.progress));
    if (card.reason) info.append(el('p', 'rf-reason', card.reason));

    const actions = el('div', 'rf-actions');
    const primaryLabel = card.ref && card.progress ? 'أكمل من حيث وقفت' : card.kind === 'anime' ? 'شاهد الآن' : 'ابدأ القراءة';
    const primary = button(primaryLabel, 'rf-btn rf-btn--primary', card.kind === 'anime' ? 'play' : 'book');
    primary.onclick = () => void open(card, primary);
    const more = button('تفاصيل', 'rf-btn', 'info');
    more.onclick = () => details(card);
    const similar = button('شي مشابه', 'rf-btn', 'spark');
    similar.onclick = () => !state.busy && void send({ action: { type: 'similar', workId: card.workId, title: card.titles?.[0] ?? card.title }, shown: `عطني شي يشبه ${card.title}` });
    // «مو مهتم» في زاوية البطاقة: لمسة واحدة، ولا يزاحم أفعالها
    const nope = el('button', 'rf-nope');
    nope.type = 'button';
    nope.innerHTML = glyph('close');
    nope.setAttribute('aria-label', 'مو مهتم');
    nope.title = 'مو مهتم';
    nope.onclick = () => {
      void feedback(card, 'not_for_me');
      box.classList.add('rf-card--dismissed');
      nope.disabled = true;
      toast('تمام، ما راح أرجعه لك 🫡');
    };
    actions.append(primary, more, similar);
    box.append(nope, media, info, actions);
    return box;
  }

  function button(label, cls, icon) {
    const b = el('button', cls);
    b.type = 'button';
    if (icon) b.innerHTML = glyph(icon);
    b.append(el('span', null, label));
    return b;
  }

  async function open(card, btn) {
    if (card.kind === 'anime') {
      void feedback(card, 'opened', card.workId);
      deps.openAnime(card);
      return;
    }
    btn.disabled = true;
    btn.classList.add('is-busy');
    try {
      const ref = await deps.openManga(card);
      void feedback(card, 'opened', ref);
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-busy');
    }
  }

  function details(card) {
    deps.openSheet((body) => {
      body.classList.add('rf-sheet');
      if (card.banner || card.cover) {
        const img = el('img', 'rf-sheet-art');
        img.src = card.banner ?? card.cover;
        img.alt = '';
        body.append(img);
      }
      body.append(el('h3', null, card.title));
      if (card.titles?.length > 1) body.append(el('p', 'rf-alt', card.titles.filter((t) => t !== card.title).slice(0, 2).join(' · ')));
      const facts = [card.kind === 'anime' ? 'أنمي' : 'مانجا'];
      if (card.count) facts.push(card.kind === 'anime' ? `${card.count} حلقة` : `${card.count} فصل`);
      if (card.status && STATUS_AR[card.status]) facts.push(STATUS_AR[card.status]);
      if (card.score) facts.push(`تقييم ${(card.score / 10).toFixed(1)}`);
      body.append(el('p', 'rf-facts', facts.join(' · ')));
      if (card.genres?.length) body.append(el('p', 'rf-genres', card.genres.map(deps.genreAr).join('، ')));
      // النبذة: أول فقرة من AniList بلا حرق (الخادم يقصّها ويشيل ما عليه علامة حرق)
      if (card.synopsis) {
        const p = el('p', 'rf-synopsis', card.synopsis);
        p.dir = 'auto';
        body.append(p);
      }
      if (card.reason) body.append(el('p', 'rf-reason', `ليش لك: ${card.reason}`));
      const go = button(card.kind === 'anime' ? 'شاهد الآن' : 'ابدأ القراءة', 'btn btn-primary', card.kind === 'anime' ? 'play' : 'book');
      go.onclick = () => {
        deps.closeSheet();
        void open(card, go);
      };
      body.append(go);
    });
  }

  async function feedback(card, kind, openedRef = null) {
    if (!card.recId) return;
    await sync.translation('/v1/rafiq/feedback', { method: 'POST', body: { recId: card.recId, kind, ...(openedRef ? { openedRef } : {}) } }).catch(() => {});
  }

  // ── الإرسال ──
  async function send({ text = '', action = null, shown = null, clientId = uid(), retry = false }) {
    if (state.busy) return;
    state.busy = true;
    sendBtn.disabled = true;
    renderChips([]);
    list.querySelector('.rf-welcome')?.remove();
    list.querySelector('.rf-failed')?.remove();
    state.pending = { text, action, shown, clientId };
    if (!retry) {
      const mine = { id: clientId, role: 'user', content: shown ?? text };
      state.messages.push(mine);
      list.append(messageNode(mine));
    }
    const row = el('div', 'rf-msg rf-msg--assistant');
    const bubble = el('div', 'rf-bubble rf-bubble--typing');
    bubble.innerHTML = '<span class="rf-dots"><i></i><i></i><i></i></span>';
    row.append(bubble);
    list.append(row);
    scrollDown();

    let written = '';
    let final = null;
    let failure = null;
    const res = await sync.stream('/v1/rafiq/message', {
      conversationId: state.conversationId,
      clientId,
      text: text || undefined,
      action: action ?? undefined,
      local: { anime: localSignals(deps.readWatch?.()) },
    });
    if (res.status !== 200) failure = res.error;
    else {
      try {
        await readEvents(res.response, (event, data) => {
          if (event === 'meta' && data.conversationId) state.conversationId = data.conversationId;
          else if (event === 'delta') {
            if (!written) bubble.classList.remove('rf-bubble--typing');
            written = typeof data.replace === 'string' ? data.replace : written + (data.text ?? '');
            bubble.textContent = written;
            scrollDown(false);
          } else if (event === 'final') final = data.message;
          else if (event === 'error') failure = data.code ?? 'upstream';
        });
      } catch {
        failure = failure ?? 'offline';
      }
    }
    state.busy = false;
    sendBtn.disabled = !input.value.trim();
    if (final) {
      state.pending = null;
      state.messages.push(final);
      row.replaceWith(messageNode(final));
      renderChips(lastChips());
      scrollDown();
      return;
    }
    // فشل: لا رسالة نصف مكتوبة، وزر إعادة يرسل نفس المعرّف (لا تكرار في الخادم)
    row.remove();
    const fail = el('div', 'rf-failed');
    fail.append(el('span', null, ERRORS[failure] ?? 'صار خلل بسيط، جرّب مرة ثانية.'));
    if (failure !== 'rafiq_locked' && failure !== 'budget') {
      const again = button('أعد المحاولة', 'rf-btn', 'refresh');
      again.onclick = () => {
        const p = state.pending;
        if (p) void send({ ...p, retry: true });
      };
      fail.append(again);
    }
    list.append(fail);
    renderChips(lastChips());
    scrollDown();
  }

  // ── الذاكرة ──
  const KIND_AR = { genre: 'نوع', tag: 'ثيمة', length: 'الطول', format: 'الشكل', pacing: 'الإيقاع', other: 'ملاحظة' };
  const SOURCE_AR = { explicit: 'قلته أنت', behavioral: 'من ردودك', inferred: 'استنتاج' };
  async function memory() {
    deps.openSheet((body) => {
      body.classList.add('rf-sheet');
      body.append(el('h3', null, 'ذاكرة سينباي 🧠'));
      body.append(el('p', 'rf-alt', 'اللي يعرفه عن ذوقك. أي شي غلط احذفه.'));
      const box = el('div', 'rf-memory');
      box.append(el('p', 'rf-alt', 'لحظة…'));
      body.append(box);
      void sync.translation('/v1/rafiq/prefs').then((res) => {
        box.replaceChildren();
        if (res.status !== 200) {
          box.append(el('p', 'rf-alt', ERRORS[res.body?.error] ?? 'ما قدرنا نجيب الذاكرة الحين.'));
          return;
        }
        const p = res.body?.profile;
        if (p) {
          const lines = [];
          if (p.favoriteGenres?.length) lines.push(['تحب', p.favoriteGenres.slice(0, 5).map((g) => deps.genreAr(g.key)).join('، ')]);
          if (p.dislikedGenres?.length) lines.push(['تتجنب', p.dislikedGenres.slice(0, 4).map((g) => deps.genreAr(g.key)).join('، ')]);
          if (p.strongPositiveWorks?.length) lines.push(['أعمال علّمت فيك', p.strongPositiveWorks.slice(0, 5).join('، ')]);
          if (p.abandonedWorks?.length) lines.push(['تركتها بدري', p.abandonedWorks.slice(0, 4).join('، ')]);
          for (const [k, v] of lines) {
            const r = el('div', 'rf-mem-line');
            r.append(el('strong', null, k), el('span', null, v));
            box.append(r);
          }
          if (!lines.length) box.append(el('p', 'rf-alt', 'لسا ما عندي عنك شي كثير — كل ما قريت وشاهدت أكثر فهمتك أكثر 👀'));
        }
        const prefs = res.body?.prefs ?? [];
        if (prefs.length) box.append(el('h4', null, 'تفضيلات محفوظة'));
        for (const pref of prefs) {
          const r = el('div', 'rf-mem-pref');
          const t = el('div');
          t.append(el('strong', null, `${pref.polarity > 0 ? '👍' : '🚫'} ${KIND_AR[pref.kind] ?? ''}: ${deps.genreAr(pref.key)}`));
          t.append(el('small', null, [SOURCE_AR[pref.source], pref.note].filter(Boolean).join(' · ')));
          const del = el('button', 'icon-btn');
          del.type = 'button';
          del.innerHTML = glyph('trash');
          del.setAttribute('aria-label', 'احذف');
          del.onclick = async () => {
            del.disabled = true;
            const out = await sync.translation(`/v1/rafiq/prefs?id=${encodeURIComponent(pref.id)}`, { method: 'DELETE' }).catch(() => null);
            if (out?.status === 200) r.remove();
            else del.disabled = false;
          };
          r.append(t, del);
          box.append(r);
        }
      });
    });
  }

  async function fresh() {
    if (state.busy) return;
    const res = await sync.translation('/v1/rafiq/new', { method: 'POST' }).catch(() => null);
    if (res?.status !== 200) return toast('ما قدرنا نبدأ محادثة جديدة الحين');
    state.conversationId = res.body.conversationId;
    state.messages = [];
    state.pending = null;
    renderAll();
    input?.focus();
  }

  return {
    get enabled() {
      return state.enabled;
    },
    check,
    async show() {
      if (!list) build();
      if (!state.loaded) {
        list.replaceChildren(el('div', 'rf-loading', 'لحظة…'));
        await check();
      }
      if (state.enabled === false) {
        list.replaceChildren(el('p', 'rf-warn', ERRORS.rafiq_locked));
        return;
      }
      renderAll();
    },
    memory,
    fresh,
  };
}
