/**
 * واجهة الإضافة بلغة قسمها في VANTARA، مقصورة على محتوى الإضافة وحدها (طلب المالك 31 أكتوبر 2026):
 *  - مانجا: بطل الأغلفة الكبير (01 / 06) ثم أبواب الفهرس الأربعة كما في رئيسية المانجا، ثم آخر التحديثات.
 *  - أنمي وسينما: شرائط الرائج وآخر التحديثات بنفس بطاقات رئيسية الأنمي، وبطل أعرض للسينما.
 * لا كتالوج جديد ولا بيانات خارجية: كل ما يُعرض من صفحات الإضافة نفسها (الرائج/الأحدث)، والأبواب تفتح
 * قائمة الإضافة الكاملة (source-mode.js) على التبويب المطلوب.
 */
import { publicUrl } from "../addons/manifest.js";
import { pulseView } from "../addons/source-pulse.js";
import { nativeCover } from "./covers.js";
import { sourceLogo } from "./source-mode.js";

const node = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const chevron = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const titleOf = (w) => String(w?.title ?? w?.name ?? "عمل");
const imageOf = (w) => w?.thumbnail ?? w?.thumbnailUrl ?? w?.poster ?? w?.background ?? null;

/** القسم الغالب على أعمال مصدر (مصدر متنوع يأخذ واجهة أغلب محتواه، وكل عمل يُفتح بنوعه هو). */
export function dominantKind(items, fallback = "manga") {
  const count = { manga: 0, anime: 0, cinema: 0 };
  for (const w of items ?? []) {
    const t = String(w?.type ?? "").toLowerCase();
    if (t === "manga") count.manga++;
    else if (t === "anime") count.anime++;
    else if (t === "movie" || t === "series" || t === "tv") count.cinema++;
  }
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : fallback;
}

/** هل تكفي قدرات الإضافة لواجهة القسم؟ وإلا تبقى القائمة المسطحة كما كانت. */
export function supportsSourceHome(adapter) {
  return Boolean(adapter && (typeof adapter.popular === "function" || typeof adapter.latest === "function" || typeof adapter.home === "function"));
}

