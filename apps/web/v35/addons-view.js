import { publicUrl } from "../addons/manifest.js";
import { supportedCapabilities } from "../addons/assessment.js";
import { glyphNode } from "./icons.js";
const node = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const button = (text, action, cls = "addon-button") => {
  const b = node("button", cls, text);
  b.type = "button";
  b.onclick = action;
  return b;
};
const labels = {
  manga: "مانجا",
  anime: "أنمي",
  movie: "أفلام",
  series: "مسلسلات",
  subtitles: "ترجمة",
  streams: "سيرفرات",
  meta: "بيانات",
  catalog: "كتالوج",
  search: "بحث",
  details: "تفاصيل",
  chapters: "فصول",
  pages: "صفحات",
  episodes: "حلقات",
  home: "تحديثات",
};
const message = (error) => {
  const text = String(error?.message ?? error ?? "تعذر إكمال الطلب");
  if (/SERVICE_URL|ORIGIN_REQUIRED|MISSING_ORIGIN/i.test(text))
    return "أدخل رابط الخدمة لهذه الإضافة ثم أعد المعاينة.";
  return text.replace(/(?:https?:\/\/|stremio:\/\/)[^\s]+/gi, "[رابط الخدمة]");
};
const configuration = (a) => a.configuration ?? a.manifest?.configuration ?? {};
const needsConfiguration = (a) =>
  configuration(a).required && !configuration(a).configured;
const canOpen = (a, registry) =>
  a.enabled !== false &&
  !needsConfiguration(a) &&
  supportedCapabilities(a, registry.runtimeName ?? "pwa").some((c) => ["catalog", "search", "home"].includes(c));
