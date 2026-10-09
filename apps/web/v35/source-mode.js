import { publicUrl } from "../addons/manifest.js";
import { pulseView } from "../addons/source-pulse.js";
const node = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
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
  state = { tab: "home", query: "", page: 1, scroll: 0 },
  onOpenWork = () => {},
  onBack = () => {},
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
  note.setAttribute("role", "status");
  note.setAttribute("aria-live", "polite");
  let controller = null,
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
  // رأس المصدر: اسمه وحالته الفعلية الآن (من نبضه)، بلا شعار عام
  const header = node("section", "addon-source-head"),
    heading = node("div", "addon-source-title"),
    mark = node("span", "addon-logo", addon.name?.trim().slice(0, 2).toUpperCase() || "✦"),
    status = node("p", "addon-pulse");
  const name = node("h2", null, addon.name);
  name.dir = "auto";
  const kind = (addon.contentTypes ?? []).includes("manga") ? "مانجا" : (addon.contentTypes ?? []).includes("anime") ? "أنمي" : "أفلام ومسلسلات";
  heading.append(node("p", "addon-eyebrow", `مصدر ${kind}`), name, status);
  header.append(mark, heading);
  const paintStatus = () => {
    if (!pulse || !addon.key) return void (status.hidden = true);
    const st = pulseView(pulse.get(addon.key), { checking: pending && !grid.querySelector(".up-card") });
    status.className = `addon-pulse addon-pulse--${st.level}`;
    status.replaceChildren(node("i", "addon-pulse-dot"), node("b", null, st.label));
    if (st.detail) status.append(node("span", null, st.detail));
  };
  root.append(
    btn("‹ الإضافات", onBack, "addon-button addon-button-quiet addon-source-back"),
    header,
    tabs,
    filters,
    form,
    note,
    grid,
  );
  input.type = "search";
  input.value = state.query ?? "";
  input.placeholder = `ابحث في ${addon.name}`;
  input.setAttribute("aria-label", input.placeholder);
  const searchButton = btn(
    "بحث",
    () => {},
    "addon-button addon-button-primary",
  );
  searchButton.type = "submit";
  form.append(input, searchButton);
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
  const choices = catalogs.length
    ? catalogs.map((c) => [`${c.type}|${c.id}`, c.name ?? c.id])
    : [
        ...((addon.capabilities ?? []).includes("home")
          ? [["home", "آخر التحديثات"]]
          : []),
        ...(addon.bundled && (addon.contentTypes ?? []).includes("manga")
          ? [["popular", "الرائج"]]
          : []),
      ];
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
      else if (state.tab === "popular" && adapter.popular)
        out = await adapter.popular(state.page, options);
      else if (adapter.home && (addon.capabilities ?? []).includes("home"))
        out = await adapter.home(state.page, options);
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
        card.onclick = () => {
          state.scroll = globalThis.scrollY ?? state.scroll ?? 0;
          onOpenWork(work, { addon, adapter, state });
        };
        const image = work.thumbnail ?? work.thumbnailUrl ?? work.poster;
        if (image)
          try {
            const img = node("img", "poster");
            img.src = publicUrl(image).href;
            img.alt = "";
            img.loading = "lazy";
            img.referrerPolicy = "no-referrer";
            img.onerror = () => img.remove();
            art.append(img);
          } catch {}
        card.append(art, title);
        const unit = work.latestChapter ?? work.lastChapter ?? work.latestEpisode;
        if (unit) card.append(node("span", "up-unit", String(unit)));
        grid.append(card);
      }
      note.textContent = items.length
        ? ""
        : state.query
          ? `لا نتائج لـ«${state.query}» في ${addon.name}.`
          : "المصدر استجاب بلا أعمال الآن.";
      failures = 0;
      autoMore = true;
      paintStatus();
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
  root.close = () => {
    clearTimeout(retryTimer);
    retryTimer = null;
    io?.disconnect();
    generation++;
    controller?.abort();
    pending = false;
  };
  root.reload = load;
  root.pause = () => {
    if (pending) resumeLoad = activeLoad;
    state.scroll = globalThis.scrollY ?? state.scroll ?? 0;
    root.close();
  };
  root.resume = () => {
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
