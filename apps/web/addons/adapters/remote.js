import { boundedItems } from "../contracts.js";
import { normalizeStreams } from "../streams.js";
import { publicUrl } from "../manifest.js";
export function createRemoteAdapter({ manifest, transport }) {
  async function request(cap, input = {}, signal) {
    if (!manifest.capabilities.includes(cap) || !manifest.resources[cap])
      throw new Error("هذه القدرة غير مدعومة من الإضافة");
    const path = manifest.resources[cap].replace(
      /\{(workId|chapterId|page|query)\}/g,
      (_, k) => encodeURIComponent(String(input[k] ?? "")),
    );
    const u = publicUrl(new URL(path, manifest.baseUrl).href);
    if (u.origin !== new URL(manifest.baseUrl).origin)
      throw new Error("مضيف غير مسموح");
    const result = await transport.json(u.href, {
      signal,
      timeout: ["streams"].includes(cap)
        ? 45000
        : ["subtitles"].includes(cap)
          ? 15000
          : 30000,
    });
    for (const field of [
      "mangas",
      "items",
      "chapters",
      "pages",
      "episodes",
      "streams",
      "subtitles",
    ])
      if (result[field] != null) boundedItems(result[field]);
    return result;
  }
  const id = (x) => x?.id ?? x?.url;
  return {
    request,
    async search(query, page = 1, { signal } = {}) {
      const out = await request("search", { query, page }, signal);
      if (out.mangas) boundedItems(out.mangas);
      else boundedItems(out.items);
      return out;
    },
    async home(page = 1, { signal } = {}) {
      return request("home", { page }, signal);
    },
    async series(work, { signal } = {}) {
      const out = await request("details", { workId: id(work) }, signal);
      if (!out.chapters && manifest.capabilities.includes("chapters"))
        out.chapters = boundedItems(
          (await request("chapters", { workId: id(work) }, signal)).chapters,
        );
      if (out.chapters)
        out.chapters = out.chapters.map((c) => ({
          ...c,
          memo: JSON.stringify({
            addonWorkId: id(work),
            providerMemo: c.memo ?? null,
          }),
        }));
      return out;
    },
    async pages(chapter, { signal } = {}) {
      let workId;
      try {
        workId = JSON.parse(chapter.memo)?.addonWorkId;
      } catch {}
      return boundedItems(
        (await request("pages", { workId, chapterId: id(chapter) }, signal))
          .pages,
      );
    },
    async episodes(work, { signal } = {}) {
      return boundedItems(
        (await request("episodes", { workId: id(work) }, signal)).episodes,
      ).filter(e => work.requestedSeason == null || e.season == null || Number(e.season) === Number(work.requestedSeason));
    },
    async streams(server, onResult, { signal } = {}) {
      const out = normalizeStreams(
        (await request("streams", { workId: id(server) }, signal)).streams,
        { addonKey: manifest.key },
      );
      onResult?.(out);
      return out;
    },
    async subtitles(input, { signal = input.signal } = {}) {
      return boundedItems(
        (await request("subtitles", input, signal)).subtitles,
      );
    },
  };
}
