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

/**
 * آخر بنر «اليوم» محسوم: أي عمل اختير لأي افتراضي، وصورته وشعاره. الدخول التالي يرسمه في أول إطار
 * بدل بنر أسود ثم ظهور مفاجئ. يُستعمل فقط إن كان الافتراضي المحسوب الآن هو نفسه (لا عمل من يوم سابق).
 */
export const TODAY_KEY = 'vantara.anime.todayHero.v1';
export function readTodayMemory(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage?.getItem(TODAY_KEY) ?? 'null');
    return v && typeof v === 'object' && v.for != null && v.id != null && typeof v.src === 'string' ? v : null;
  } catch { return null; }
}
export function writeTodayMemory(v, storage = globalThis.localStorage) {
  try { storage?.setItem(TODAY_KEY, JSON.stringify({ for: v.for, id: v.id, src: v.src, logo: v.logo ?? null, at: v.at ?? Date.now() })); } catch { /* تخزين محجوب */ }
}
/** العمل الذي يبدأ به البنر: المحفوظ لنفس الافتراضي إن كان في تشكيلة اليوم، وإلا الافتراضي. */
export function initialPick(order, first, memory) {
  if (!first) return { m: null, memory: null };
  if (memory && String(memory.for) === String(first.id)) {
    const m = order.find((x) => String(x.id) === String(memory.id));
    if (m) return { m, memory };
  }
  return { m: first, memory: null };
}

