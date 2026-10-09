import { kitsuVideoRequest } from "./anime-mapping.js";
import { publicUrl } from "./manifest.js";
import { boundedItems } from "./contracts.js";
import { runProgressive } from "./scheduler.js";
export const language = (v) =>
  /^(ar|ara|arabic)(?:-|$)/i.test(v ?? "")
    ? "ar"
    : /^(en|eng|english)(?:-|$)/i.test(v ?? "")
      ? "en"
      : String(v ?? "und");
export function subtitleRequest(identity, stream = {}) {
  const imdb = identity?.externalIds?.imdb;
  const providerId = identity?.addonKey && typeof identity.videoId === "string" && identity.videoId.length <= 2000 && !/[\x00-\x1f]/.test(identity.videoId) ? identity.videoId : null;
  const kitsu = !providerId && kitsuVideoRequest(identity);
  if (!providerId && !kitsu && !/^tt\d+$/.test(imdb ?? "")) return null;
  const type =
    kitsu?.type ?? ((identity.kind === "movie" || identity.kind === "anime" && identity.format === "MOVIE")
      ? "movie"
      : ["series", "anime"].includes(identity.kind)
        ? "series"
        : null);
  if (!type) return null;
  if (
    !providerId && !kitsu && type === "series" &&
    (!Number.isInteger(identity.season) ||
      identity.season < 0 ||
      !Number.isInteger(identity.episode) ||
      identity.episode < 1)
  )
    return null;
  const extra = {};
  for (const key of ["filename", "videoHash", "videoSize"])
    if (stream[key] != null) extra[key] = stream[key];
  return {
    type,
    videoId:
      providerId ?? kitsu?.videoId ?? (type === "movie"
        ? imdb
        : `${imdb}:${identity.season}:${identity.episode}`),
    extra,
  };
}
export async function discoverSubtitles({
  identity,
  stream = {},
  providers,
  signal,
  onResult = () => {},
  onHealth = () => {},
}) {
  const input = subtitleRequest(identity, stream);
  if (!input) return;
  const seen = new Set();
  await runProgressive(
    providers.flatMap((p) => {
      const request = p.request ? p.request(identity, stream) : input;
      if (!request) return [];
      return [{
      origin: p.origin ?? p.key,
      addonKey: p.key,
      run: async (signal) => {
        const result = boundedItems(await p.subtitles({ ...request, signal }));
        onHealth(p.key, true);
        return { p, result };
      },
    }]; }),
    {
      signal,
      onError: (_error, job) => onHealth(job.addonKey, false),
      onResult: ({ p, result }) => {
        for (const [index, raw] of result.entries()) {
          try {
            const url = publicUrl(raw.url).href;
            if (seen.has(url)) continue;
            seen.add(url);
            const exact = Boolean(
              stream.filename &&
                raw.filename === stream.filename &&
                (!stream.duration ||
                  (Number.isFinite(raw.duration) &&
                    Math.abs(raw.duration - stream.duration) < 2)),
            );
            onResult({
              id: `${p.key}|sub|${index}`,
              kind: "addon",
              url,
              lang: language(raw.lang ?? raw.language),
              label: String(raw.label ?? raw.lang ?? "ترجمة"),
              provider: p.name ?? p.key,
              match: exact ? "release" : "episode",
              release: raw.filename ?? null,
            });
          } catch {
            /* نتيجة ليست ملف ترجمة عامًا */
          }
        }
      },
    },
  );
}
const safeText = (s) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
export function toWebVtt(text) {
  if (typeof text !== "string" || text.length > 2 * 1024 * 1024)
    throw new Error("ملف الترجمة أكبر من الحد");
  const blocks = text
      .replace(/^\uFEFF/, "")
      .replace(/\r/g, "")
      .split(/\n\s*\n/),
    cues = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const index = lines.findIndex((l) =>
      /^\s*(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->\s*(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}/.test(
        l,
      ),
    );
    if (index < 0) continue;
    const timing = lines[index]
      .replace(/,/g, ".")
      .match(
        /((?:\d{2}:)?\d{2}:\d{2}\.\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}\.\d{3})/,
      );
    const stamp = (s) => (s.split(":").length === 2 ? "00:" + s : s);
    const body = lines
      .slice(index + 1)
      .map(safeText)
      .join("\n");
    if (body.trim())
      cues.push(`${stamp(timing[1])} --> ${stamp(timing[2])}\n${body}`);
    if (cues.length > 20000) throw new Error("عدد أسطر الترجمة أكبر من الحد");
  }
  if (!cues.length)
    throw new Error("لا توجد ترجمة SRT/VTT صالحة؛ ASS غير مدعوم هنا");
  return "WEBVTT\n\n" + cues.join("\n\n") + "\n";
}
