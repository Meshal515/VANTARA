import { safeUrlLabel } from "../addons/manifest.js";
const node = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const button = (text, action, cls = "btn btn-secondary") => {
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
export function renderAddonDetails({
  addon,
  registry,
  onOpenSource = () => {},
  onBack = () => {},
}) {
  const body = node("div", "block");
  body.append(
    button("رجوع", onBack),
    node("h2", null, addon.name),
    node(
      "p",
      "work-meta",
      `${addon.bundled ? "مصدر VANTARA" : "إضافة خارجية"} · ${addon.version ?? ""}`,
    ),
    node("p", "summary", addon.description ?? ""),
    node(
      "p",
      "work-meta",
      `القدرات: ${addon.capabilities.map((c) => labels[c] ?? c).join("، ")}`,
    ),
  );
  body.append(
    node(
      "p",
      "work-meta",
      `المضيفون: ${(addon.permissions?.networkHosts ?? []).join("، ")}`,
    ),
  );
  for (const [cap, h] of Object.entries(addon.health ?? {}))
    body.append(
      node(
        "p",
        "work-meta",
        `${labels[cap] ?? cap}: ${{ unknown: "لم تُختبر", healthy: "استجابة سليمة", failed: "فشلت", cooling: "فترة تبريد" }[h.state] ?? h.state}${h.reason ? ` · ${h.reason}` : ""}${h.p50 != null ? ` · p50 ${Math.round(h.p50)}ms · p95 ${Math.round(h.p95)}ms` : ""}${h.lastSuccessAt ? ` · آخر نجاح ${new Date(h.lastSuccessAt).toLocaleString("ar")}` : ""}`,
      ),
    );
  const status = node(
    "p",
    "work-meta",
    addon.compatibility?.[registry.runtimeName ?? "pwa"] === false
      ? (addon.compatibility.reason ??
          "قدرات هذه الإضافة متاحة في PWA؛ مسار APK لها غير مدعوم في هذا الإصدار")
      : addon.enabled
        ? "مفعلة؛ صحة كل قدرة تتحدد عند استخدامها"
        : "معطلة",
  );
  body.append(status);
  if (
    registry.runtimeName === "apk" &&
    !addon.bundled &&
    addon.compatibility?.apk
  )
    body.append(
      node(
        "p",
        "work-meta",
        "متاح في APK: ترجمات مستقلة. بقية القدرات تعمل عبر مسار PWA عند توافق الإضافة.",
      ),
    );
  const action = (name, fn) =>
    body.append(
      button(name, async () => {
        try {
          const result = await fn();
          status.textContent =
            result === false
              ? "تحديث محفوظ؛ ينتظر انتهاء الجلسة الحالية"
              : "تم";
        } catch (e) {
          status.textContent = e.message;
        }
      }),
    );
  if (
    (registry.runtimeName !== "apk" || addon.bundled) &&
    addon.compatibility?.[registry.runtimeName ?? "pwa"] !== false &&
    addon.capabilities.some((c) => ["search", "catalog", "home"].includes(c))
  )
    body.append(button("فتح المصدر", () => onOpenSource(addon)));
  action(
    addon.pinned ? "إلغاء التثبيت في الأعلى" : "تثبيت في الأعلى",
    async () => {
      await registry.pin(addon.key, !addon.pinned);
      onBack();
    },
  );
  if (!addon.bundled) {
    action(addon.enabled ? "تعطيل" : "تفعيل", () =>
      registry.enable(addon.key, !addon.enabled).then(onBack),
    );

    action("إعادة المحاولة", () => {
      registry.health.reset(addon.key);
      return true;
    });
    action("فحص تحديث الإضافة", async () => {
      await registry.stage(addon.key);
      onBack();
    });
    if (addon.stagedVersion)
      body.append(
        node(
          "p",
          "work-meta",
          `التحديث ${addon.stagedVersion}؛ القدرات: ${(addon.stagedCapabilities ?? []).map((c) => labels[c] ?? c).join("، ")}؛ المضيفون: ${(addon.stagedHosts ?? []).join("، ")}`,
        ),
      );
    if (addon.stagedVersion)
      action("تطبيق التحديث بعد انتهاء الجلسات", () =>
        registry.activateStaged(addon.key),
      );
    if (addon.previousVersion)
      action("رجوع للنسخة السابقة", () => registry.rollback(addon.key));
    action("إزالة الإضافة", async () => {
      await registry.remove(addon.key);
      onBack();
    });
  }
  return body;
}
export function renderAddons({
  registry,
  filter = "all",
  stateFilter = "installed",
  onOpenSource = () => {},
  onBack = () => {},
}) {
  const root = node("div", null),
    filters = node("div", "source-row"),
    states = node("div", "source-row"),
    cards = node("div", null),
    form = node("form", "search-bar"),
    input = node("input", "search-input"),
    preview = node("div", "block");
  input.type = "url";
  input.placeholder = "رابط manifest.json للإضافة";
  input.setAttribute("aria-label", "رابط الإضافة");
  input.autocomplete = "off";
  input.spellcheck = false;
  form.append(
    input,
    button("معاينة", () => form.requestSubmit?.()),
  );
  form.querySelector("button").type = "submit";
  root.append(
    node(
      "p",
      "work-meta",
      "المصادر الحالية والإضافات في مكان واحد. لا تتطلب إضافة الترجمة تشغيلًا جديدًا للفيديو.",
    ),
    filters,
    states,
    form,
    preview,
    cards,
  );
  function paint() {
    cards.replaceChildren();
    for (const a of registry.list()) {
      const needsVerification =
        a.permissions?.verification ||
        Object.values(a.health ?? {}).some(
          (h) => h.reason === "NEEDS_VERIFICATION",
        );
      if (
        stateFilter === "available" ||
        (stateFilter === "disabled" && a.enabled) ||
        (stateFilter === "updates" && !a.stagedVersion) ||
        (stateFilter === "verification" && !needsVerification)
      )
        continue;
      const match =
        filter === "all" ||
        (filter === "subtitles" && a.capabilities.includes("subtitles")) ||
        (filter === "resolvers" && a.capabilities.includes("streams")) ||
        (filter === "metadata" &&
          a.capabilities.some((c) => ["meta", "details"].includes(c))) ||
        (filter === "cinema" &&
          a.contentTypes?.some((c) => ["movie", "series"].includes(c))) ||
        a.contentTypes?.includes(filter);
      if (!match) continue;
      const card = node("section", "block"),
        name = button(a.name, () => {
          cards.replaceChildren(
            renderAddonDetails({
              addon: a,
              registry,
              onOpenSource,
              onBack: paint,
            }),
          );
        });
      card.append(
        name,
        node(
          "p",
          "work-meta",
          `${a.version ?? ""} · ${(a.languages ?? []).join(" / ") || "لغة غير محددة"} · ${a.bundled ? "مدمج" : "إضافة"} · ${a.enabled ? "مفعلة" : "معطلة"} · ${a.contentTypes?.map((c) => labels[c] ?? c).join(" / ") ?? ""}`,
        ),
        node(
          "p",
          "work-meta",
          `${a.bundled ? "مصدر أصلي" : a.protocol === "stremio" ? "Stremio" : "Remote v1"} · ${a.compatibility?.[registry.runtimeName ?? "pwa"] === false ? "غير مدعومة في هذه المنصة" : registry.runtimeName === "apk" && !a.bundled ? "دعم الترجمات فقط في APK" : "توافق حسب القدرة"}`,
        ),
      );
      const states = Object.values(a.health ?? {}),
        lastSuccess = Math.max(0, ...states.map((h) => h.lastSuccessAt ?? 0));
      if (states.length)
        card.append(
          node(
            "p",
            "work-meta",
            states.some((h) => h.state === "cooling")
              ? "فترة تبريد بعد فشل الطلبات"
              : states.some((h) => h.state === "failed")
                ? "بعض القدرات فشلت؛ افتح التفاصيل"
                : states.some((h) => h.state === "healthy")
                  ? "استجابة فعلية ناجحة لبعض القدرات"
                  : "القدرات لم تُختبر بعد",
          ),
        );
      if (lastSuccess)
        card.append(
          node(
            "p",
            "work-meta",
            `آخر استجابة ناجحة: ${new Date(lastSuccess).toLocaleString("ar")}`,
          ),
        );
      cards.append(card);
    }
    if (!cards.children.length)
      cards.append(node("p", "work-meta", "لا توجد إضافات في هذا الفلتر."));
    for (const b of filters.children)
      b.setAttribute("aria-pressed", String(b.dataset.filter === filter));
    for (const b of states.children)
      b.setAttribute("aria-pressed", String(b.dataset.state === stateFilter));
    recommendation.hidden =
      stateFilter !== "available" ||
      !["all", "subtitles", "cinema"].includes(filter);
  }
  for (const [id, label] of [
    ["installed", "المثبتة"],
    ["available", "المتاحة"],
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
      "source-chip",
    );
    b.dataset.state = id;
    states.append(b);
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
      "source-chip",
    );
    b.dataset.filter = id;
    filters.append(b);
  }
  let generation = 0;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const run = ++generation;
    preview.replaceChildren(node("p", "work-meta", "جارٍ فحص manifest…"));
    try {
      const p = await registry.inspect(input.value.trim());
      if (run !== generation) return;
      preview.replaceChildren(
        node("h3", null, p.manifest.name),
        node(
          "p",
          "work-meta",
          `${safeUrlLabel(input.value)} · ${p.manifest.capabilities.map((c) => labels[c] ?? c).join("، ")}`,
        ),
        node(
          "p",
          "work-meta",
          `صلاحية شبكة: ${p.manifest.permissions.networkHosts.join("، ")}؛ لا صلاحية لحسابك.`,
        ),
        node(
          "p",
          "work-meta",
          p.compatibility?.[registry.runtimeName ?? "pwa"] === false
            ? (p.compatibility.reason ??
                "قدرات الإضافة غير مدعومة في هذه المنصة")
            : "يحدد الاستخدام الفعلي صحة كل قدرة؛ التثبيت لا يعني أن الفيديو جاهز",
        ),
        button("تثبيت", async () => {
          try {
            await registry.install(p);
            input.value = "";
            preview.replaceChildren();
            paint();
          } catch (error) {
            preview.replaceChildren(node("p", "work-meta", error.message));
          }
        }),
        button("إلغاء", () => {
          generation++;
          preview.replaceChildren();
        }),
      );
    } catch (error) {
      if (run === generation)
        preview.replaceChildren(node("p", "work-meta", error.message));
    }
  };
  const recommendation = node("section", "block");
  recommendation.append(
    node("h3", null, "متاح للتثبيت"),
    button("OpenSubtitles v3 — ترجمات", () => {
      input.value = "https://opensubtitles-v3.strem.io/manifest.json";
      form.dispatchEvent(new Event("submit", { cancelable: true }));
    }),
  );
  root.append(recommendation);
  paint();
  return root;
}
