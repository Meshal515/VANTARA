import { expect, it } from "vitest";
import { normalizeWork, chapterIdentity } from "./identity.js";
const normalize = (raw, type = "series", addonKey = "demo") =>
  normalizeWork(raw, { addonKey, type });
it("does not merge two providers by title alone", () =>
  expect(normalize({ id: "1", title: "Work" }).canonicalId).not.toBe(
    normalize({ id: "1", title: "Work" }, "series", "other").canonicalId,
  ));
it("uses explicit external IDs within type, season and part", () => {
  const raw = { id: "local", imdb_id: "tt1196946", season: 1, part: 1 };
  expect(normalize(raw).canonicalId).toBe(
    normalize({ ...raw, id: "other" }, "series", "other").canonicalId,
  );
  expect(normalize(raw).canonicalId).not.toBe(
    normalize(raw, "movie").canonicalId,
  );
  expect(normalize(raw).canonicalId).not.toBe(
    normalize({ ...raw, season: 2 }).canonicalId,
  );
  expect(normalize(raw).canonicalId).not.toBe(
    normalize({ ...raw, part: 2 }).canonicalId,
  );
});
it("does not infer IMDb mapping for anime from name or an arbitrary id", () => {
  expect(
    normalize({ id: "tt1196946", title: "Mentalist" }, "anime").externalIds
      .imdb,
  ).toBeUndefined();
});
it("isolates repeated chapter slugs by source work and memo without progress schema changes", () => {
  const c = {
    canonicalMangaId: "m1",
    sourceId: "s",
    sourceWorkId: "w1",
    chapterId: "chapter-1",
    number: 1,
  };
  expect(chapterIdentity(c)).not.toBe(
    chapterIdentity({ ...c, sourceWorkId: "w2" }),
  );
  expect(chapterIdentity(c)).not.toBe(
    chapterIdentity({ ...c, memo: { mangaPath: "/different" } }),
  );
});
