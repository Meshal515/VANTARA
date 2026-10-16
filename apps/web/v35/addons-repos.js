/**
 * مستودعات مصادر المانجا (صيغة Mihon/Keiyoushi) داخل قسم المانجا في الإضافات.
 *
 * تضيف رابط مستودع ← تظهر إضافاته (العربية أولًا) ← تثبّت ما تريد. كل إضافة كود يعمل
 * داخل التطبيق، فالإضافة الأولى للمستودع تحتاج تأكيد ثقة صريحًا، والمحرّك الأصلي
 * يرفض أي APK لم يوقّعه مفتاح المستودع (ExtensionEnginePlugin.installExtension).
 */
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
const reason = (error) => String(error?.message ?? error ?? "تعذر إكمال الطلب").replace(/https?:\/\/[^\s]+/gi, "[رابط]").slice(0, 240);
const host = (url) => { try { return new URL(url).host; } catch { return url; } };

/** يقرر ما يظهر وأي زر لكل إضافة. `filter`: 'arabic' (افتراضي) أو 'all'. */
export function extensionRows(list, { filter = "arabic", query = "" } = {}) {
  const q = query.trim().toLowerCase();
  const rows = [];
  let adult = 0;
  for (const ext of list) {
    if (ext.nsfw) { adult++; continue; }
    if (filter === "arabic" && !ext.arabic) continue;
    if (q && !`${ext.name} ${ext.pkg} ${(ext.sources ?? []).join(" ")}`.toLowerCase().includes(q)) continue;
    const state = ext.anime ? "anime" : ext.builtin ? "builtin" : ext.update ? "update" : ext.installed ? "installed" : "available";
    rows.push({ ext, state });
  }
  rows.sort((a, b) => ["update", "installed", "available", "builtin", "anime"].indexOf(a.state) - ["update", "installed", "available", "builtin", "anime"].indexOf(b.state) || a.ext.name.localeCompare(b.ext.name));
  return { rows, adult };
}

