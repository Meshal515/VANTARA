/**
 * رئيسية الأنمي — التصميم المعتمد (2026-11): البنر من جدول اليوم، ثم «تابع المشاهدة»، ثم جدول البث.
 *
 * - البنر بنسبة الصورة الأصلية 16:9 (لا قصّ ولا تكبير يضعفها)، وتحته شعار العمل ثم حالته وحلقته،
 *   وفعل واحد صادق: «شاهد الحلقة N» لما نزل، و«افتح العمل» لما لم ينزل بعد.
 * - التشكيلة تحته: الأبعد نزولًا أولًا، ثم الأقرب، ثم «ينزل الآن» (5 دقائق أو أقل)، ثم ما نزل من الأحدث
 *   للأقدم. لمس غلاف يبدّل البنر وشعاره ومعلوماته. الصورة الجديدة لا تظهر قبل فكّها، فلا وميض.
 * - «تابع المشاهدة» بلا حاوية: صورة الحلقة، وشريط التقدم تحتها، والغلاف شارة مقطوعة في حدّها.
 * - جدول البث بلا حاويات: أيام الأسبوع بتواريخها، وكل صف الوقت ثم صورة الحلقة ثم الاسم وحالته.
 *
 * الحركة transform/opacity فقط وتُطفأ مع «تقليل الحركة». البيانات من fetchAnimeHome كما هي.
 */

const SOON_MS = 5 * 60_000;

/** حالة حلقة اليوم بالنسبة إلى «الآن». */
export function airingStatus(at, now = Date.now()) {
  const m = Math.round((at - now) / 60_000);
  if (at <= now) return { kind: 'aired', text: 'نزلت' };
  if (at - now <= SOON_MS) return { kind: 'now', text: 'ينزل الآن' };
  if (m < 60) return { kind: 'soon', text: `بعد ${m} ${m >= 3 && m <= 10 ? 'دقائق' : 'دقيقة'}` };
  const h = Math.floor(m / 60);
  const r = m % 60;
  const hours = h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : `${h} ${h <= 10 ? 'ساعات' : 'ساعة'}`;
  return { kind: 'later', text: `بعد ${hours}${r >= 10 ? ` و${r} د` : ''}`, short: h <= 2 ? `بعد ${hours}` : `بعد ${h} س` };
}

/** ترتيب التشكيلة: الأبعد نزولًا أولًا … الأقرب، ثم ما نزل من الأحدث للأقدم. */
export function lineupOrder(items, now = Date.now()) {
  const future = items.filter((m) => m.airingAt > now).sort((a, b) => b.airingAt - a.airingAt);
  const past = items.filter((m) => m.airingAt <= now).sort((a, b) => b.airingAt - a.airingAt);
  return [...future, ...past];
}

/** البنر الافتراضي: أقرب ما سينزل، وإن لم يبقَ شيء اليوم فآخر ما نزل. */
export function defaultPick(order, now = Date.now()) {
  const future = order.filter((m) => m.airingAt > now);
  return future[future.length - 1] ?? order.find((m) => m.airingAt <= now) ?? order[0] ?? null;
}

