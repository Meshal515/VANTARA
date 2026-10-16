/**
 * «أضف موقع مانجا» (الويب والويندوز): رابط الموقع ← اكتشاف قالبه ← فحص كامل ← مصدر.
 * التطبيق له مستودعات الإضافات بدل هذا (addons-repos.js).
 */
const node = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const reason = (error) => String(error?.message ?? error ?? "تعذر إكمال الطلب").slice(0, 240);
const ENGINES = { madara: "Madara", mangathemesia: "MangaThemesia", zeistmanga: "ZeistManga" };

export function renderSites({ sites, onSourcesChanged = () => {} }) {
  const root = node("section", "addon-repos addon-sites");
  root.dir = "rtl";
  const head = node("div", "addon-repos-head");
  head.append(
    node("h3", null, "أضف موقع مانجا"),
    node("p", "addon-muted", "الصق رابط موقع مانجا. نتعرّف على قالبه (Madara أو MangaThemesia أو ZeistManga) ونجرّبه: بحث وفصول وصفحات. إن نجح يصير مصدرًا عندك."),
  );
  const form = node("form", "addon-repos-form");
  const input = node("input", "addon-input");
  input.type = "url"; input.dir = "ltr"; input.placeholder = "https://…"; input.setAttribute("aria-label", "رابط الموقع");
  input.autocomplete = "off"; input.spellcheck = false;
  const add = node("button", "addon-button addon-button-primary", "أضف الموقع");
  add.type = "submit";
  form.append(input, add);
  const status = node("p", "addon-muted");
  status.setAttribute("role", "status");
  const list = node("div", "addon-repos-list");
  root.append(head, form, status, list);

  form.onsubmit = async (event) => {
    event.preventDefault();
    const url = input.value.trim();
    if (!url) return;
    add.disabled = true;
    status.textContent = "نفتح الموقع ونتعرّف على قالبه ونجرّبه…";
    try {
      const site = await sites.add(url);
      input.value = "";
      status.textContent = `أُضيف ${site.label} (${ENGINES[site.engine] ?? site.engine}): ${site.summary?.chapters ?? 0} فصل في أول عمل.`;
      onSourcesChanged();
      await paint();
    } catch (error) {
      status.textContent = reason(error);
    } finally {
      add.disabled = false;
    }
  };

  async function paint() {
    let rows;
    try { rows = await sites.list(); }
    catch (error) { list.replaceChildren(node("p", "addon-error", reason(error))); return; }
    if (!rows.length) { list.replaceChildren(node("p", "addon-muted", "لا مواقع مضافة بعد.")); return; }
    list.replaceChildren(...rows.map((site) => {
      const row = node("div", "addon-repo-row");
      const info = node("div", "addon-repo-info");
      info.append(node("strong", null, site.label), node("span", "addon-muted", ` · ${site.domain} · ${ENGINES[site.engine] ?? site.engine}`));
      const remove = node("button", "addon-button", "إزالة");
      remove.type = "button";
      remove.onclick = async () => {
        remove.disabled = true;
        try { await sites.remove(site.id); onSourcesChanged(); await paint(); }
        catch (error) { remove.disabled = false; status.textContent = reason(error); }
      };
      row.append(info, remove);
      return row;
    }));
  }

  void paint();
  return root;
}