export function renderRepositories({ repositories, onSourcesChanged = () => {} }) {
  const root = node("section", "addon-repos");
  root.dir = "rtl";
  const head = node("div", "addon-repos-head");
  head.append(
    node("h3", null, "مستودعات المصادر"),
    node("p", "addon-muted", "أضف رابط مستودع إضافات مانجا (مثل Keiyoushi). تظهر مصادره هنا وتثبّت منها ما تريد، وتشتغل كأنها مدمجة."),
  );
  const form = node("form", "addon-repos-form");
  const input = node("input", "addon-input");
  input.type = "url"; input.dir = "ltr"; input.placeholder = "https://…/index.min.json"; input.setAttribute("aria-label", "رابط المستودع");
  input.autocomplete = "off"; input.spellcheck = false;
  const status = node("p", "addon-muted");
  status.setAttribute("role", "status");
  const add = button("أضف المستودع", () => {}, "addon-button addon-button-primary");
  add.type = "submit";
  form.append(input, add);
  const list = node("div", "addon-repos-list");
  root.append(head, form, status, list);

  let confirming = null;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const url = input.value.trim();
    if (!url) return;
    // أول مرة: تحذير الثقة وزر تأكيد، لا إضافة صامتة
    if (confirming !== url) {
      confirming = url;
      status.textContent = "إضافات المستودع كود يعمل داخل التطبيق. أضفه فقط إن كنت تثق بمن ينشره. اضغط «أضف المستودع» مرة ثانية للتأكيد.";
      add.textContent = "أثق به، أضفه";
      return;
    }
    confirming = null;
    add.textContent = "أضف المستودع";
    add.disabled = true;
    status.textContent = "جارٍ قراءة المستودع…";
    try {
      const { repo, count } = await repositories.add(url);
      input.value = "";
      status.textContent = `أُضيف ${repo.name}: ${count} إضافة.`;
      await paint(repo.url);
    } catch (error) {
      status.textContent = reason(error);
    } finally {
      add.disabled = false;
    }
  };

  async function paint(openUrl = null) {
    let data;
    try { data = await repositories.list(); }
    catch (error) { list.replaceChildren(node("p", "addon-error", reason(error))); return; }
    const repos = data?.repos ?? [];
    if (!repos.length) { list.replaceChildren(node("p", "addon-muted", "لا مستودعات بعد.")); return; }
    list.replaceChildren(...repos.map((repo) => repoCard(repo, repo.url === openUrl)));
  }

  function repoCard(repo, open) {
    const card = node("details", "addon-repo");
    card.open = open;
    const summary = node("summary", "addon-repo-summary");
    summary.append(node("strong", null, repo.name), node("span", "addon-muted", ` · ${host(repo.url)}`));
    const body = node("div", "addon-repo-body");
    const tools = node("div", "addon-repo-tools");
    const search = node("input", "addon-input");
    search.type = "search"; search.placeholder = "ابحث في الإضافات"; search.setAttribute("aria-label", "ابحث في الإضافات");
    let filter = "arabic";
    const toggle = button("الكل", () => { filter = filter === "arabic" ? "all" : "arabic"; toggle.textContent = filter === "arabic" ? "الكل" : "العربية فقط"; draw(); }, "addon-button");
    const remove = button("إزالة المستودع", async () => {
      remove.disabled = true;
      try { await repositories.remove(repo.url); onSourcesChanged(); await paint(); }
      catch (error) { remove.disabled = false; status.textContent = reason(error); }
    }, "addon-button addon-button-danger");
    tools.append(search, toggle, remove);
    const rowsBox = node("div", "addon-repo-rows");
    body.append(tools, rowsBox);
    card.append(summary, body);
    let extensions = null;
    const load = async () => {
      rowsBox.replaceChildren(node("p", "addon-muted", "جارٍ قراءة الإضافات…"));
      try { extensions = await repositories.extensions(repo.url); draw(); }
      catch (error) { rowsBox.replaceChildren(node("p", "addon-error", reason(error))); }
    };
    function draw() {
      if (!extensions) return;
      const { rows, adult } = extensionRows(extensions, { filter, query: search.value });
      const out = rows.slice(0, 200).map(({ ext, state }) => extensionRow(repo, ext, state, load));
      if (!rows.length) out.push(node("p", "addon-muted", filter === "arabic" ? "لا إضافات عربية هنا. اعرض «الكل»." : "لا نتائج."));
      if (adult) out.push(node("p", "addon-muted", `مخفية ${adult} إضافة للكبار.`));
      rowsBox.replaceChildren(...out);
    }
    search.oninput = draw;
    card.addEventListener("toggle", () => { if (card.open && !extensions) void load(); });
    if (open) void load();
    return card;
  }

  function extensionRow(repo, ext, state, reload) {
    const row = node("div", "addon-repo-row");
    row.dataset.state = state;
    const info = node("div", "addon-repo-info");
    info.append(node("strong", null, ext.name), node("span", "addon-muted", ` · ${(ext.sources ?? []).join("، ") || ext.lang} · ${ext.version}`));
    row.append(info);
    const note = (text) => row.append(node("span", "addon-chip addon-chip-muted", text));
    if (state === "builtin") note("مدمجة في التطبيق");
    else if (state === "anime") note("إضافة أنمي — غير مدعومة بعد");
    else {
      const run = async (action, label) => {
        for (const b of row.querySelectorAll("button")) b.disabled = true;
        const msg = node("span", "addon-muted", label);
        row.append(msg);
        try { await action(); onSourcesChanged(); await reload(); }
        catch (error) { msg.className = "addon-error"; msg.textContent = reason(error); for (const b of row.querySelectorAll("button")) b.disabled = false; }
      };
      if (state === "available" || state === "update")
        row.append(button(state === "update" ? "تحديث" : "تثبيت", () => run(() => repositories.install(repo.url, ext.pkg), "جارٍ التنزيل والتحقق…"), "addon-button addon-button-primary"));
      if (state === "installed" || state === "update")
        row.append(button("إزالة", () => run(() => repositories.uninstall(ext.pkg), "جارٍ الإزالة…"), "addon-button"));
    }
    return row;
  }

  void paint();
  return root;
}
