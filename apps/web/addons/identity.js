const stable = (v) =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable(v[k])]),
        )
      : v;
const cleanId = (v) =>
  typeof v === "string" || typeof v === "number" ? String(v) : null;
export function normalizeWork(raw, { addonKey, type }) {
  if (!raw || !["movie", "series", "anime", "manga"].includes(type))
    throw new Error("هوية عمل غير صالحة");
  const externalIds = {};
  const imdb =
    raw.externalIds?.imdb ??
    raw.imdb_id ??
    (["movie", "series"].includes(type) && /^tt\d+$/.test(raw.id ?? "")
      ? raw.id
      : null);
  if (/^tt\d+$/.test(imdb ?? "")) externalIds.imdb = imdb;
  for (const k of ["tmdb", "mal", "anilist", "mangadex"]) {
    const v = cleanId(raw.externalIds?.[k]);
    if (v && /^[a-zA-Z0-9-]+$/.test(v)) externalIds[k] = v;
  }
  const season = Number.isInteger(raw.season) ? raw.season : null,
    part = Number.isInteger(raw.part) ? raw.part : null;
  const chosen = ["imdb", "tmdb", "mal", "anilist", "mangadex"].find(
    (k) => externalIds[k],
  );
  const local = cleanId(raw.id ?? raw.url);
  if (!chosen && !local) throw new Error("الإضافة لم تُرجع معرف عمل");
  const ref = chosen
    ? `${chosen}:${externalIds[chosen]}`
    : `provider:${encodeURIComponent(addonKey)}:${encodeURIComponent(local)}`;
  return {
    ...raw,
    canonicalId: `${type}|${ref}|s${season ?? ""}|p${part ?? ""}`,
    externalIds,
    sourceCopies: [{ addonKey, id: local, type, season, part }],
    kind: type,
    season,
    part,
  };
}
export function chapterIdentity({
  canonicalMangaId,
  sourceId,
  sourceWorkId,
  chapterId,
  number,
  volume,
  memo,
}) {
  return JSON.stringify(
    stable([
      canonicalMangaId,
      sourceId,
      sourceWorkId,
      chapterId,
      number ?? null,
      volume ?? null,
      memo ?? null,
    ]),
  );
}