export function createAnimeToday(h) {
  const { el, image, glyph, unitLabel, isMovie, openAnime, loadAnimeArt, episodeStill, clock12, meccaDay, dayLabel, minutesLeft, moreButton, openContinueMenu, genreAr, centerInStrip, heroMemory = null, seriesBackdrop = null } = h;
  const motionOff = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || document.documentElement.dataset.motion === 'off';
  const artCache = new Map();
  const artFor = (m) => {
    if (!artCache.has(m.id)) artCache.set(m.id, loadAnimeArt(m.id).catch(() => null));
    return artCache.get(m.id);
  };
  /** صورة عريضة بجودتها: الصورة العريضة الأصلية، ثم صورة الحلقة. بانر AniList (400px) يُكبَّر فيضعف فلا يُستعمل هنا. */
  /**
   * صور البنر العريضة بترتيب صفحة العمل نفسها (anime.js، paintHero): الخلفية الرسمية من metahub بمعرّف IMDb،
   * ثم fanart، ثم لقطة الحلقة، ثم بنر AniList. كان البنر يأخذ fanart واللقطة فقط، فالعمل الذي له خلفية في
   * صفحته (Ace of the Diamond مثلًا) يظهر هنا بغلافه.
   */
  const wideCandidates = (m, art) => {
    const out = [];
    const add = (src) => { if (src && !out.includes(src)) out.push(src); };
    // الخلفية التي ظهرت فعلًا لهذا العمل (في صفحته أو هنا): ذاكرة صفحة العمل نفسها، فتظهر فورًا
    add(heroMemory?.get(m.id));
    if (/^tt\d+$/.test(art?.imdb ?? '')) {
      add(`https://images.metahub.space/background/large/${art.imdb}/img`);
      add(`https://images.metahub.space/background/medium/${art.imdb}/img`);
    }
    add(art?.fanart);
    const shot = episodeStill(m, m.episode, art);
    if (shot.still) add(shot.src);
    add(m.banner);
    return out;
  };
  const wideOf = (m, art) => wideCandidates(m, art)[0] ?? null;
  /** أول صورة عريضة تُحمَّل فعلًا من القائمة بالترتيب (رابط metahub قد يفشل لعمل بلا خلفية). */
  const firstDecoded = async (list) => {
    for (const src of list) if (await decoded(src)) return src;
    return null;
  };
  const decoded = (src) => new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => (img.decode?.() ?? Promise.resolve()).then(() => resolve(img), () => resolve(img));
    img.onerror = () => resolve(null);
    img.src = src;
  });
  // الشعارات المفكوكة محفوظة (حتى 48): لا تُطلب ولا تُفك مرتين، ولا يرجع الاسم مكان شعار سبق عرضه
  const logoCache = new Map();
  const logoFor = (url) => {
    if (!url) return Promise.resolve(null);
    if (!logoCache.has(url)) {
      logoCache.set(url, decoded(url).then((img) => (img ? url : null)));
      if (logoCache.size > 48) logoCache.delete(logoCache.keys().next().value);
    }
    return logoCache.get(url);
  };
  const genresLine = (m) => (m.genres ?? []).slice(0, 2).map(genreAr).join('، ');

  /** ما يحتاجه بنر العمل جاهزًا ومفكوكًا: { src, logo } (logo null = لا شعار له، أو لم يصل في وقته). */
  async function prepare(m) {
    // بيانات العمل (ومنها معرّف IMDb الذي يأتي منه الشعار والخلفية) قد تتأخر ثواني: كانت المهلة 1.5 ثانية
    // فيُعرض الغلاف والاسم بديلًا نهائيًا لعمل له بنر وشعار. الآن 6 ثوانٍ، والبنر الحالي ثابت حتى يجهز
    // الجديد كله (والغلاف المختار ينبض). بعدها فقط البديل: الغلاف، أو الاسم.
    const deadline = Date.now() + 6000;
    const late = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), Math.max(0, deadline - Date.now())))]);
    const art0 = await late(artFor(m));
    let [src, logo] = await Promise.all([late(firstDecoded(wideCandidates(m, art0))), late(logoFor(art0?.logo))]);
    // موسم بلا خلفية خاصة: خلفية عمله الأب كما في صفحة العمل (تحتاج علاقاته، وهي في تفاصيله فقط)
    if (!src && seriesBackdrop && m.relations?.length) src = await late(seriesBackdrop(m).then((b) => (b ? decoded(b).then((ok) => (ok ? b : null)) : null)));
    // ما ظهر يُحفظ لصفحة العمل وللمرة القادمة؛ لقطة الحلقة وبنر AniList ليسا خلفية العمل فلا يُحفظان
    if (src && (src.includes('metahub') || src === art0?.fanart)) heroMemory?.set(m.id, src);
    if (!src) await late(decoded(m.poster));
    return { src: src ?? null, logo };
  }
  /**
   * «اليوم» يُجهَّز قبل دخول القسم (عند فتح التطبيق أو في وقت الخمول): صورة البنر الافتراضي وشعاره يُفكّان
   * ويُحفظ اختياره، فأول دخول يجده في أول إطار.
   */
  async function prewarm(week, now = Date.now()) {
    const day = meccaDay(now);
    const items = (week ?? []).filter((m) => meccaDay(m.airingAt) === day);
    const first = defaultPick(lineupOrder(items, now), now);
    if (!first) return null;
    const mem = readTodayMemory();
    if (mem && String(mem.for) === String(first.id)) {
      await Promise.all([decoded(mem.src), mem.logo ? logoFor(mem.logo) : null]);
      return mem;
    }
    const ready = await prepare(first);
    if (!ready.src) return null;
    const v = { for: first.id, id: first.id, src: ready.src, logo: ready.logo };
    writeTodayMemory(v);
    return v;
  }

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

    // البنر يتبدل بلقطة واحدة: الصورة العريضة والشعار يُجهَّزان (يُفكّان) معًا ثم يُعرضان معًا، فلا اسم عمل فوق
    // صورة آخر، ولا نص يتحول شعارًا أمام العين. ما لم يجهز بعد يبقى البنر الحالي ثابتًا والغلاف المختار
    // يُعلَّم «يجهز». الشعار المحمّل محفوظ (logoCache)، فالعودة لعمل سبق عرضه تُظهر شعاره مباشرة.
    let latest = null;
    let shown = null;
    function paintArt(src, poster, { instant = false } = {}) {
      const layer = el('div', `ah-art-layer${src ? '' : ' ah-art-layer--poster'}`);
      if (src) layer.append(Object.assign(new Image(), { src, alt: '', className: 'ah-art-img', decoding: 'async' }));
      else {
        // بلا صورة عريضة: ضوء من ألوان الغلاف، والغلاف نفسه واضحًا في الطرف
        layer.append(Object.assign(new Image(), { src: poster, alt: '', className: 'ah-art-amb', decoding: 'async' }));
        layer.append(Object.assign(new Image(), { src: poster, alt: '', className: 'ah-art-poster', decoding: 'async' }));
      }
      art.insertBefore(layer, art.lastElementChild);
      latest = layer;
      // محفوظ ومفكوك سابقًا (من كاش الصور): يظهر في أول إطار بلا تلاشٍ ولا لحظة سوداء
      if (instant) {
        layer.classList.add('in', 'ah-art-layer--now');
        art.classList.remove('ah-art--wait');
        return;
      }
      // صور الطبقة نفسها تُفك قبل أن تظهر: كانت صورة الغلاف المضببة تُرسم بعد إطار، فيظهر البنر السابق من
      // خلال الطبقة الشفافة ثم يتضبب فوقه (بلاغ المالك). الطبقة معتمة (CSS) فلا يظهر ما تحتها أبدًا.
      latest = layer;
      const imgs = [...layer.querySelectorAll('img')];
      void Promise.all(imgs.map((im) => im.decode?.().catch(() => {}))).then(() => reveal(layer));
    }
    function reveal(layer) {
      // اختيار أحدث سبقها: هذه الطبقة لا تظهر أبدًا (الأحدث يتولى)
      if (layer !== latest) return layer.remove();
      art.classList.remove('ah-art--wait');
      const old = [...art.querySelectorAll('.ah-art-layer')].filter((n) => n !== layer);
      if (motionOff() || !old.length) {
        layer.classList.add('in');
        old.forEach((n) => n.remove());
        return;
      }
      requestAnimationFrame(() => layer.classList.add('in'));
      // القديمة تبقى تحت الجديدة حتى تكتمل: لا لحظة سوداء بين الصورتين
      setTimeout(() => { for (const n of old) if (n !== latest) n.remove(); }, 380);
    }
    function bodyFor(m, logoSrc) {
      const st = airingStatus(m.airingAt, Date.now());
      const mark = el('div', `ah-mark${logoSrc ? ' ah-mark--logo' : ''}`);
      if (logoSrc) mark.append(Object.assign(new Image(), { src: logoSrc, alt: m.title, className: 'ah-logo', decoding: 'sync' }));
      else {
        const name = el('h2', `ah-name${m.title.length > 26 ? ' ah-name--long' : ''}`, m.title);
        name.dir = 'auto';
        mark.append(name);
      }
      const meta = el('div', 'ah-meta');
      meta.append(el('span', `ah-st ah-st--${st.kind}`, st.kind === 'aired' ? `نزلت اليوم ${clock12(m.airingAt)}` : st.kind === 'now' ? 'ينزل الآن' : `التالية اليوم · ${st.text}`));
      if (!isMovie(m)) meta.append(el('span', null, unitLabel(m, m.episode)));
      const g = genresLine(m);
      if (g) meta.append(el('span', null, g));
      const aired = st.kind === 'aired';
      const act = el('button', `ah-act${aired ? '' : ' ah-act--quiet'}`);
      act.type = 'button';
      act.innerHTML = aired ? `${glyph('play', { size: 15, filled: true })}<span>شاهد ${unitLabel(m, m.episode)}</span>` : '<span>افتح العمل</span>';
      act.onclick = () => void openAnime(m, aired ? { episode: m.episode } : {});
      return [mark, meta, act];
    }
    /** هيكل المعلومات بنفس صناديقها المحجوزة (الشعار 72، السطر، الزر): لا تتحرك التشكيلة حين تصل. */
    function bodySkeleton() {
      const mark = el('div', 'ah-mark');
      mark.append(el('span', 'an-skel ah-skel-logo'));
      const meta = el('div', 'ah-meta');
      meta.append(el('span', 'an-skel ah-skel-line'));
      const act = el('span', 'ah-act ah-act--skel an-skel');
      act.setAttribute('aria-hidden', 'true');
      return [mark, meta, act];
    }
    function paintBody(lines, instant) {
      clearTimeout(body._t);
      if (instant || motionOff() || !body.childElementCount) {
        body.classList.remove('swapping');
        body.replaceChildren(...lines);
        return;
      }
      body.classList.add('swapping');
      body._t = setTimeout(() => {
        body.replaceChildren(...lines);
        body.classList.remove('swapping');
      }, 120);
    }
    async function select(m, { fromUser = false, instant = false } = {}) {
      if (fromUser) userPicked = true;
      selected = m;
      const run = ++token;
      for (const c of lineup.children) {
        const on = c._m === m;
        c.classList.toggle('sel', on);
        c.classList.remove('loading');
        c.setAttribute('aria-selected', String(on));
      }
      const cover = [...lineup.children].find((c) => c._m === m);
      const slow = setTimeout(() => { if (run === token) cover?.classList.add('loading'); }, 160);
      const ready = await prepare(m);
      clearTimeout(slow);
      cover?.classList.remove('loading');
      if (run !== token || !s.isConnected) return;
      // المحفوظ ظهر في أول إطار وهو نفسه المحسوم الآن: لا تبديل (انتقال واحد على الأكثر)
      const same = shown && shown.id === m.id && shown.src === (ready.src ?? null) && shown.logo === (ready.logo ?? null);
      shown = { id: m.id, src: ready.src ?? null, logo: ready.logo ?? null };
      if (!userPicked && ready.src) writeTodayMemory({ for: first?.id, id: m.id, src: ready.src, logo: ready.logo });
      if (same) return void neighbours(m);
      paintBody(bodyFor(m, ready.logo), instant || Boolean(body.querySelector('.ah-skel-logo')));
      paintArt(ready.src, m.poster);
      neighbours(m);
    }
    function neighbours(m) {
      // الجاران في التشكيلة يُجهَّزان الآن، فالانتقال إليهما فوري. لا أكثر: لا تحميل كل اليوم دفعة
      if (!s.isConnected) return;
      const i = order.indexOf(m);
      for (const n of [order[i - 1], order[i + 1]]) if (n) void prepare(n);
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
    // أول إطار: آخر بنر محسوم لنفس الافتراضي (صورته من كاش الصور وشعاره)، وإلا هيكل بمقاس البنر
    const start = initialPick(order, first, readTodayMemory());
    if (start.memory) {
      selected = start.m;
      shown = { id: start.m.id, src: start.memory.src, logo: start.memory.logo ?? null };
      for (const c of lineup.children) {
        const on = c._m === start.m;
        c.classList.toggle('sel', on);
        c.setAttribute('aria-selected', String(on));
      }
      body.replaceChildren(...bodyFor(start.m, start.memory.logo ?? null));
      paintArt(start.memory.src, start.m.poster, { instant: true });
    } else {
      art.classList.add('ah-art--wait');
      body.replaceChildren(...bodySkeleton());
    }
    void select(start.m, { instant: true });
    // الافتراضي بلا صورة عريضة: أقرب ثلاثة قادمة تُفحص فقط، وأقربها بصورة يأخذ مكانه ما لم يختر المستخدم
    void artFor(first).then((a0) => {
      if (start.memory || wideOf(first, a0)) return;
      const next = order.filter((m) => m.airingAt > now).sort((a, b) => a.airingAt - b.airingAt).slice(0, 4);
      return Promise.all(next.map(async (m) => [m, wideOf(m, await artFor(m))])).then((pairs) => {
        const best = pairs.find(([, src]) => src)?.[0];
        if (!userPicked && s.isConnected && best && selected === first) void select(best);
        // لا بنر عريض للافتراضي ولا للقريب: الغلاف بديلًا محسومًا (يُحفظ كي لا يُعاد البحث في كل دخول)
      });
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
      // الصورة تُحسم قبل الظهور (قاعدة المالك): كان الغلاف يظهر ثم تحل محله لقطة الحلقة أمام العين.
      // المكان محجوز، ثم صورة واحدة: لقطة الحلقة، وإلا fanart، وإلا البنر أو الغلاف (مهلة 1.5ث)
      const base = m.banner ?? m.posterSmall ?? m.poster;
      const img = image(null, 'an-img', { fallback: base });
      th.append(img);
      const show = (src, wide) => { if (img.src) return; img.style.objectPosition = wide || m.banner ? 'center' : 'center 22%'; img.src = src; };
      const wait = setTimeout(() => show(base, false), 1500);
      void artFor(m).then(async (art) => {
        const shot = episodeStill(m, m.episode, art);
        const src = shot.still ? shot.src : art?.fanart;
        if (src && r.isConnected && (await decoded(src))) { clearTimeout(wait); return show(src, true); }
        clearTimeout(wait);
        show(base, false);
      }, () => { clearTimeout(wait); show(base, false); });
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

  return { todayHero, continueCard, schedule, prewarm };
}