const health = (a) => {
  if (needsConfiguration(a))
    return {
      level: "configuration",
      label: "يحتاج إعداد",
      detail: "أكمل إعداد الخدمة ثم استورد الرابط الذي تمنحك إياه.",
    };
  if (a.enabled === false)
    return {
      level: "disabled",
      label: "معطلة",
      detail: "يمكنك تفعيل الإضافة من التفاصيل.",
    };
  return (
    a.assessment ?? {
      level: "candidate",
      label: a.bundled ? "مصدر مدمج" : "لم تُختبر بعد",
      detail: "تُحدد الصحة من استجابات فعلية لكل قدرة.",
    }
  );
};
function logo(a) {
  const box = node(
    "div",
    "addon-logo",
    a.name?.trim().slice(0, 2).toUpperCase() || "✦",
  );
  if (a.logo)
    try {
      const u = publicUrl(a.logo);
      if (u.protocol !== "https:") return box;
      const img = node("img");
      img.src = u.href;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => img.remove();
      box.append(img);
    } catch {}
  return box;
}
function chips(a) {
  const box = node("div", "addon-chips");
  for (const type of a.contentTypes ?? [])
    box.append(node("span", "addon-chip", labels[type] ?? type));
  if ((a.capabilities ?? []).includes("subtitles"))
    box.append(node("span", "addon-chip", "ترجمة"));
  for (const language of (a.languages ?? []).slice(0, 3))
    box.append(node("span", "addon-chip addon-chip-muted", language));
  return box;
}
function configureLink(a, registry, explicit) {
  try {
    const value = explicit ?? registry.configurationUrl?.(a.key);
    if (!value) return null;
    const url = publicUrl(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const link = node(
      "a",
      "addon-button addon-button-primary",
      "إعداد الإضافة",
    );
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.dataset.configure = "";
    return link;
  } catch {
    return null;
  }
}
export function renderAddonDetails({
  addon,
  registry,
  onOpenSource = () => {},
  onBack = () => {},
  onCheck,
}) {
  const root = node("section", "addon-hub addon-details");
  root.dir = "rtl";
  const hero = node("div", "addon-detail-heading"),
    text = node("div");
  text.append(
    node(
      "p",
      "addon-eyebrow",
      addon.bundled ? "مصادر VANTARA" : "مكتبة الإضافات",
    ),
    node("h2", null, addon.name),
    node("p", "addon-muted", `الإصدار ${addon.version ?? "—"}`),
  );
  hero.append(logo(addon), text);
  const assessment = health(addon),
    assessmentDetail = node("p", "addon-muted", assessment.detail),
    diagnostics = node("div", "addon-check-results"),
    badge = node(
      "span",
      `addon-health addon-health-${assessment.level}`,
      assessment.label,
    );
  const actions = node("div", "addon-actions"),
    status = node("p", "addon-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  root.append(
    button("رجوع", onBack, "addon-button addon-button-quiet"),
    hero,
    chips(addon),
    node(
      "p",
      "addon-description",
      addon.description ?? "مصدر إضافي لاكتشاف المحتوى في VANTARA.",
    ),
    badge,
    assessmentDetail,
    actions,
    status,
    diagnostics,
  );
  const config = configureLink(addon, registry);
  if (
    (configuration(addon).configurable || needsConfiguration(addon)) &&
    config
  ) {
    actions.append(config);
    root.append(
      node(
        "p",
        "addon-muted",
        "يفتح الإعداد في موقع الخدمة. بعد الانتهاء، ارجع وأضف الرابط الجديد من «إضافة جديدة».",
      ),
    );
  }
  if (canOpen(addon, registry))
    actions.append(
      button(
        "فتح المصدر",
        () => onOpenSource(addon),
        "addon-button addon-button-primary",
      ),
    );
  if (addon.compatibility?.[registry.runtimeName ?? "pwa"] === false)
    root.append(
      node(
        "p",
        "addon-notice",
        addon.compatibility.reason ??
          "قدرات هذه الإضافة غير مدعومة في هذه المنصة.",
      ),
    );
  let busy = false,
    closed = false,
    checkController;
  root.close = () => {
    closed = true;
    checkController?.abort();
  };
  const action = (label, fn, container = actions) => {
    const b = button(label, async () => {
      if (busy || closed) return;
      busy = true;
      for (const el of root.querySelectorAll("button")) el.disabled = true;
      status.textContent = "جارٍ تنفيذ الطلب…";
      try {
        const result = await fn();
        if (closed) return;
        if (result?.checks) {
          diagnostics.replaceChildren();
          for (const check of result.checks)
            diagnostics.append(
              node(
                "p",
                `addon-check addon-check-${check.state}`,
                `${labels[check.capability] ?? check.capability}: ${{ passed: "استجابة سليمة", failed: "فشل الفحص", empty: "استجابة بلا نتائج", untested: "لم تُختبر", unsupported: "غير مدعومة", configuration: "يحتاج إعداد", disabled: "معطلة" }[check.state] ?? "لم تُختبر"} · ${message(check.message ?? "")}`,
              ),
            );
          const current = registry.list?.().find((a) => a.key === addon.key);
          const next = result.assessment ?? health(current ?? addon);
          badge.className = `addon-health addon-health-${next.level}`;
          badge.textContent = next.label;
          assessmentDetail.textContent = next.detail;
          paintHealth(current?.health ?? addon.health);
          status.textContent = "اكتمل الفحص؛ نتائج كل قدرة أدناه.";
        } else
          status.textContent =
            result?.changed === false
              ? "لا توجد تحديثات جديدة."
              : result === false
                ? "التحديث محفوظ؛ ينتظر انتهاء الجلسة الحالية."
                : "تم بنجاح";
      } catch (e) {
        if (!closed) status.textContent = message(e);
      } finally {
        busy = false;
        for (const el of root.querySelectorAll("button")) el.disabled = false;
      }
    });
    container.append(b);
    return b;
  };
  if (onCheck)
    action("فحص الإضافة", () => {
      checkController?.abort();
      checkController = new AbortController();
      return onCheck(addon, { signal: checkController.signal });
    });
  if (registry.pin)
    action(
      addon.pinned ? "إلغاء التثبيت في الأعلى" : "تثبيت في الأعلى",
      async () => {
        await registry.pin(addon.key, !addon.pinned);
        onBack();
      },
    );
  if (!addon.bundled) {
    if (registry.enable)
      action(addon.enabled ? "تعطيل" : "تفعيل", async () => {
        await registry.enable(addon.key, !addon.enabled);
        onBack();
      });
    if (registry.stage)
      action("فحص تحديث الإضافة", async () => {
        const result = await registry.stage(addon.key);
        if (result?.changed !== false) onBack();
        return result;
      });
    if (addon.stagedVersion) {
      root.append(
        node(
          "p",
          "addon-notice",
          `تحديث متاح: ${addon.stagedVersion} · القدرات: ${(addon.stagedCapabilities ?? []).map((c) => labels[c] ?? c).join("، ")} · المضيفون: ${(addon.stagedHosts ?? []).join("، ")}`,
        ),
      );
      if (registry.activateStaged)
        action("تطبيق التحديث بعد انتهاء الجلسات", async () => {
          const result = await registry.activateStaged(addon.key);
          if (result !== false) onBack();
          return result;
        });
    }
    if (addon.previousVersion && registry.rollback)
      action("رجوع للنسخة السابقة", async () => {
        const result = await registry.rollback(addon.key);
        if (result !== false) onBack();
        return result;
      });
    if (registry.remove)
      action("إزالة الإضافة", async () => {
        await registry.remove(addon.key);
        onBack();
      });
  }
  const advanced = node("details", "addon-advanced");
  advanced.append(
    node("summary", null, "الصلاحيات والتفاصيل المتقدمة"),
    node("h3", null, "صلاحيات الشبكة"),
    node(
      "p",
      "addon-muted",
      (addon.permissions?.networkHosts ?? []).join("، ") ||
        "لا توجد صلاحيات شبكة معلنة",
    ),
    node(
      "p",
      "addon-muted",
      "الإضافة تجلب بيانات فقط؛ لا تمنحها صلاحية لحسابك.",
    ),
    node("h3", null, "القدرات"),
    node(
      "p",
      "addon-muted",
      (addon.capabilities ?? []).map((c) => labels[c] ?? c).join("، "),
    ),
  );
  const healthDetails = node("div", "addon-health-details");
  function paintHealth(values) {
    healthDetails.replaceChildren();
    for (const [cap, h] of Object.entries(values ?? {}))
      healthDetails.append(
        node(
          "p",
          "addon-muted",
          `${labels[cap] ?? cap}: ${{ unknown: "لم تُختبر", healthy: "استجابة سليمة", empty: "استجابة بلا نتائج", failed: "فشلت", cooling: "فترة تبريد" }[h.state] ?? h.state}${h.reason ? ` · ${message(h.reason)}` : ""}${h.p50 != null ? ` · ${Math.round(h.p50)}ms` : ""}${h.lastSuccessAt ? ` · آخر نجاح ${new Date(h.lastSuccessAt).toLocaleString("ar")}` : ""}`,
        ),
      );
  }
  paintHealth(addon.health);
  advanced.append(
    healthDetails,
    node("p", "addon-muted", `نوع الإضافة: ${addon.protocol ?? "مصدر أصلي"}`),
  );
  if (!addon.bundled && registry.health?.reset)
    action("إعادة المحاولة", () => registry.health.reset(addon.key), advanced);
  root.append(advanced);
  return root;
}
const recommendations = [
  {
    name: "OpenSubtitles v3",
    description: "ترجمات للأفلام والمسلسلات من خدمة OpenSubtitles.",
    url: "https://opensubtitles-v3.strem.io/manifest.json",
    website: "https://www.opensubtitles.org",
    capabilities: ["subtitles"],
    contentTypes: ["movie", "series"],
    languages: ["متعددة"],
  },
  {
    name: "Cinemeta",
    description: "كتالوج وبيانات للأفلام والمسلسلات. لا يوفر سيرفرات تشغيل.",
    url: "https://v3-cinemeta.strem.io/manifest.json",
    website: "https://www.stremio.com",
    capabilities: ["catalog", "meta"],
    contentTypes: ["movie", "series"],
  },
  {
    name: "SubDL",
    description:
      "ترجمات من SubDL. تحتاج إعداد الخدمة ومفتاح API قبل الاستخدام.",
    configurationUrl: "https://subdl.strem.top/configure",
    website: "https://subdl.com",
    capabilities: ["subtitles"],
    contentTypes: ["movie", "series"],
    configuration: { required: true, configurable: true, configured: false },
  },
  {
    name: "SubSource",
    description:
      "ترجمات من SubSource. أكمل إعداد الخدمة للحصول على رابط الإضافة.",
    configurationUrl: "https://subsource.strem.top/configure",
    website: "https://subsource.net",
    capabilities: ["subtitles"],
    contentTypes: ["movie", "series"],
    configuration: { required: true, configurable: true, configured: false },
  },
];
export function renderAddons({
  registry,
  filter = "all",
  stateFilter = "installed",
  onOpenSource = () => {},
  onBack = () => {},
  onCheck,
}) {
  const root = node("div", "addon-hub");
  root.dir = "rtl";
  const header = node("section", "addon-hero"),
    heading = node("div"),
    mark = node("span", "addon-hero-mark");
  mark.append(glyphNode("puzzle", { size: 84 }));
  heading.append(
    node("p", "addon-eyebrow", "VANTARA · مكتبتك تتسع"),
    node("h2", null, "اكتشف أكثر. أضف ما يناسبك."),
    node(
      "p",
      "addon-muted",
      "مصادرك وإضافاتك في مكان واحد، من اكتشاف الأعمال إلى الترجمة.",
    ),
  );
  header.append(heading, mark);
  const toolbar = node("div", "addon-toolbar"),
    tabs = node("div", "addon-tabs"),
    search = node("input", "addon-input addon-search"),
    filters = node("div", "addon-filters"),
    states = node("div", "addon-state-filters"),
    cards = node("div", "addon-grid"),
    notice = node("p", "addon-status");
  let activeDetail;
  let explore = stateFilter === "available",
    query = "",
    mode = "link",
    generation = 0,
    controller,
    busy = false,
    installing = false,
    closed = false,
    revealPending = false;
  search.type = "search";
  search.placeholder = "ابحث عن إضافة أو مصدر";
  search.setAttribute("aria-label", search.placeholder);
  search.dataset.addonSearch = "";
  search.oninput = () => {
    query = search.value.trim().toLowerCase();
    paint();
  };
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  for (const [isExplore, label] of [
    [false, "إضافاتي"],
    [true, "استكشاف"],
  ]) {
    const b = button(
      label,
      () => {
        explore = isExplore;
        if (!explore) stateFilter = "installed";
        paint();
      },
      "addon-tab",
    );
    b.dataset.explore = String(isExplore);
    tabs.append(b);
  }
  toolbar.append(tabs, search);
  root.append(header, toolbar, filters, states);
  const panel = node("details", "addon-import");
  panel.append(node("summary", null, "إضافة جديدة"));
  const importTabs = node("div", "addon-import-tabs"),
    form = node("form", "addon-import-form"),
    url = node("input", "addon-input"),
    json = node("textarea", "addon-input addon-json"),
    file = node("input", "addon-input"),
    service = node("input", "addon-input"),
    serviceWrap = node("label", "addon-service"),
    preview = node("div", "addon-preview"),
    controls = node("div", "addon-actions"),
    submitButton = button(
      "معاينة",
      () => {},
      "addon-button addon-button-primary",
    );
  url.type = "url";
  url.placeholder = "https://…/manifest.json";
  url.setAttribute("aria-label", "رابط الإضافة");
  url.dataset.importUrl = "";
  url.autocomplete = "off";
  url.spellcheck = false;
  url.dir = "ltr";
  json.placeholder = "ألصق manifest أو حزمة إضافات بصيغة JSON";
  json.setAttribute("aria-label", "بيانات JSON");
  json.spellcheck = false;
  json.dir = "ltr";
  file.type = "file";
  file.accept = ".json,application/json";
  file.multiple = true;
  file.dataset.importFile = "";
  file.setAttribute("aria-label", "ملفات JSON");
  service.type = "url";
  service.placeholder = "https://example.com";
  service.setAttribute("aria-label", "رابط الخدمة");
  service.dir = "ltr";
  serviceWrap.append(
    node("span", null, "رابط الخدمة — عند استيراد manifest دون رابط"),
    service,
  );
  const clearPreview = ({ force = false } = {}) => {
    if (installing && !force) return;
    generation++;
    controller?.abort();
    preview.replaceChildren();
    submitButton.disabled = false;
    busy = false;
  };
  for (const [id, label] of [
    ["link", "رابط"],
    ["json", "JSON"],
    ["file", "ملف"],
  ]) {
    const b = button(
      label,
      () => {
        if (busy && submitButton.disabled) return;
        clearPreview();
        mode = id;
        paintModes();
      },
      "addon-tab",
    );
    b.dataset.mode = id;
    importTabs.append(b);
  }
  function paintModes() {
    url.hidden = url.disabled = mode !== "link";
    json.hidden = json.disabled = mode !== "json";
    file.hidden = file.disabled = mode !== "file";
    serviceWrap.hidden = service.disabled = mode === "link";
    for (const b of importTabs.children)
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  }
  submitButton.type = "submit";
  const cancelButton = button("إلغاء", () => {
    if (installing) return;
    clearPreview();
    panel.open = false;
  });
  controls.append(submitButton, cancelButton);
  form.append(url, json, file, serviceWrap, controls);
  panel.append(
    importTabs,
    form,
    node(
      "p",
      "addon-muted",
      "عاين الإضافات وصلاحياتها قبل التثبيت. لن تفتح المعاينة أي مشغّل.",
    ),
    preview,
  );
  root.append(panel, notice, cards);
  panel.addEventListener("toggle", () => {
    if (!panel.open && !installing && !closed) clearPreview();
  });
  function matches(a) {
    return (
      (filter === "all" ||
        (filter === "subtitles" &&
          (a.capabilities ?? []).includes("subtitles")) ||
        (filter === "resolvers" &&
          (a.capabilities ?? []).includes("streams")) ||
        (filter === "metadata" &&
          (a.capabilities ?? []).some((c) =>
            ["meta", "details"].includes(c),
          )) ||
        (filter === "cinema" &&
          (a.contentTypes ?? []).some((c) =>
            ["movie", "series"].includes(c),
          )) ||
        (a.contentTypes ?? []).includes(filter)) &&
      (!query ||
        `${a.name} ${a.description ?? ""}`.toLowerCase().includes(query))
    );
  }
  function showDetails(a) {
    activeDetail?.close?.();
    activeDetail = renderAddonDetails({
      addon: a,
      registry,
      onOpenSource,
      onBack: paint,
      onCheck,
    });
    cards.replaceChildren(activeDetail);
  }
  function paint() {
    activeDetail?.close?.();
    activeDetail = null;
    cards.replaceChildren();
    for (const b of tabs.children)
      b.setAttribute(
        "aria-pressed",
        String((b.dataset.explore === "true") === explore),
      );
    for (const b of filters.children)
      b.setAttribute("aria-pressed", String(b.dataset.filter === filter));
    for (const b of states.children)
      b.setAttribute("aria-pressed", String(b.dataset.state === stateFilter));
    states.hidden = explore;
    let entries = explore ? recommendations : registry.list();
    entries = entries.filter(
      (a) =>
        matches(a) &&
        (explore ||
          stateFilter === "installed" ||
          (stateFilter === "disabled" && !a.enabled) ||
          (stateFilter === "updates" && a.stagedVersion) ||
          (stateFilter === "verification" &&
            (a.permissions?.verification ||
              Object.values(a.health ?? {}).some(
                (h) => h.reason === "NEEDS_VERIFICATION",
              )))),
    );
    for (const a of entries) {
      const card = node("article", "addon-card"),
        head = node("div", "addon-card-heading"),
        title = node("div");
      title.append(
        node("h3", null, a.name),
        node(
          "p",
          "addon-card-kind",
          explore ? "إضافة مجتمع" : a.bundled ? "مصدر VANTARA" : "إضافة خارجية",
        ),
      );
      head.append(logo(a), title);
      card.append(
        head,
        node(
          "p",
          "addon-description",
          a.description ?? "ابحث واكتشف الأعمال من هذا المصدر.",
        ),
        chips(a),
      );
      const h = health(a),
        foot = node("div", "addon-card-footer");
      foot.append(
        node("span", `addon-health addon-health-${h.level}`, h.label),
      );
      const actions = node("div", "addon-actions");
      if (explore) {
        const config = configureLink(a, registry, a.configurationUrl);
        if (config) actions.append(config);
        else
          actions.append(
            button(
              "تثبيت",
              () => {
                panel.open = true;
                mode = "link";
                paintModes();
                url.value = a.url;
                void inspect();
              },
              "addon-button addon-button-primary",
            ),
          );
        const link = node("a", "addon-service-link", "موقع الخدمة ↗");
        link.href = a.website;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        actions.append(link);
      } else {
        const config = needsConfiguration(a)
          ? configureLink(a, registry)
          : null;
        if (config) actions.append(config);
        else if (canOpen(a, registry))
          actions.append(
            button(
              "فتح المصدر",
              () => onOpenSource(a),
              "addon-button addon-button-primary",
            ),
          );
        else
          actions.append(
            button(
              "إدارة",
              () => showDetails(a),
              "addon-button addon-button-primary",
            ),
          );
        actions.append(
          button(
            "تفاصيل",
            () => showDetails(a),
            "addon-button addon-button-quiet",
          ),
        );
      }
      foot.append(actions);
      card.append(foot);
      cards.append(card);
    }
    if (!entries.length) {
      const empty = node("div", "addon-empty");
      empty.append(
        node("span", "addon-empty-mark", "✦"),
        node("h3", null, "لا توجد إضافات هنا بعد"),
        node(
          "p",
          "addon-muted",
          "جرّب فلترًا آخر، أو اكتشف إضافة جديدة لمكتبتك.",
        ),
        button("عرض جميع الإضافات", () => {
          filter = "all";
          stateFilter = "installed";
          query = "";
          search.value = "";
          paint();
        }),
      );
      cards.append(empty);
    }
    if (explore)
      cards.append(
        node(
          "p",
          "addon-discovery-note",
          "خدمات عامة معروفة، وليست شهادة بجاهزية كل قدرة. قد تحتاج بعض الخدمات حسابًا أو إعدادًا خاصًا.",
        ),
      );
  }
  for (const [id, label] of [
    ["all", "الكل"],
    ["manga", "مانجا"],
    ["anime", "أنمي"],
    ["cinema", "أفلام ومسلسلات"],
    ["subtitles", "ترجمة"],
    ["resolvers", "سيرفرات"],
    ["metadata", "بيانات"],
  ]) {
    const b = button(
      label,
      () => {
        filter = id;
        paint();
      },
      "addon-filter",
    );
    b.dataset.filter = id;
    filters.append(b);
  }
  for (const [id, label] of [
    ["installed", "الكل"],
    ["verification", "تحتاج تحقق"],
    ["disabled", "معطلة"],
    ["updates", "تحتاج تحديث"],
  ]) {
    const b = button(
      label,
      () => {
        stateFilter = id;
        paint();
      },
      "addon-state-filter",
    );
    b.dataset.state = id;
    states.append(b);
  }
  async function inspect() {
    if (busy) return;
    controller?.abort();
    controller = new AbortController();
    const run = ++generation;
    busy = true;
    submitButton.disabled = true;
    panel.open = true;
    preview.replaceChildren(node("p", "addon-muted", "جارٍ فحص الإضافة…"));
    try {
      let entries;
      if (mode === "link") {
        const p = await registry.inspect(url.value.trim(), {
          signal: controller.signal,
        });
        entries = [{ name: p.manifest.name, preview: p }];
      } else if (mode === "json")
        entries = await registry.inspectData(json.value, {
          serviceUrl: service.value.trim() || undefined,
          signal: controller.signal,
        });
      else {
        entries = [];
        if (!file.files?.length) throw new Error("اختر ملف JSON أولًا.");
        if (file.files.length > 100)
          throw new Error("يمكن استيراد 100 ملف على الأكثر في المرة الواحدة.");
        if (
          [...file.files].reduce((sum, f) => sum + (f.size ?? 0), 0) >
          1024 * 1024
        )
          throw new Error("إجمالي حجم الملفات كبير؛ الحد الأقصى 1 MB.");
        for (const f of file.files) {
          if (f.size > 1024 * 1024) {
            entries.push({
              name: f.name,
              error: { message: "حجم الملف كبير؛ الحد الأقصى 1 MB." },
            });
            continue;
          }
          try {
            const text = await f.text();
            if (run !== generation) return;
            const inspected = await registry.inspectData(text, {
              serviceUrl: service.value.trim() || undefined,
              signal: controller.signal,
            });
            if (entries.length + inspected.length > 100)
              throw new Error(
                "تحتوي الملفات على أكثر من 100 إضافة؛ قسّمها إلى دفعات أصغر.",
              );
            entries.push(...inspected);
          } catch (error) {
            entries.push({ name: f.name, error });
          }
          if (run !== generation) return;
        }
      }
      if (run !== generation) return;
      preview.replaceChildren();
      const selected = [];
      for (const entry of entries) {
        const card = node(
            "div",
            `addon-preview-entry${entry.error ? " addon-preview-error" : ""}`,
          ),
          p = entry.preview;
        if (!p) {
          card.append(
            node("h3", null, entry.name ?? "إضافة غير صالحة"),
            node("p", "addon-error", message(entry.error)),
          );
        } else {
          const checkbox = node("input");
          checkbox.type = "checkbox";
          checkbox.checked = true;
          checkbox.dataset.previewChoice = "";
          const label = node("label", "addon-preview-choice");
          label.append(
            checkbox,
            node("strong", null, entry.name ?? p.manifest.name),
          );
          card.append(
            label,
            chips(p.manifest),
            node(
              "p",
              "addon-muted",
              `صلاحية شبكة: ${(p.manifest.permissions?.networkHosts ?? []).join("، ") || "لا توجد"}. لا صلاحية لحسابك.`,
            ),
          );
          if (needsConfiguration(p.manifest))
            card.append(
              node("p", "addon-notice", "يحتاج إعداد الخدمة قبل الاستخدام."),
            );
          if (p.compatibility?.[registry.runtimeName ?? "pwa"] === false)
            card.append(
              node(
                "p",
                "addon-notice",
                p.compatibility.reason ?? "غير مدعومة في هذه المنصة.",
              ),
            );
          selected.push({ checkbox, p, card });
        }
        preview.append(card);
      }
      if (selected.length) {
        const install = button(
          selected.length === 1 && entries.length === 1
            ? "تثبيت"
            : "تثبيت المحدد",
          async () => {
            if (busy || installing || closed) return;
            const choices = selected.filter(
              (x) => x.checkbox.checked && !x.checkbox.disabled,
            );
            if (!choices.length) {
              notice.textContent = "حدد إضافة واحدة على الأقل.";
              return;
            }
            busy = true;
            installing = true;
            cancelButton.disabled = true;
            install.disabled = true;
            submitButton.disabled = true;
            let count = 0;
            try {
              for (const { p, card, checkbox } of choices) {
                if (run !== generation || closed) break;
                try {
                  await registry.install(p);
                  count++;
                  revealPending = true;
                  if (run !== generation || closed) break;
                  checkbox.disabled = true;
                  card.append(node("p", "addon-success", "تم التثبيت"));
                } catch (error) {
                  if (run !== generation || closed) break;
                  card.append(node("p", "addon-error", message(error)));
                }
              }
              if (run !== generation || closed) return;
              if (count) {
                revealInstalled();
                notice.textContent = `تم تثبيت ${count} إضافة. أصبحت ظاهرة في مكتبتك.`;
                paint();
              }
            } finally {
              installing = false;
              if (run === generation && !closed) {
                busy = false;
                cancelButton.disabled = false;
                install.disabled = false;
                submitButton.disabled = false;
              }
            }
          },
          "addon-button addon-button-primary",
        );
        preview.append(install);
      }
      if (!entries.length)
        preview.append(
          node("p", "addon-muted", "لا توجد إضافات في البيانات المرسلة."),
        );
    } catch (error) {
      if (run === generation && !controller.signal.aborted)
        preview.replaceChildren(node("p", "addon-error", message(error)));
    } finally {
      if (run === generation) {
        busy = false;
        submitButton.disabled = false;
      }
    }
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    void inspect();
  };
  function revealInstalled() {
    filter = "all";
    stateFilter = "installed";
    explore = false;
    query = "";
    search.value = "";
    revealPending = false;
  }
  root.close = () => {
    closed = true;
    clearPreview({ force: true });
    activeDetail?.close?.();
  };
  root.reload = () => {
    closed = false;
    if (revealPending) revealInstalled();
    cancelButton.disabled = installing;
    paint();
  };
  paintModes();
  paint();
  return root;
}