export function createAnimeToday(h) {
  const { el, image, glyph, unitLabel, isMovie, openAnime, loadAnimeArt, episodeStill, clock12, meccaDay, dayLabel, minutesLeft, moreButton, openContinueMenu, genreAr, centerInStrip } = h;
  const motionOff = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || document.documentElement.dataset.motion === 'off';
  const artCache = new Map();
  const artFor = (m) => {
    if (!artCache.has(m.id)) artCache.set(m.id, loadAnimeArt(m.id).catch(() => null));
    return artCache.get(m.id);
  };
  /** صورة عريضة بجودتها: الصورة العريضة الأصلية، ثم صورة الحلقة. بانر AniList (400px) يُكبَّر فيضعف فلا يُستعمل هنا. */
  const wideOf = (m, art) => art?.fanart ?? (episodeStill(m, m.episode, art).still ? episodeStill(m, m.episode, art).src : null);
  const decoded = (src) => new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => (img.decode?.() ?? Promise.resolve()).then(() => resolve(img), () => resolve(img));
    img.onerror = () => resolve(null);
    img.src = src;
  });
  const genresLine = (m) => (m.genres ?? []).slice(0, 2).map(genreAr).join('، ');

  // ───────────── البنر وتشكيلة اليوم ─────────────
  function todayHero(week, now = Date.now()) {
    const today = meccaDay(now);
    const items = week.filter((m) => meccaDay(m.airingAt) === today);
    if (!items.length) return null;
    const order = lineupOrder(items, now);
    const s = el('section', 'ah-hero');
    const art = el('div', 'ah-art');
    art.append(el('div', 'ah-art-shade'));
    const body = el('div', 'ah-body');
    const lineup = el('div', 'ah-lineup');
    lineup.setAttribute('role', 'listbox');
    lineup.setAttribute('aria-label', 'حلقات اليوم');
    const stage = el('div', 'ah-stage');
    stage.append(art, body);
    s.append(stage, lineup);
    let selected = null;
    let token = 0;
    let userPicked = false;

    function paintArt(m, src, poster) {
      const layer = el('div', `ah-art-layer${src ? '' : ' ah-art-layer--poster'}`);
      const swap = () => {
        art.insertBefore(layer, art.lastElementChild);
        requestAnimationFrame(() => layer.classList.add('in'));
        const old = [...art.querySelectorAll('.ah-art-layer')].filter((n) => n !== layer);
        setTimeout(() => old.forEach((n) => n.remove()), motionOff() ? 0 : 560);
      };
      if (src) {
        layer.append(Object.assign(new Image(), { src, alt: '', className: 'ah-art-img', decoding: 'async' }));
        return swap();
      }
      // بلا صورة عريضة: ضوء من ألوان الغلاف، والغلاف نفسه واضحًا في الطرف
      layer.append(Object.assign(new Image(), { src: poster, alt: '', className: 'ah-art-amb', decoding: 'async' }));
      layer.append(Object.assign(new Image(), { src: poster, alt: '', className: 'ah-art-poster', decoding: 'async' }));
      swap();
    }
    function paintBody(m, art0) {
      const st = airingStatus(m.airingAt, Date.now());
      const lines = [];
      const logo = art0?.logo ? Object.assign(new Image(), { alt: m.title, className: 'ah-logo', decoding: 'async' }) : null;
      const name = el('h2', 'ah-name', m.title);
      name.dir = 'auto';
      if (logo) {
        // الشعار يحلّ محل الاسم حين يصل، والاسم يبقى إن فشل
        logo.onload = () => { if (name.isConnected) name.replaceWith(logo); };
        logo.src = art0.logo;
      }
      lines.push(name);
      const meta = el('div', 'ah-meta');
      meta.append(el('span', `ah-st ah-st--${st.kind}`, st.kind === 'aired' ? `نزلت اليوم ${clock12(m.airingAt)}` : st.kind === 'now' ? 'ينزل الآن' : `التالية اليوم · ${st.text}`));
      if (!isMovie(m)) meta.append(el('span', null, unitLabel(m, m.episode)));
      const g = genresLine(m);
      if (g) meta.append(el('span', null, g));
      lines.push(meta);
      const aired = st.kind === 'aired';
      const act = el('button', `ah-act${aired ? '' : ' ah-act--quiet'}`);
      act.type = 'button';
      act.innerHTML = aired ? `${glyph('play', { size: 15, filled: true })}<span>شاهد ${unitLabel(m, m.episode)}</span>` : '<span>افتح العمل</span>';
      act.onclick = () => void openAnime(m, aired ? { episode: m.episode } : {});
      lines.push(act);
      body.classList.add('swapping');
      clearTimeout(body._t);
      body._t = setTimeout(() => {
        body.replaceChildren(...lines);
        body.classList.remove('swapping');
      }, body.childElementCount && !motionOff() ? 130 : 0);
    }
    async function select(m, { fromUser = false } = {}) {
      if (fromUser) userPicked = true;
      selected = m;
      const run = ++token;
      for (const c of lineup.children) {
        const on = c._m === m;
        c.classList.toggle('sel', on);
        c.setAttribute('aria-selected', String(on));
      }
      const known = artCache.has(m.id) ? await artFor(m) : null;
      if (run !== token) return;
      paintBody(m, known);
      const art0 = known ?? (await artFor(m));
      if (run !== token) return;
      if (!known) paintBody(m, art0);
      const src = wideOf(m, art0);
      const ready = await decoded(src ?? m.poster);
      if (run !== token || !ready) return;
      paintArt(m, src, m.poster);
    }
    for (const m of order) {
      const st = airingStatus(m.airingAt, now);
      const c = el('button', `ah-cover ah-cover--${st.kind}`);
      c.type = 'button';
      c._m = m;
      c.setAttribute('role', 'option');
      c.setAttribute('aria-label', `${m.title} — ${clock12(m.airingAt)} — ${st.text}`);
      const im = el('span', 'ah-cover-img');
      im.append(image(m.posterSmall ?? m.poster));
      if (st.kind === 'aired') im.append(el('span', 'ah-tag', 'نزلت'));
      const t = el('b', null, clock12(m.airingAt));
      const sub = el('span', 'ah-cover-st');
      if (st.kind === 'now') sub.append(el('i', 'ah-dot'));
      // تحت الغلاف سطر قصير بعرضه: «بعد 10 س»، والوصف الكامل في البنر
      sub.append(st.short ?? st.text);
      c.append(im, t, sub);
      c.onclick = () => void select(m, { fromUser: true });
      lineup.append(c);
    }
    const first = defaultPick(order, now);
    void select(first);
    // الافتراضي بلا صورة عريضة: أقرب ما سينزل وله صورة يأخذ مكانه ما لم يختر المستخدم بنفسه
    void Promise.all(order.filter((m) => m.airingAt > now).map(async (m) => [m, wideOf(m, await artFor(m))])).then((pairs) => {
      if (userPicked || !s.isConnected || !selected || wideOf(selected, null)) return;
      const withArt = pairs.filter(([, src]) => src).map(([m]) => m);
      const best = withArt.sort((a, b) => a.airingAt - b.airingAt)[0];
      if (best && best !== selected) void select(best);
    });
    requestAnimationFrame(() => centerInStrip(lineup, [...lineup.children].find((c) => c._m === first)));
    return s;
  }

  // ───────────── تابع المشاهدة ─────────────
  function continueCard(w) {
    const e = w.episodes?.[w.episode] ?? {};
    const ratio = e.duration ? Math.min(1, e.position / e.duration) : e.done ? 1 : 0;
    const c = el('div', 'ah-cw');
    c.tabIndex = 0;
    c.setAttribute('role', 'button');
    c.setAttribute('aria-label', `تابع ${w.title} — ${unitLabel(w, w.episode)}`);
    c.dataset.ref = `anime:${w.id}`;
    const stage = el('div', 'ah-cw-img');
    const still = image(w.banner ?? w.poster, 'an-img', { position: w.banner ? 'center' : 'center 22%' });
    const play = el('span', 'ah-cw-play');
    play.innerHTML = glyph('play', { size: 18, filled: true });
    stage.append(still, play);
    const bar = el('div', 'ah-cw-bar');
    const fill = el('i');
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
    bar.append(fill);
    const row = el('div', 'ah-cw-row');
    const poster = el('span', 'ah-cw-poster');
    poster.append(image(w.poster));
    const info = el('div', 'ah-cw-info');
    const name = el('span', 'ah-cw-name');
    const t = el('b', null, w.title);
    t.dir = 'auto';
    name.append(t, moreButton(el, () => openContinueMenu(w), `خيارات ${w.title}`));
    const left = e.done ? 'شوهدت كاملة' : minutesLeft(e)?.replace(' د', ' دقيقة') ?? null;
    info.append(name, el('span', 'ah-cw-meta', [unitLabel(w, w.episode), left].filter(Boolean).join(' · ')));
    row.append(poster, info);
    c.append(stage, bar, row);
    const open = () => void openAnime({ id: w.id, title: w.title, format: w.format, poster: w.poster, posterSmall: w.poster, banner: w.banner, color: w.color }, { episode: w.episode });
    c.onclick = open;
    c.onkeydown = (ev) => { if (ev.key === 'Enter' && ev.target === c) open(); };
    // صورة الحلقة نفسها حين تصل، وتُبدَّل بعد أن تُفكّ فلا وميض
    void artFor({ id: w.id }).then(async (art) => {
      const shot = episodeStill({}, w.episode, art);
      if (!shot.still || !c.isConnected) return;
      if (!(await decoded(shot.src)) || !c.isConnected) return;
      still.src = shot.src;
      still.style.objectPosition = 'center';
    });
    return c;
  }

  // ───────────── جدول البث ─────────────
  function schedule(week, now = Date.now()) {
    const today = meccaDay(now);
    const days = new Map();
    for (const m of week) {
      const k = meccaDay(m.airingAt);
      if (!days.has(k)) days.set(k, []);
      days.get(k).push(m);
    }
    const keys = [...days.keys()].filter((k) => k >= meccaDay(now - 86_400_000)).sort();
    if (!keys.length) return null;
    const s = el('section', 'an-rail ah-wk');
    const head = el('div', 'an-rail-head');
    const titles = el('div', 'an-rail-titles');
    titles.append(el('h2', null, 'جدول البث'), el('span', 'an-rail-sub', 'بتوقيت مكة'));
    head.append(titles);
    const tabs = el('nav', 'ah-days');
    tabs.setAttribute('role', 'tablist');
    const list = el('div', 'ah-list');
    const more = el('button', 'ah-more');
    more.type = 'button';
    let current = keys.includes(today) ? today : keys[0];
    let expanded = false;
    const row = (m) => {
      const st = airingStatus(m.airingAt, Date.now());
      const r = el('button', `ah-row ah-row--${st.kind}`);
      r.type = 'button';
      r.setAttribute('aria-label', `${m.title} — ${clock12(m.airingAt)} — ${st.text}`);
      const [time, period] = clock12(m.airingAt).split(' ');
      const tm = el('span', 'ah-row-tm');
      tm.append(el('b', null, time), el('small', null, /م|PM/i.test(period ?? '') ? 'مساءً' : 'صباحًا'));
      const th = el('span', 'ah-row-th');
      const img = image(m.banner ?? m.posterSmall ?? m.poster, 'an-img', { position: m.banner ? 'center' : 'center 22%' });
      th.append(img);
      void artFor(m).then(async (art) => {
        const shot = episodeStill(m, m.episode, art);
        const src = shot.still ? shot.src : art?.fanart;
        if (!src || !r.isConnected || !(await decoded(src)) || !r.isConnected) return;
        img.src = src;
        img.style.objectPosition = 'center';
      });
      const tx = el('span', 'ah-row-tx');
      const t = el('b', null, m.title);
      t.dir = 'auto';
      tx.append(t, el('small', null, unitLabel(m, m.episode)), el('em', null, st.text));
      r.append(tm, th, tx);
      r.onclick = () => void openAnime(m, st.kind === 'aired' ? { episode: m.episode } : {});
      return r;
    };
    const show = (k) => {
      current = k;
      for (const b of tabs.children) {
        const on = b.dataset.day === k;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      }
      const all = (days.get(k) ?? []).slice().sort((a, b) => a.airingAt - b.airingAt);
      // الأبرز خمسة بترتيب وقتها، و«الكل» يفتح بقية اليوم في مكانه
      const top = new Set(all.slice().sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)).slice(0, 5));
      const shown = expanded ? all : all.filter((m) => top.has(m));
      list.replaceChildren(...shown.map(row));
      more.hidden = all.length <= shown.length && !expanded;
      more.textContent = expanded ? 'أقل' : `جدول ${dayLabel(k, today) === 'اليوم' ? 'اليوم' : dayLabel(k, today)} كاملًا · ${all.length} حلقة`;
    };
    for (const k of keys) {
      const d = new Date(`${k}T12:00:00Z`);
      const b = el('button', 'ah-day');
      b.type = 'button';
      b.dataset.day = k;
      b.setAttribute('role', 'tab');
      b.append(el('b', null, dayLabel(k, today)), el('small', null, String(d.getUTCDate())));
      b.onclick = () => { expanded = false; show(k); };
      tabs.append(b);
    }
    more.onclick = () => { expanded = !expanded; show(current); };
    s.append(head, tabs, list, more);
    show(current);
    requestAnimationFrame(() => centerInStrip(tabs, tabs.querySelector('.on'), 'start'));
    return s;
  }

  return { todayHero, continueCard, schedule };
}
