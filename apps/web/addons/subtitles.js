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
/** كل الطلبات الممكنة لهذه الحلقة بالترتيب؛ المزوّد يجرّب التالي إن رجع الأول فارغًا. */
export function subtitleRequests(identity, stream = {}) {
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
    return [first, ...subtitleRequests({ ...identity, externalIds }, stream)];
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
export function subtitleRequest(identity, stream = {}) {
  return subtitleRequests(identity, stream)[0] ?? null;
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
      const requests = (p.requests ? p.requests(identity, stream) : p.request ? [p.request(identity, stream)] : subtitleRequests(identity, stream)).filter(Boolean).slice(0, 3);
      if (!requests.length) return [];
      return [{
      origin: p.origin ?? p.key,
      addonKey: p.key,
      run: async (signal) => {
        // معرّف لا يعرفه المزوّد يرجع فارغًا: نجرّب التالي (Kitsu ← IMDb بموسم TVDB ← المطلق)
        let result = [];
        for (const request of requests) {
          result = boundedItems(await p.subtitles({ ...request, signal }));
          if (result.length) break;
        }
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
function assCues(text) {
  let events = false, fields = null;
  const cues = [];
  const time = value => {
    const m = /^(\d{1,3}):(\d{2}):(\d{2})\.(\d{1,3})$/.exec(value.trim());
    if (!m || Number(m[2]) > 59 || Number(m[3]) > 59) return null;
    return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, '0'));
  };
  const stamp = ms => `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^\[[^\]]+\]$/.test(line)) { events = /^\[events\]$/i.test(line); fields = null; continue; }
    if (!events) continue;
    if (/^format\s*:/i.test(line)) { fields = line.slice(line.indexOf(':') + 1).split(',').map(s => s.trim().toLowerCase()); continue; }
    if (!fields || !/^dialogue\s*:/i.test(line) || fields.at(-1) !== 'text') continue;
    const startIndex = fields.indexOf('start'), endIndex = fields.indexOf('end');
    if (startIndex < 0 || endIndex < 0) continue;
    const columns = line.slice(line.indexOf(':') + 1).trimStart().split(',');
    if (columns.length < fields.length) continue;
    const start = time(columns[startIndex]), end = time(columns[endIndex]);
    if (start == null || end == null || end <= start) continue;
    const source = columns.slice(fields.length - 1).join(',');
    let drawing = false, body = '';
    for (const part of source.matchAll(/\{([^}]*)\}|([^{}]+)/g)) {
      if (part[1] !== undefined) {
        for (const command of part[1].matchAll(/\\(?:p(\d+)(?![0-9a-z])|r[^\\}]*)/gi)) drawing = command[1] !== undefined && Number(command[1]) > 0;
      } else if (!drawing) body += part[2];
    }
    body = safeText(body.replace(/\\[Nn]/g, '\n').replace(/\\h/g, '\u00a0')).trim();
    if (!body) continue;
    cues.push({start, value:`${stamp(start)} --> ${stamp(end)}\n${body}`});
    if (cues.length > 20000) throw new Error('عدد أسطر الترجمة أكبر من الحد');
  }
  return cues.sort((a, b) => a.start - b.start).map(c => c.value);
}
export function toWebVtt(text) {
  if (typeof text !== "string" || text.length > 2 * 1024 * 1024)
    throw new Error("ملف الترجمة أكبر من الحد");
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, '\n');
  if (/^\s*\[events\]\s*$/im.test(text)) {
    const converted = assCues(text);
    if (!converted.length) throw new Error('لا توجد أسطر ترجمة نصية صالحة');
    return 'WEBVTT\n\n' + converted.join('\n\n') + '\n';
  }
  const blocks = text
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
    throw new Error("لا توجد أسطر ترجمة صالحة");
  return "WEBVTT\n\n" + cues.join("\n\n") + "\n";
}
