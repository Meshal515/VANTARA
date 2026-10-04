import { publicUrl } from "../addons/manifest.js";
const node = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
export function renderSourceMode({
  addon,
  adapter,
  state = { tab: "home", query: "", page: 1, scroll: 0 },
  onOpenWork = () => {},
  onBack = () => {},
}) {
  const root = node("div"),
    tabs = node("div", "source-row"),
    form = node("form", "search-bar"),
    input = node("input", "search-input"),
    grid = node("div", "grid"),
    note = node("p", "work-meta");
  let controller = null,
    generation = 0;
  const btn = (text, fn, cls = "btn btn-secondary") => {
    const b = node("button", cls, text);
    b.type = "button";
    b.onclick = fn;
    return b;
  };
  root.append(
    btn("الإضافات", onBack),
    node("h2", null, addon.name),
    tabs,
    form,
    note,
    grid,
  );
  input.type = "search";
  input.value = state.query;
  input.placeholder = `ابحث في ${addon.name}`;
  input.setAttribute("aria-label", input.placeholder);
  form.append(
    input,
    btn("بحث", () => form.requestSubmit?.()),
  );
  form.querySelector("button").type = "submit";
  form.hidden =
    !addon.capabilities.includes("search") &&
    !addon.catalogs?.some((c) => c.extra?.some((x) => x.name === "search"));
  const choices = addon.catalogs?.length
    ? addon.catalogs.map((c) => [`${c.type}|${c.id}`, c.name ?? c.id])
    : [
        ...(addon.capabilities.includes("home")
          ? [["home", "آخر التحديثات"]]
          : []),
        ...(addon.bundled && addon.contentTypes.includes("manga")
          ? [["popular", "الرائج"]]
          : []),
      ];
  for (const [tab, label] of choices)
    tabs.append(
      btn(
        label,
        () => {
          state.tab = tab;
          state.page = 1;
          void load();
        },
        "source-chip",
      ),
    );
  const more = btn("تحميل المزيد", () => {
    state.page = (state.page ?? 1) + 1;
    void load({ append: true });
  });
  more.hidden = true;
  root.append(more);
  async function load({ append = false } = {}) {
    controller?.abort();
    controller = new AbortController();
    const run = ++generation;
    more.hidden = true;
    note.textContent = "جارٍ جلب المصدر…";
    try {
      let out;
      const options = { signal: controller.signal };
      if (adapter.catalog) {
        const catalog =
          addon.catalogs?.find((c) => `${c.type}|${c.id}` === state.tab) ??
          addon.catalogs?.[0];
        if (!catalog) {
          note.textContent = "هذه الإضافة لا تقدم كتالوجًا.";
          return;
        }
        state.tab = `${catalog.type}|${catalog.id}`;
        out = {
          items: await adapter.catalog({
            type: catalog.type,
            id: catalog.id,
            extra: {
              ...(state.query ? { search: state.query } : {}),
              ...(append ? { skip: state.skip ?? 0 } : {}),
            },
            ...options,
          }),
        };
      } else if (state.query || state.tab === "search")
        out = await adapter.search(state.query, state.page, options);
      else if (state.tab === "popular" && adapter.popular)
        out = await adapter.popular(state.page, options);
      else if (adapter.home && addon.capabilities.includes("home"))
        out = await adapter.home(state.page, options);
      else {
        note.textContent = "اكتب اسم العمل للبحث في هذا المصدر.";
        return;
      }
      if (run !== generation) return;
      const items = out.mangas ?? out.items ?? (Array.isArray(out) ? out : []);
      if (!append) {
        grid.replaceChildren();
        state.skip = 0;
      }
      state.skip = (state.skip ?? 0) + items.length;
      const catalog = addon.catalogs?.find(
        (c) => `${c.type}|${c.id}` === state.tab,
      );
      more.hidden = !(
        out.hasNextPage ??
        out.hasNext ??
        (catalog?.extra?.some((x) => x.name === "skip") && items.length > 0)
      );
      for (const work of items) {
        const card = btn(
          work.title ?? work.name ?? "عمل",
          () => {
            state.scroll = globalThis.scrollY ?? state.scroll ?? 0;
            onOpenWork(work, { addon, adapter, state });
          },
          "work-card",
        );
        const image = work.thumbnail ?? work.thumbnailUrl ?? work.poster;
        if (image) {
          try {
            const img = node("img", "poster");
            img.src = publicUrl(image).href;
            img.alt = "";
            img.loading = "lazy";
            card.prepend(img);
          } catch {}
        }
        grid.append(card);
      }
      note.textContent = items.length
        ? `${items.length} عمل`
        : "لا توجد نتائج لهذا البحث.";
    } catch (error) {
      if (run === generation && !controller.signal.aborted)
        note.textContent = error.message;
    }
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    state.query = input.value.trim();
    state.page = 1;
    state.tab = "search";
    void load();
  };
  root.close = () => {
    generation++;
    controller?.abort();
  };
  root.reload = load;
  root.pause = () => {
    state.scroll = globalThis.scrollY ?? state.scroll ?? 0;
    root.close();
  };
  root.resume = () => {
    if (!grid.children.length) void load();
    globalThis.requestAnimationFrame?.(() =>
      globalThis.scrollTo?.({ top: state.scroll ?? 0, behavior: "instant" }),
    );
  };
  void load();
  return root;
}
