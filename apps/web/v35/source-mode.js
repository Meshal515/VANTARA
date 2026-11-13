import { publicUrl } from "../addons/manifest.js";
import { pulseView } from "../addons/source-pulse.js";
import { nativeCover } from "./covers.js";
import { imageLoadingNode, imageFallbackNode } from "./image-loading.js";
import { identityKind, knownSourceIdentity, resolveSourceIdentity } from "./source-identity.js";

/** اسم القسم في شريط الصفحة: VANTARA Anime / Cinema / Manga (طلب المالك). */
export const SECTION_BRAND = { manga: "VANTARA Manga", anime: "VANTARA Anime", cinema: "VANTARA Cinema" };
const KIND_AR = { manga: "مانجا", anime: "أنمي", cinema: "أفلام ومسلسلات" };

/** القسم الغالب على أعمال مصدر: مصدر متنوع يأخذ اسم أغلب محتواه، وكل عمل يُفتح بنوعه هو. */
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

/** نوع المصدر من أنواعه المعلنة: الأفلام والمسلسلات تغلب «أنمي» المعلن بجانبها (أكوام مثلًا). */
export function declaredKind(addon) {
  const types = addon?.contentTypes ?? [];
  if (types.includes("manga")) return "manga";
  if (types.some((t) => t === "movie" || t === "series")) return "cinema";
  if (types.includes("anime")) return "anime";
  return "cinema";
}
const SEARCH_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const node = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
export function sourceLogo(addon) {
  const mark = node("span", "addon-logo");
  mark.setAttribute("aria-hidden", "true");
  const fallback = () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "28");
    svg.setAttribute("height", "28");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM8 8h8M8 12h8M8 16h5");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linecap", "round");
    svg.append(path);
    mark.replaceChildren(svg);
  };
  let url;
  for (const value of [addon.iconUrl, addon.logo, addon.icon, addon.imageUrl]) {
    if (typeof value !== "string") continue;
    if (value.length <= 90 * 1024 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      url = value;
      break;
    }
    try { url = publicUrl(value).href; break; } catch {}
  }
  if (url) {
    const image = node("img");
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.style.width = "100%";
    image.style.height = "100%";
    image.style.objectFit = "contain";
    image.onerror = fallback;
    image.src = url;
    mark.append(image);
  } else fallback();
  return mark;
}
const extraLabel = (name) =>
  ({
    genre: "التصنيف",
    search: "البحث",
    country: "البلد",
    language: "اللغة",
    sort: "الترتيب",
  })[name] ?? name;
