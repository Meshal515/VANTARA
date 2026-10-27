import { renderV7Addons } from "./addons-v7.js";
import { publicUrl } from "../addons/manifest.js";
import { supportedCapabilities } from "../addons/assessment.js";
import { glyphNode } from "./icons.js";
import { pulseView } from "../addons/source-pulse.js";
import { renderRepositories } from "./addons-repos.js";
import { renderSites } from "./addons-sites.js";
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
const configureInstructions = (registry) => (registry.runtimeName === "desktop" ? "في نافذة إعداد VANTARA، تفتح روابط stremio:// معاينة داخل VANTARA قبل الحفظ. " : "لا تضمن الخدمة العودة التلقائية من المتصفح أو APK. ") + "أكمل الإعداد في موقع الخدمة. إذا ظهر زر «تثبيت في Stremio»، انسخ رابط هذا الزر ثم ارجع إلى «إضافة جديدة» ← «رابط» والصقه للمعاينة. يقبل VANTARA روابط stremio:// وHTTPS المعدّة.";
const canOpen = (a, registry) =>
  a.enabled !== false &&
  !needsConfiguration(a) &&
  supportedCapabilities(a, registry.runtimeName ?? "pwa").some((c) => ["catalog", "search", "home"].includes(c));
const health = (a) => {
  if (a.enabled === false)
    return { level: "disabled", label: "معطلة", detail: "يمكنك تفعيل الإضافة من التفاصيل." };
  if (needsConfiguration(a))
    return {
      level: "configuration",
      label: "يحتاج إعداد",
      detail: "أكمل إعداد الخدمة ثم استورد الرابط الذي تمنحك إياه.",
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
  // شعار الإضافة إن أعلنته، وإلا أيقونة موقع المصدر نفسه (نطاقه المسموح فقط)؛ الحرفان يبقيان عند الفشل
  const host = a.permissions?.networkHosts?.[0];
  const candidates = a.logo ? [a.logo]
    : a.bundled && host && /^[a-z0-9.-]+$/i.test(host) ? [`https://${host}/apple-touch-icon.png`, `https://${host}/favicon.ico`] : [];
  const next = () => {
    const raw = candidates.shift();
    if (!raw) return;
    try {
      const u = publicUrl(raw);
      if (u.protocol !== "https:") return next();
      const img = node("img");
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.onload = () => { if (img.naturalWidth >= 16) box.classList.add("has-image"); else { img.remove(); next(); } };
      img.onerror = () => { img.remove(); next(); };
      img.src = u.href;
      box.append(img);
    } catch { next(); }
  };
  next();
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
function nativeConfigure() {
  const cap = globalThis.Capacitor;
  const plugin = cap?.isNativePlatform?.() ? cap.Plugins?.AddonEngine : null;
  return typeof plugin?.configure === "function" ? plugin : null;
}
export async function configureInApp(link, plugin, href, registry) {
  if (link.dataset.busy) return;
  link.dataset.busy = "1";
  link.dataset.label ??= link.textContent;
  const label = link.dataset.label;
  let note = null;
  try {
    const result = await plugin.configure({ url: href });
    if (!result?.url) return;
    link.textContent = "جارٍ التثبيت…";
    // ضغط Install في صفحة الإعداد هو الموافقة، كما في Stremio نفسه
    const installed = await registry.install(await registry.inspect(result.url));
    note = `تم تثبيت ${installed?.manifest?.name ?? "الإضافة"} بإعداداتك`;
    const Event = link.ownerDocument?.defaultView?.CustomEvent ?? globalThis.CustomEvent;
    link.dispatchEvent(new Event("addon-configured", { bubbles: true, detail: { key: installed?.manifest?.key ?? null } }));
  } catch (error) {
    note = message(error);
  } finally {
    delete link.dataset.busy;
    link.textContent = note ?? label;
    if (note) setTimeout(() => { if (link.isConnected) link.textContent = label; }, 4000);
  }
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
    // التطبيق: الصفحة تُفتح داخل VANTARA، و«Install» فيها يثبّت الإضافة هنا بدل أن يرمي إلى Stremio
    const plugin = nativeConfigure();
    if (plugin)
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void configureInApp(link, plugin, url.href, registry);
      });
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
    root.insertBefore(
      node(
        "p",
        "addon-muted addon-configure-help",
        configureInstructions(registry),
      ),
      status,
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
    checkController, configurationController;
  let configurationGeneration = 0;
  root.close = () => {
    closed = true;
    checkController?.abort();
    configurationController?.abort();
    configurationGeneration++;
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
  if (config && (configuration(addon).configurable || needsConfiguration(addon)) && !addon.bundled && registry.inspect && registry.install) {
    const returned = node("details", "addon-import addon-configure-return"),
      input = node("input", "addon-input"),
      result = node("div", "addon-preview"),
      controls = node("div", "addon-actions");
    returned.append(node("summary", null, "العودة برابط الإعداد إلى VANTARA"));
    input.type = "url";
    input.placeholder = "https://…/manifest.json أو stremio://…";
    input.setAttribute("aria-label", "رابط الإضافة المعدّة");
    input.dataset.configuredUrl = "";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.dir = "ltr";
    const clear = () => {
      configurationGeneration++;
      configurationController?.abort();
      result.replaceChildren();
      previewButton.disabled = false;
    };
    input.oninput = clear;
    const previewButton = button("معاينة رابط الإعداد", async () => {
      if (closed || busy) return;
      clear();
      configurationController = new AbortController();
      const run = configurationGeneration;
      previewButton.disabled = true;
      result.textContent = "جارٍ معاينة الإعداد…";
      try {
        const preview = await registry.inspect(input.value.trim(), { signal: configurationController.signal });
        if (closed || run !== configurationGeneration) return;
        if (!addon.id || preview.manifest.id !== addon.id) throw new Error("هوية الإضافة مختلفة؛ استخدم إضافة جديدة لمعاينتها.");
        const hostChanged = preview.manifest.key !== addon.key;
        if (needsConfiguration(preview.manifest)) throw new Error("ما زالت الخدمة تطلب إعدادًا؛ انسخ رابط التثبيت المعدّ بعد حفظ الخيارات.");
        const save = button("حفظ الإعداد", async () => {
          if (closed || busy || run !== configurationGeneration) return;
          busy = true;
          input.disabled = previewButton.disabled = save.disabled = true;
          try {
            await registry.install(preview, { replaceKey: addon.key });
            if (closed) return;
            input.value = "";
            result.textContent = "حُفظت الإعدادات؛ حالة التشغيل تُحدد من الفحص الفعلي.";
            onBack();
          } catch (error) {
            if (!closed) result.textContent = message(error);
          } finally {
            busy = false;
            input.disabled = previewButton.disabled = false;
          }
        }, "addon-button addon-button-primary");
        result.replaceChildren(
          ...(hostChanged ? [node("p", "addon-notice", `مضيف الإضافة سيتغير إلى ${(preview.manifest.permissions?.networkHosts ?? []).join("، ")}. حفظ الإعداد يستبدل اتصال الإضافة الحالية؛ راجع الخدمة قبل الحفظ.`)] : []),
          node("strong", null, preview.manifest.name),
          node("p", "addon-muted", `صلاحية شبكة: ${(preview.manifest.permissions?.networkHosts ?? []).join("، ")}`),
          save,
        );
      } catch (error) {
        if (!closed && run === configurationGeneration) result.textContent = message(error);
      } finally {
        if (!closed && run === configurationGeneration) previewButton.disabled = false;
      }
    });
    const cancel = button("إلغاء معاينة الإعداد", () => {
      if (busy) return;
      clear();
      previewButton.disabled = false;
      returned.open = false;
    });
    returned.addEventListener("toggle", () => { if (!returned.open && !busy) clear(); });
    controls.append(previewButton, cancel);
    returned.append(input, controls, result);
    root.insertBefore(returned, status);
  }
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
    if (registry.reinstall)
      action("إعادة تثبيت الإضافة", async () => {
        checkController?.abort();
        checkController = new AbortController();
        await registry.reinstall(addon.key, { signal: checkController.signal });
        if (!closed) onBack();
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
    action("إعادة المحاولة", async () => {
      registry.health.reset(addon.key);
      if (!onCheck) return;
      checkController?.abort();
      checkController = new AbortController();
      return onCheck(addon, { signal: checkController.signal });
    }, advanced);
  root.append(advanced);
  return root;
}
const recommendations = [
  {
    id: "com.stremio.torrentio.addon",
    name: "Torrentio",
    description: "مزود روابط تورنت للأفلام والمسلسلات والأنمي. أكمل إعداد الخدمة واستورد رابطها؛ تشغيل التورنت يعتمد على دعم المنصة.",
    configurationUrl: "https://torrentio.strem.fun/configure",
    website: "https://torrentio.strem.fun",
    capabilities: ["streams"],
    contentTypes: ["movie", "series", "anime"],
    configuration: { required: true, configurable: true, configured: false },
  },
  {
    id: "org.stremio.opensubtitlesv3",
    name: "OpenSubtitles v3",
    description: "ترجمات للأفلام والمسلسلات من خدمة OpenSubtitles.",
    url: "https://opensubtitles-v3.strem.io/manifest.json",
    website: "https://www.opensubtitles.org",
    capabilities: ["subtitles"],
    contentTypes: ["movie", "series"],
    languages: ["متعددة"],
  },
  {
    id: "com.linvo.cinemeta",
    name: "Cinemeta",
    description: "كتالوج وبيانات للأفلام والمسلسلات. لا يوفر سيرفرات تشغيل.",
    url: "https://v3-cinemeta.strem.io/manifest.json",
    website: "https://www.stremio.com",
    capabilities: ["catalog", "meta"],
    contentTypes: ["movie", "series"],
  },
  {
    id: "community.subdl.subtitles",
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
    id: "community.subsource.subtitles",
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
/** V7 entry point: reuse existing registries; never reset the user’s add-ons. */
export function renderAddons(options) { return renderV7Addons(options); }
