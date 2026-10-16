import { expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { extensionRows, renderRepositories } from "./addons-repos.js";

const ext = (o) => ({ name: "X", pkg: "p", version: "1.4.1", lang: "ar", sources: ["X"], nsfw: false, anime: false, builtin: false, arabic: true, installed: null, update: false, ...o });
const tick = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

it("lists Arabic extensions first by state, hides adult ones, and explains what cannot be installed", () => {
  const list = [
    ext({ name: "Zeta", pkg: "a" }),
    ext({ name: "Alpha", pkg: "b", installed: "1.4.0", update: true }),
    ext({ name: "Built", pkg: "c", builtin: true }),
    ext({ name: "Anime", pkg: "d", anime: true }),
    ext({ name: "English", pkg: "e", lang: "en", arabic: false }),
    ext({ name: "Adult", pkg: "f", nsfw: true }),
  ];
  const { rows, adult } = extensionRows(list);
  expect(rows.map((r) => [r.ext.name, r.state])).toEqual([["Alpha", "update"], ["Zeta", "available"], ["Built", "builtin"], ["Anime", "anime"]]);
  expect(adult).toBe(1);
  expect(extensionRows(list, { filter: "all" }).rows.map((r) => r.ext.name)).toContain("English");
  expect(extensionRows(list, { query: "zet" }).rows.map((r) => r.ext.name)).toEqual(["Zeta"]);
});

it("adding a repository needs an explicit trust confirmation, then installing refreshes the app sources", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  let repos = [];
  const repositories = {
    list: vi.fn(async () => ({ repos })),
    add: vi.fn(async (url) => { repos = [{ url, name: "Keiyoushi" }]; return { repo: repos[0], count: 2 }; }),
    remove: vi.fn(),
    extensions: vi.fn(async () => [ext({ name: "3asq", pkg: "ar.3asq" })]),
    install: vi.fn(async () => ({ ids: ["ar.3asq#1"] })),
    uninstall: vi.fn(),
  };
  const onSourcesChanged = vi.fn();
  const view = renderRepositories({ repositories, onSourcesChanged });
  document.body.append(view);
  await tick();
  const input = view.querySelector("input[type=url]");
  const form = view.querySelector("form");
  input.value = "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json";
  await form.onsubmit({ preventDefault() {} });
  expect(repositories.add).not.toHaveBeenCalled();
  expect(view.textContent).toContain("أضفه فقط إن كنت تثق");
  await form.onsubmit({ preventDefault() {} });
  expect(repositories.add).toHaveBeenCalledOnce();
  await tick();
  const install = [...view.querySelectorAll("button")].find((b) => b.textContent === "تثبيت");
  expect(install).toBeTruthy();
  install.onclick();
  await tick();
  expect(repositories.install).toHaveBeenCalledWith("https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json", "ar.3asq");
  expect(onSourcesChanged).toHaveBeenCalled();
});
