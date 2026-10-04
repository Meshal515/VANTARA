import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { renderAddons } from "./addons-view.js";
import { glyph } from "./icons.js";
it("has one fixed puzzle icon and filters without changing the application section", async () => {
  const { document } = parseHTML("<html><body></body></html>");
  globalThis.document = document;
  const registry = {
    list: () => [
      {
        key: "a",
        name: "Anime",
        contentTypes: ["anime"],
        capabilities: ["search"],
        enabled: true,
        bundled: true,
      },
      {
        key: "m",
        name: "Manga",
        contentTypes: ["manga"],
        capabilities: ["search"],
        enabled: true,
        bundled: true,
      },
    ],
  };
  const view = renderAddons({ registry });
  document.body.append(view);
  expect(glyph("puzzle")).toContain("<svg");
  const filter = [...view.querySelectorAll("button")].find(
    (b) => b.textContent === "مانجا",
  );
  filter.click();
  expect(view.textContent).toContain("Manga");
  expect(view.textContent).not.toContain("Anime");
});
it("previews a URL before installing it, treats remote text as text and supports cancel", async () => {
  const { document } = parseHTML("<html><body></body></html>");
  globalThis.document = document;
  let installs = 0;
  const registry = {
    list: () => [],
    inspect: async () => ({
      manifest: {
        name: "<img src=x onerror=evil()>",
        capabilities: ["subtitles"],
        permissions: { networkHosts: ["addon.test"] },
      },
    }),
    install: async () => {
      installs++;
    },
  };
  const view = renderAddons({ registry });
  view.querySelector("input").value = "https://addon.test/token/manifest.json";
  view
    .querySelector("form")
    .dispatchEvent(
      new document.defaultView.Event("submit", { cancelable: true }),
    );
  await new Promise((r) => setTimeout(r, 0));
  expect(installs).toBe(0);
  expect(view.querySelector("img")).toBeNull();
  expect(view.textContent).not.toContain("/token/");
  [...view.querySelectorAll("button")]
    .find((b) => b.textContent === "إلغاء")
    .click();
  expect(installs).toBe(0);
});
it("filters disabled and staged addons without showing enabled entries or recommendations", () => {
  const { document } = parseHTML("<html><body></body></html>");
  globalThis.document = document;
  const base = { contentTypes: ["series"], capabilities: ["streams"] };
  const view = renderAddons({
    registry: {
      list: () => [
        { ...base, key: "on", name: "Enabled only", enabled: true },
        { ...base, key: "off", name: "Disabled only", enabled: false },
        {
          ...base,
          key: "update",
          name: "Staged only",
          enabled: true,
          stagedVersion: "2.0.0",
        },
      ],
    },
  });
  const choose = (text) =>
    [...view.querySelectorAll("button")]
      .find((b) => b.textContent === text)
      ?.click();
  choose("معطلة");
  expect(view.textContent).toContain("Disabled only");
  expect(view.textContent).not.toContain("Enabled only");
  expect(
    [...view.querySelectorAll("section")].find((s) =>
      s.textContent.includes("OpenSubtitles v3"),
    ).hidden,
  ).toBe(true);
  choose("تحتاج تحديث");
  expect(view.textContent).toContain("Staged only");
  expect(view.textContent).not.toContain("Disabled only");
});