export function renderSourceMode({
  addon,
  adapter,
  state = { query: "", page: 1, scroll: 0 },
  onOpenWork = () => {},
  onBack = () => {},
  onKind = () => {},
  pulse = null,
}) {
  const root = node("div", "addon-hub addon-source"),
    tabs = node("div", "addon-catalog-tabs"),
    form = node("form", "addon-source-search"),
    input = node("input", "addon-input"),
    filters = node("div", "addon-catalog-filters"),
    grid = node("div", "addon-source-grid up-list"),
    note = node("p", "addon-source-note");
  root.dir = "rtl";
  state.page ??= 1;
  state.query ??= "";
  const fullCatalogue = (addon.contentTypes ?? []).includes("manga") && typeof adapter.catalogue === "function";

  note.setAttribute("role", "status");
  note.setAttribute("aria-live", "polite");
  let controller = null,
    closed = false,
    generation = 0,
    pending = false,
    failures = 0,
    autoMore = true,
    resumeLoad = null,
    activeLoad = null,
    retryTimer = null;
  const btn = (text, fn, cls = "addon-button") => {
    const b = node("button", cls, text);
    b.type = "button";
    b.onclick = fn;
    return b;
  };
  // رأس المصدر: شعاره واسمه ونوعه وحالته الفعلية الآن (من نبضه). الاسم هنا وحده؛ شريط الصفحة يحمل VANTARA القسم
  const header = node("section", "addon-source-head"),
    heading = node("div", "addon-source-title"),
    mark = sourceLogo(addon),
    status = node("p", "addon-pulse"),
    eyebrow = node("p", "addon-eyebrow");
  const name = node("h2", null, addon.name);
  name.dir = "auto";
  let kind = declaredKind(addon);
  const paintKind = () => { eyebrow.textContent = `مصدر ${KIND_AR[kind]}`; onKind(kind, SECTION_BRAND[kind]); };
  paintKind();
  heading.append(eyebrow, name, status);
  header.append(mark, heading);
  const paintStatus = () => {
    if (!pulse || !addon.key) return void (status.hidden = true);
    const st = pulseView(pulse.get(addon.key), { checking: pending && !grid.querySelector(".up-card") });
    status.className = `addon-pulse addon-pulse--${st.level}`;
    status.replaceChildren(node("i", "addon-pulse-dot"), node("b", null, st.label));
    if (st.detail) status.append(node("span", null, st.detail));
  };
  // البحث أولًا (أعلى الصفحة ويلتصق بها)، ثم رأس المصدر، ثم الأقسام والشبكة. الرجوع من شريط الصفحة وحده.
  const bar = node("div", "addon-source-bar");
  bar.append(form);
  root.append(bar, header, tabs, filters, note, grid);
  input.type = "search";
  input.enterKeyHint = "search";
  input.autocomplete = "off";
  input.value = state.query ?? "";
  input.placeholder = `ابحث في ${addon.name}`;
  input.setAttribute("aria-label", input.placeholder);
  const searchButton = node("button", "addon-source-go");
  searchButton.type = "submit";
  searchButton.innerHTML = SEARCH_ICON;
  searchButton.setAttribute("aria-label", "بحث");
  const clear = node("button", "addon-source-clear", "×");
  clear.type = "button";
  clear.setAttribute("aria-label", "امسح البحث");
  clear.hidden = !input.value;
  input.addEventListener("input", () => { clear.hidden = !input.value; });
  clear.onclick = () => {
    input.value = "";
    clear.hidden = true;
    if (state.query) {
      state.query = "";
      state.page = 1;
      state.skip = 0;
      if (!adapter.catalog && state.tab === "search") state.tab = choices[0]?.[0] ?? "home";
      paintFilters();
      void load();
    }
    input.focus?.();
  };
  form.append(searchButton, input, clear);
  const catalogs = addon.catalogs ?? [];
  const selectedCatalog = () =>
    catalogs.find((c) => `${c.type}|${c.id}` === state.tab) ?? catalogs[0];
  state.catalogExtras ??= {};
  function supportsExtra(extra) {
    return (
      extra.name === "search" ||
      extra.name === "skip" ||
      (Array.isArray(extra.options) && extra.options.length > 0)
    );
  }
  function paintFilters() {
    filters.replaceChildren();
    const catalog = adapter.catalog ? selectedCatalog() : null;
    const key = catalog ? `${catalog.type}|${catalog.id}` : null;
    const values = key ? (state.catalogExtras[key] ??= {}) : {};
    form.hidden = catalog
      ? !(catalog.extra ?? []).some((x) => x.name === "search")
      : !(addon.capabilities ?? []).includes("search");
    for (const b of tabs.children)
      b.setAttribute("aria-pressed", String(b.dataset.tab === state.tab));
    for (const extra of catalog?.extra ?? []) {
      if (
        extra.name === "search" ||
        extra.name === "skip" ||
        !Array.isArray(extra.options) ||
        !extra.options.length
      )
        continue;
      const label = node("label", "addon-catalog-control"),
        select = node("select", "addon-input");
      select.setAttribute("aria-label", extraLabel(extra.name));
      select.dataset.extra = extra.name;
      const empty = node("option", null, extra.isRequired ? "اختر…" : "الكل");
      empty.value = "";
      select.append(empty);
      for (const value of extra.options) {
        const option = node("option", null, String(value));
        option.value = String(value);
        select.append(option);
      }
      for (const option of select.children)
        if (option.value === (values[extra.name] ?? "")) option.selected = true;
      select.onchange = () => {
        values[extra.name] = select.value;
        state.page = 1;
        state.skip = 0;
        void load();
      };
      label.append(
        node(
          "span",
          null,
          `${extraLabel(extra.name)}${extra.isRequired ? " · مطلوب" : ""}`,
        ),
        select,
      );
      filters.append(label);
    }
  }
  // أقسام المصدر كما يقدمها هو (طلب المالك): آخر التحديثات، الرائج، والكل للمانجا. أزرار تتنقل بينها.
  const choices = catalogs.length
    ? catalogs.map((c) => [`${c.type}|${c.id}`, c.name ?? c.id])
    : [
        // المانجا: «الكل» أولًا كما كانت (الفهرس الكامل)، ثم آخر التحديثات والرائج
        ...(fullCatalogue ? [["catalogue", "الكل"]] : []),
        ...((addon.capabilities ?? []).includes("home") && typeof adapter.home === "function"
          ? [["home", "آخر التحديثات"]]
          : []),
        ...(typeof adapter.popular === "function" ? [["popular", "الرائج"]] : []),
      ];
  // القسم الأول للمصدر يفتح أولًا (آخر التحديثات إن قدّمها)، والمحفوظ من زيارة سابقة يبقى
  if (!catalogs.length && state.tab !== "search" && !choices.some(([tab]) => tab === state.tab))
    state.tab = choices[0]?.[0] ?? (fullCatalogue ? "catalogue" : "home");
  // قسم واحد (آخر التحديثات مثلًا) عنوانٌ هادئ لا زر؛ أكثر من قسم = شريط أقسام
  tabs.classList.toggle("is-single", choices.length < 2);
  for (const [tab, label] of choices) {
    const b = btn(
      label,
      () => {
        state.tab = tab;
        state.page = 1;
        state.skip = 0;
        state.query = "";
        input.value = "";
        grid.replaceChildren();
        paintFilters();
        void load();
      },
      "addon-filter",
    );
    b.dataset.tab = tab;
    tabs.append(b);
  }
  if (adapter.catalog && selectedCatalog())
    state.tab = `${selectedCatalog().type}|${selectedCatalog().id}`;
  const more = btn("تحميل المزيد", () => {
    if (pending) return;
    const previousPage = state.page ?? 1;
    state.page = previousPage + 1;
    void load({ append: true, previousPage });
  });
  more.hidden = true;
  more.classList.add("addon-source-more");
  root.append(more);
  // المزيد تلقائيًا عند الاقتراب من آخر الشبكة؛ الزر يبقى لمن يفضّله
  const io = typeof IntersectionObserver === "undefined" ? null
    : new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting) && !more.hidden && !pending && autoMore) more.click(); }, { rootMargin: "500px" });
  io?.observe(more);
  // ذاكرة صفحات الأقسام: الرجوع لقسم فُتح يظهر فورًا، والأقسام الأخرى تُجلب مسبقًا بعد أول قسم.
  // النتيجة تبقى 5 دقائق؛ الفشل لا يُحفظ.
  const pageCache = state.pageCache ??= new Map();
  const PAGE_TTL = 5 * 60_000;
  // طلب أُلغي (رجوع، تبديل قسم) يُنسى فورًا: لا يُعاد استعمال طلب معلّق بعد العودة
  const cached = (key, fetch, signal) => {
    const hit = pageCache.get(key);
    if (hit && (hit.done || !hit.signal?.aborted) && Date.now() - hit.at < PAGE_TTL) return hit.value;
    const entry = { at: Date.now(), value: null, signal, done: false };
    entry.value = Promise.resolve().then(fetch);
    pageCache.set(key, entry);
    entry.value.then(() => { entry.done = true; }, () => { if (pageCache.get(key) === entry) pageCache.delete(key); });
    signal?.addEventListener("abort", () => { if (!entry.done && pageCache.get(key) === entry) pageCache.delete(key); }, { once: true });
    return entry.value;
  };
  const tabFetch = (tab, page, signal) => {
    const o = signal ? { signal } : {};
    if (tab === "catalogue") return cached(`catalogue|${page}`, () => adapter.catalogue(page, o), signal);
    if (tab === "popular") return cached(`popular|${page}`, () => adapter.popular(page, o), signal);
    return cached(`home|${page}`, () => adapter.home(page, o), signal);
  };
  let prefetched = false;
  const prefetchTabs = () => {
    if (prefetched || closed || catalogs.length) return;
    prefetched = true;
    for (const [tab] of choices) if (tab !== state.tab) void tabFetch(tab, 1).catch(() => {});
  };
  const seen = new Set();
  const workKey = (work) => {
    const id = work.id ?? work.url;
    return id == null ? null : JSON.stringify([work.type ?? addon.contentTypes?.[0] ?? null, id]);
  };
  async function load({ append = false, previousPage } = {}) {
    clearTimeout(retryTimer);
    retryTimer = null;
    controller?.abort();
    controller = new AbortController();
    const activeController = controller,
      run = ++generation;
    pending = true;
    activeLoad = { append, previousPage };
    more.hidden = true;
    more.disabled = true;
    note.textContent = "جارٍ جلب المصدر…";
    if (!append) { seen.clear(); autoMore = true; }
    if (!append) grid.replaceChildren(...Array.from({ length: 9 }, () => node("div", "up-skel")));
    paintStatus();
    try {
      let out;
      const options = { signal: activeController.signal };
      if (adapter.catalog) {
        const catalog = selectedCatalog();
        if (!catalog) {
          grid.replaceChildren();
          note.textContent = "هذه الإضافة لا تقدم كتالوجًا.";
          return;
        }
        state.tab = `${catalog.type}|${catalog.id}`;
        const values = state.catalogExtras[state.tab] ?? {};
        const extra = {};
        for (const x of catalog.extra ?? []) {
          if (x.isRequired && !supportsExtra(x)) {
            if (!append) grid.replaceChildren();
            note.textContent = `فلتر مطلوب غير مدعوم: ${extraLabel(x.name)}. لا يمكن تحميل هذا الكتالوج.`;
            return;
          }
          const value =
            x.name === "search"
              ? state.query
              : x.name === "skip"
                ? String(append ? (state.skip ?? 0) : 0)
                : values[x.name];
          if (x.isRequired && (value == null || value === "")) {
            if (!append) grid.replaceChildren();
            note.textContent = `اختر ${extraLabel(x.name)} أولًا لعرض هذا الكتالوج.`;
            return;
          }
          if (x.name === "skip") {
            if (append || x.isRequired)
              extra.skip = append ? (state.skip ?? 0) : 0;
          } else if (supportsExtra(x) && value) extra[x.name] = value;
        }
        out = {
          items: await adapter.catalog({
            type: catalog.type,
            id: catalog.id,
            extra,
            ...options,
          }),
        };
      } else if (
        (state.query || state.tab === "search") &&
        adapter.search &&
        (addon.capabilities ?? []).includes("search")
      )
        out = await adapter.search(state.query, state.page, options);
      else if (state.tab === "catalogue" && fullCatalogue)
        out = await tabFetch("catalogue", state.page, activeController.signal);
      else if (state.tab === "popular" && adapter.popular)
        out = await tabFetch("popular", state.page, activeController.signal);
      else if (adapter.home && (addon.capabilities ?? []).includes("home"))
        out = await tabFetch("home", state.page, activeController.signal);
      else {
        grid.replaceChildren();
        note.textContent = "اكتب اسم العمل للبحث في هذا المصدر.";
        return;
      }
      if (run !== generation || activeController.signal.aborted) return;
      const items = out.mangas ?? out.items ?? (Array.isArray(out) ? out : []);
      if (!append) {
        grid.replaceChildren();
        state.skip = 0;
      }
      state.skip = (state.skip ?? 0) + items.length;
      const catalog = catalogs.find((c) => `${c.type}|${c.id}` === state.tab);
      more.hidden = !(
        out.hasNextPage ??
        out.hasNext ??
        (catalog?.extra?.some((x) => x.name === "skip") && items.length > 0)
      );
      if (!append && items.length) {
        const seen = dominantKind(items, kind);
        if (seen !== kind) { kind = seen; paintKind(); }
      }
      // بطاقة «آخر التحديثات» نفسها: الغلاف كاملًا ثم الاسم، ورقم الفصل/الحلقة فقط إن ذكره المصدر
      for (const work of items) {
        const key = workKey(work);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        const card = node("button", "up-card work-card"),
          art = node("span", "up-art"),
          title = node("b", "up-title", work.title ?? work.name ?? "عمل");
        card.type = "button";
        title.dir = "auto";
        // الفتح قد يطول (تفاصيل وحلقات من الإضافة): البطاقة تُظهر أنها تعمل، ولا تُفتح مرتين
        card.onclick = async () => {
          if (card.dataset.opening) return;
          card.dataset.opening = "1";
          card.setAttribute("aria-busy", "true");
          state.scroll = globalThis.scrollY ?? state.scroll ?? 0;
          try { await onOpenWork(work, { addon, adapter, state }); }
          finally { delete card.dataset.opening; card.removeAttribute("aria-busy"); }
        };
        const imageState = (value, label) => {
          art.dataset.imageState = value;
          art.setAttribute("role", "img");
          art.setAttribute("aria-busy", String(value === "loading"));
          art.setAttribute("aria-label", label);
          art.title = label;
        };
        const imageFailed = () => {
          imageState("failed", "تعذّر تحميل الغلاف");
          art.replaceChildren(imageFallbackNode("—"));
        };
        const sourceImage = work.thumbnail ?? work.thumbnailUrl ?? work.poster;
        const paintImage = (image, official = false) => {
        if (image) {
          imageState("loading", "جارٍ تحميل الغلاف");
          art.style.position = "relative";
          art.append(imageLoadingNode());
          try {
            const img = node("img", "poster");
            const url = publicUrl(image).href;
            img.alt = "";
            img.loading = "lazy";
            img.referrerPolicy = "no-referrer";
            // Keep the placeholder in the host until the browser decodes the image.
            img.style.position = "absolute";
            img.style.inset = "0";
            img.style.opacity = "0";
            img.onload = () => {
              if (closed || !root.contains(art)) return;
              imageState("ready", `غلاف ${work.title ?? work.name ?? "العمل"}`);
              img.style.position = "";
              img.style.inset = "";
              img.style.opacity = "";
              art.replaceChildren(img);
            };
            img.onerror = () => {
              if (!closed && root.contains(art)) imageFailed();
            };
            if (!official && addon.sourceId && (addon.bundled || addon.protocol === "native") && (addon.contentTypes ?? []).includes("manga")) {
              // Same source client, cookies, headers and persistent cover cache as the library.
              // A failed native request must stay in that pipeline (including verification).
              void nativeCover(url, addon.sourceId).then(local => {
                if (closed || !root.contains(art)) return;
                if (!local) return imageFailed();
                img.src = local;
                art.append(img);
              });
            } else {
              img.src = url;
              art.append(img);
            }
          } catch { imageFailed(); }
        } else {
          imageState("missing", "لا يوجد غلاف من المصدر");
          art.append(imageFallbackNode("—"));
        }
        };
        // الغلاف الرسمي (AniList/IMDb) للعمل الموجود هناك، وإلا غلاف المصدر. يُحسم مرة قبل الرسم: المعروف
        // فورًا، والمجهول ينتظر هويته قليلًا (هيكل بمقاسه) ثم يُرسم مرة واحدة؛ لا تبديل غلاف أمام العين.
        const officialKind = identityKind(work, addon);
        const known = officialKind ? knownSourceIdentity(work, addon) : null;
        const adopt = (identity) => {
          if (identity?.title) { title.textContent = identity.title; title.dir = "ltr"; }
          paintImage(identity?.poster ?? sourceImage, Boolean(identity?.poster));
        };
        if (!officialKind || known !== undefined) adopt(known);
        else {
          imageState("loading", "جارٍ تحميل الغلاف");
          art.append(imageLoadingNode());
          let settled = false;
          const settle = (identity) => {
            if (settled || closed || !root.contains(art)) return;
            settled = true;
            art.replaceChildren();
            adopt(identity);
          };
          void resolveSourceIdentity(work, addon).then(settle);
          setTimeout(() => settle(null), 3000);
        }
        card.append(art, title);
        const unit = work.latestChapter ?? work.lastChapter ?? work.latestEpisode;
        if (unit) card.append(node("span", "up-unit", String(unit)));
        grid.append(card);
      }
      note.textContent = items.length
        ? ""
        : state.query
          ? `لا نتائج لـ«${state.query}» في ${addon.name}.`
          : state.tab === "catalogue" ? "الكتالوج استجاب بلا أعمال الآن."
          : state.tab === "home" ? "آخر التحديثات بلا أعمال الآن."
          : "المصدر استجاب بلا أعمال الآن.";
      failures = 0;
      autoMore = true;
      paintStatus();
      if (!append && !state.query) setTimeout(prefetchTabs, 400);
    } catch (error) {
      if (run === generation && !activeController.signal.aborted) {
        if (append) {
          autoMore = false;
          if (previousPage != null) state.page = previousPage;
          more.hidden = false;
        }
        const text = String(error.message ?? "تعذر جلب المصدر").replace(
          /https?:\/\/[^\s]+/gi,
          "[رابط الخدمة]",
        );
        paintStatus();
        if (append) note.textContent = text;
        else {
          // الإصلاح الذاتي: محاولة ثانية تلقائية بعد لحظات، ثم زر صريح
          failures++;
          const box = node("div", "addon-source-error");
          box.append(
            node("b", null, failures > 1 ? "المصدر لا يستجيب الآن" : "تعذّر الجلب؛ نعيد المحاولة…"),
            node("p", null, text),
            btn("أعد المحاولة", () => { failures = 0; void load(); }, "addon-button addon-button-primary"),
          );
          grid.replaceChildren(box);
          note.textContent = "";
          if (failures === 1) retryTimer = setTimeout(() => { retryTimer = null; void load(); }, 2500);
        }
      }
    } finally {
      if (run === generation) {
        pending = false;
        more.disabled = false;
        paintStatus();
      }
    }
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    state.query = input.value.trim();
    state.page = 1;
    state.skip = 0;
    if (!adapter.catalog) state.tab = "search";
    void load();
  };
  const stopLoading = () => {
    clearTimeout(retryTimer);
    retryTimer = null;
    io?.disconnect();
    generation++;
    controller?.abort();
    pending = false;
  };
  root.close = () => {
    closed = true;
    stopLoading();
  };
  root.reload = load;
  root.pause = () => {
    if (pending) resumeLoad = activeLoad;
    state.scroll = globalThis.scrollY ?? state.scroll ?? 0;
    stopLoading();
  };
  root.resume = () => {
    closed = false;
    io?.observe(more);
    if (resumeLoad) {
      const options = resumeLoad; resumeLoad = null; void load(options);
    } else if (!grid.children.length) void load();
    globalThis.requestAnimationFrame?.(() =>
      globalThis.scrollTo?.({ top: state.scroll ?? 0, behavior: "instant" }),
    );
  };
  paintFilters();
  void load();
  return root;
}