export function renderSourceHome({ addon, adapter, pulse = null, onOpenWork = () => {}, onOpenList = () => {}, onBack = () => {} }) {
  const types = addon.contentTypes ?? [];
  // نوع الواجهة من المحتوى الفعلي لا من اسم الإضافة: يُخمَّن مبدئيًا من أنواعها المعلنة، ثم يُحسم بأغلب ما
  // أرجعته فعلًا (مانجا ← رئيسية المانجا، أنمي ← رئيسية الأنمي، فيلم/مسلسل ← رئيسية السينما)
  let kind = types.includes("manga") ? "manga" : types.includes("anime") ? "anime" : "cinema";
  const root = node("div", "addon-source-home");
  root.dir = "rtl";
  let closed = false, timer = null;
  const controller = new AbortController();

  /** الغلاف بنفس طريق القائمة: مانجا الإضافة الأصلية بعميلها وكوكيزها، وغيرها رابط مباشر. */
  const cover = (box, work, cls = "poster") => {
    const raw = imageOf(work);
    if (!raw) return;
    let url;
    try { url = publicUrl(raw).href; } catch { return; }
    const img = node("img", cls);
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    // صنف .an-img في رئيسية الأنمي يُخفي الصورة حتى «loaded»: تُعلَّم هنا حين تُفكّ فعلًا، وإلا بقيت البطاقات فارغة
    img.onload = () => img.classList.add("loaded");
    img.onerror = () => img.classList.add("failed");
    if (addon.sourceId && (addon.bundled || addon.protocol === "native") && kind === "manga") {
      void nativeCover(url, addon.sourceId).then((local) => { if (!closed && local) { img.src = local; box.append(img); } });
    } else { img.src = url; box.append(img); }
  };
  const open = (work) => {
    if (open.busy) return;
    open.busy = true;
    try {
      void Promise.resolve(onOpenWork(work, { addon, adapter }))
        .catch(() => { /* The enclosing screen owns its user-visible error message. */ })
        .finally(() => { open.busy = false; });
    } catch {
      open.busy = false;
    }
  };

  // ── الرأس: شريط رئيسية القسم نفسه (VANTARA / القسم)، وشعار الإضافة بجانب VANTARA، والقسم مقفل على
  //    تخصص الإضافة (لا سهم تبديل). يمين: رجوع إلى الإضافات، ويسار: البحث داخل الإضافة ──
  const head = node("header", "header addon-home-header");
  const start = node("div", "header-start");
  const back = node("button", "icon-btn addon-home-back");
  back.type = "button";
  back.setAttribute("aria-label", "رجوع إلى الإضافات");
  back.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  back.onclick = onBack;
  start.append(back);
  const brandBox = node("div", "brand-box");
  const lock = node("div", "brand-switch addon-home-brand");
  lock.setAttribute("role", "heading");
  lock.setAttribute("aria-level", "1");
  lock.setAttribute("aria-label", `${addon.name} داخل VANTARA`);
  const brandRow = node("span", "addon-home-brand-row");
  const logo = sourceLogo(addon);
  logo.classList.add("addon-home-logo");
  brandRow.append(node("span", "brand", "VANTARA"), logo);
  const section = node("span", "brand-section");
  const word = node("span", "addon-home-section", "");
  section.append(word);
  lock.append(brandRow, section);
  brandBox.append(lock);
  const end = node("div", "header-end");
  const find = node("button", "icon-btn");
  find.type = "button";
  find.setAttribute("aria-label", `ابحث في ${addon.name}`);
  find.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  find.onclick = () => onOpenList("search");
  end.append(find);
  head.append(start, brandBox, end);
  const sectionWord = () => { word.textContent = kind === "manga" ? "MANGA" : kind === "anime" ? "ANIME" : "CINEMA"; };
  sectionWord();
  const status = node("p", "addon-pulse addon-home-pulse");
  const paint = () => {
    if (!pulse || !addon.key) return void (status.hidden = true);
    const st = pulseView(pulse.get(addon.key), { checking: false });
    status.className = `addon-pulse addon-pulse--${st.level} addon-home-pulse`;
    status.replaceChildren(node("i", "addon-pulse-dot"), node("b", null, addon.name), node("span", null, st.label));
  };
  paint();
  const body = node("div", "addon-home-body");
  body.append(node("p", "addon-source-note", "جارٍ جلب المصدر…"));
  root.append(head, status, body);

  // ── مانجا: البطل والأبواب ──
  function mangaHero(items) {
    const list = items.filter(imageOf).slice(0, 6);
    if (!list.length) return null;
    const hero = node("section", "hero addon-home-hero");
    hero.setAttribute("aria-roledescription", "carousel");
    const track = node("div", "hero-track"), dots = node("div", "hero-dots");
    track.style.transform = "none";
    let index = 0;
    const show = (i) => {
      index = (i + list.length) % list.length;
      const w = list[index];
      const slide = node("div", "hero-slide");
      slide.setAttribute("role", "group");
      slide.setAttribute("aria-label", titleOf(w));
      const poster = node("div", "hero-poster");
      cover(poster, w, "");
      const copy = node("div", "hero-copy");
      const folio = node("div", "hero-folio");
      folio.dir = "ltr";
      folio.append(node("b", null, String(index + 1).padStart(2, "0")), node("span", null, `/ ${String(list.length).padStart(2, "0")}`));
      const genres = Array.isArray(w.genre) ? w.genre : String(w.genre ?? w.genres ?? "").split(/\s*,\s*/).filter(Boolean);
      copy.append(folio);
      if (genres.length) copy.append(node("div", "hero-kicker", genres.slice(0, 2).join(" · ")));
      const t = node("h3", "hero-name", titleOf(w));
      t.dir = "auto";
      const cue = node("span", "hero-cue");
      cue.innerHTML = `<span>اقرأ</span>${chevron}`;
      copy.append(t, cue);
      slide.append(poster, copy);
      slide.onclick = () => open(w);
      track.replaceChildren(slide);
      for (const [k, d] of [...dots.children].entries()) d.classList.toggle("active", k === index);
    };
    dots.append(...list.map((_, i) => {
      const d = node("button", "hero-dot");
      d.type = "button";
      d.setAttribute("aria-label", `العمل ${i + 1} من ${list.length}`);
      d.onclick = (e) => { e.stopPropagation(); show(i); };
      return d;
    }));
    hero.append(track, dots);
    show(0);
    timer = setInterval(() => { if (!closed && root.isConnected) show(index + 1); }, 6000);
    return hero;
  }
  function door(no, label, sub, works, tab) {
    const b = node("button", "shortcut");
    b.type = "button";
    const art = node("span", "shortcut-art");
    art.setAttribute("aria-hidden", "true");
    for (const w of works.filter(imageOf).slice(0, 3)) { const c = node("span", "shortcut-cover"); cover(c, w, ""); art.append(c); }
    const text = node("span", "shortcut-text");
    text.append(node("i", "shortcut-no", no), node("span", "shortcut-label", label), node("small", "shortcut-sub", sub));
    b.append(art, text);
    b.insertAdjacentHTML("beforeend", chevron);
    b.onclick = () => onOpenList(tab);
    return b;
  }

  // ── أنمي وسينما: شرائط بطاقات رئيسية الأنمي ──
  function rail(title, items, tab) {
    const s = node("section", "an-rail");
    const h = node("div", "an-rail-head"), titles = node("div", "an-rail-titles");
    titles.append(node("h2", null, title));
    h.append(titles);
    const more = node("button", "an-more");
    more.type = "button";
    more.innerHTML = `<span>الكل</span>${chevron}`;
    more.onclick = () => onOpenList(tab);
    h.append(more);
    const strip = node("div", "an-strip");
    for (const w of items.slice(0, 16)) {
      const c = node("button", "an-card");
      c.type = "button";
      c.setAttribute("aria-label", titleOf(w));
      const art = node("span", "an-poster");
      cover(art, w, "an-img");
      const t = node("span", "an-card-title", titleOf(w));
      t.dir = "auto";
      c.append(art, t);
      c.onclick = () => open(w);
      strip.append(c);
    }
    s.append(h, strip);
    return s;
  }
  function billboard(w) {
    const b = node("button", "addon-home-billboard");
    b.type = "button";
    const art = node("span", "addon-home-billboard-art");
    cover(art, w, "");
    const cap = node("span", "addon-home-billboard-cap");
    const t = node("b", null, titleOf(w));
    t.dir = "auto";
    cap.append(node("small", null, kind === "cinema" ? "شاهد الآن" : "مختار من المصدر"), t);
    b.append(art, cap);
    b.onclick = () => open(w);
    return b;
  }

  const take = async (fn) => {
    if (typeof fn !== "function") return [];
    try { return (await fn.call(adapter, 1, { signal: controller.signal }))?.items ?? []; } catch { return []; }
  };
  void (async () => {
    const [popular, latest] = await Promise.all([take(adapter.popular), take(adapter.latest ?? adapter.home)]);
    if (closed) return;
    const lead = popular.length ? popular : latest;
    // تخصص الإضافة يحسم القسم؛ المعلِنة لأكثر من نوع تأخذ قسم أغلب ما أرجعته فعلًا
    if (types.length !== 1) kind = dominantKind([...popular, ...latest], kind);
    root.classList.add(`addon-source-home--${kind}`);
    sectionWord();
    if (!lead.length && !latest.length) {
      const empty = node("div", "addon-home-empty");
      empty.append(node("p", "addon-source-note", "لم يُرجع المصدر أعمالًا الآن."));
      const all = node("button", "addon-button", "افتح القائمة الكاملة");
      all.type = "button";
      all.onclick = () => onOpenList("home");
      empty.append(all);
      body.replaceChildren(empty);
      return;
    }
    const blocks = [];
    if (kind === "manga") {
      const hero = mangaHero(lead);
      if (hero) blocks.push(hero);
      const doors = node("nav", "shortcuts");
      doors.setAttribute("aria-label", `فهرس ${addon.name}`);
      doors.append(
        door("01", "آخر التحديثات", latest.length ? `${latest.length} عملًا تحدّث` : "الأحدث في المصدر", latest.length ? latest : lead, "home"),
        door("02", "الرائج", "الأكثر قراءة الآن", popular.length ? popular : lead, "popular"),
        door("03", "كل الأعمال", "كل ما في المصدر", lead.slice(3), typeof adapter.catalogue === "function" ? "catalogue" : "popular"),
        door("04", "البحث", `ابحث في ${addon.name}`, latest.slice(3), "search"),
      );
      blocks.push(doors);
      if (latest.length) blocks.push(rail("آخر التحديثات", latest, "home"));
    } else {
      if (lead[0] && imageOf(lead[0])) blocks.push(billboard(lead[0]));
      if (popular.length) blocks.push(rail(kind === "cinema" ? "رائج الآن" : "رائج في المصدر", popular, "popular"));
      if (latest.length) blocks.push(rail(kind === "cinema" ? "آخر الإضافات" : "حلقات جديدة", latest, "home"));
      const all = node("button", "addon-button addon-home-all", "كل الأعمال والبحث");
      all.type = "button";
      all.onclick = () => onOpenList("search");
      blocks.push(all);
    }
    body.replaceChildren(...blocks);
  })();

  root.close = () => { closed = true; controller.abort(); clearInterval(timer); };
  return root;
}
