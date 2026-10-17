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
/**
 * عنوان حلقة الأنمي في IMDb من خريطة ani.zip (رقم الحلقة عندنا ← [الموسم، رقمها فيه، المطلق]).
 * الأنمي يُرقَّم داخل عمله (الجزء الثاني يبدأ من 1 أو يكمل من 13، وOne Piece مطلق حتى 1100+)،
 * وإضافات الترجمة تعرف الحلقة بـIMDb + الموسم + رقمها فيه. حلقة لم تصل الخريطة بعد (أنمي يُعرض الآن)
 * تكمل من آخر حلقة معروفة قبلها في العمل نفسه. يرجع العناوين بالترتيب: موسم TVDB ثم الترقيم المطلق
 * في الموسم 1 (OpenSubtitles يفهرس One Piece وNaruto Shippuden هكذا).
 */
export function animeImdbAddresses(map, episode) {
  const n = Number(episode);
  if (!map || typeof map !== "object" || !Number.isInteger(n) || n < 1) return [];
  const valid = (v) => Array.isArray(v) && Number.isInteger(v[0]) && v[0] >= 0 && Number.isInteger(v[1]) && v[1] > 0;
  let hit = valid(map[n]) ? map[n] : null;
  if (!hit) {
    let k = 0;
    for (const key of Object.keys(map)) { const m = Number(key); if (Number.isInteger(m) && m < n && m > k && valid(map[key])) k = m; }
    if (k && n - k <= 30) { const [s, e, a] = map[k]; hit = [s, e + n - k, Number.isInteger(a) ? a + n - k : null]; }
  }
  if (!hit) return [];
  const [season, number, absolute] = hit;
  const out = [[season, number]];
  if (Number.isInteger(absolute) && absolute > 0 && !(season === 1 && number === absolute)) out.push([1, absolute]);
  return out;
}
/** طلبات عمل واحد بهويته كما هي (المعرّف الخاص إن وُجد، ثم Kitsu، ثم IMDb بعناوينه). */
function requestsFor(identity, stream = {}) {
  const imdb = identity?.externalIds?.imdb;
  const providerId = identity?.addonKey && typeof identity.videoId === "string" && identity.videoId.length <= 2000 && !/[\x00-\x1f]/.test(identity.videoId) ? identity.videoId : null;
  const kitsu = !providerId && kitsuVideoRequest(identity);
  const extra = {};
  for (const key of ["filename", "videoHash", "videoSize"])
    if (stream?.[key] != null) extra[key] = stream[key];
  if (providerId || kitsu) {
    const type = kitsu?.type ?? ((identity.kind === "movie" || identity.kind === "anime" && identity.format === "MOVIE") ? "movie" : ["series", "anime"].includes(identity.kind) ? "series" : null);
    if (!type) return [];
    const first = { type, videoId: providerId ?? kitsu.videoId, extra };
    // Kitsu لإضافات تعرفه، وIMDb بعده لإضافات لا تعرف إلا tt (OpenSubtitles)
    if (providerId) return [first];
    const { kitsu: _k, ...externalIds } = identity.externalIds ?? {};
    return [first, ...requestsFor({ ...identity, externalIds }, stream)];
  }
  if (!/^tt\d+$/.test(imdb ?? "")) return [];
  const type =
    (identity.kind === "movie" || identity.kind === "anime" && identity.format === "MOVIE")
      ? "movie"
      : ["series", "anime"].includes(identity.kind)
        ? "series"
        : null;
  if (!type) return [];
  if (type === "movie") return [{ type, videoId: imdb, extra }];
  if (!Number.isInteger(identity.episode) || identity.episode < 1) return [];
  const mapped = identity.kind === "anime" ? animeImdbAddresses(identity.imdbEpisodes, identity.episode) : [];
  const addresses = mapped.length ? mapped
    : Number.isInteger(identity.season) && identity.season >= 0 ? [[identity.season, identity.episode]] : [];
  return addresses.map(([season, episode]) => ({ type, videoId: `${imdb}:${season}:${episode}`, extra }));
}
/**
 * كل الطلبات الممكنة لهذه الحلقة عند مزوّد بعينه، بالترتيب؛ المزوّد يجرّب التالي إن رجع الأول فارغًا.
 * المعرّف الخاص بإضافة (videoId) لا يُرسل إلا لتلك الإضافة نفسها؛ لغيرها البدائل العامة وحدها
 * (Kitsu ثم IMDb بموسم TVDB ثم المطلق)، فلا يوسّع ترشيح النطاق الثقةَ بمعرّف خاص.
 */
export function subtitleRequests(identity, stream = {}, addonKey = null) {
  const canonical = { ...identity, addonKey: null, videoId: null };
  const requests = [
    ...(addonKey && addonKey === identity?.addonKey ? requestsFor(identity, stream) : []),
    ...requestsFor(canonical, stream),
  ];
  return requests.filter((request, index) => requests.findIndex((other) => other.type === request.type && other.videoId === request.videoId) === index);
}
export function subtitleRequest(identity, stream = {}) {
  return subtitleRequests(identity, stream, identity?.addonKey)[0] ?? null;
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
      const requests = (p.requests ? p.requests(identity, stream) : p.request ? [p.request(identity, stream)] : subtitleRequests(identity, stream, p.key)).filter(Boolean).slice(0, 3);
      if (!requests.length) return [];
      return [{
      origin: p.origin ?? p.key,
      addonKey: p.key,
      run: async (signal) => {
        // معرّف لا يعرفه المزوّد يرجع فارغًا: نجرّب التالي (Kitsu ← IMDb بموسم TVDB ← المطلق)
        let result = [];
        for (const request of requests) {
          result = boundedItems(await p.subtitles({ ...request, signal }));
          if (result.length || signal?.aborted) break;
        }
        // أُلغي البحث والناقل تجاهل الإلغاء: لا صحة تُسجَّل
        if (!signal?.aborted) onHealth(p.key, true);
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
