/** Pure episode selection shared by the work page and its four visual layouts. */
const digits = value => String(value ?? '').replace(/[٠-٩۰-۹]/g, digit => {
  const code = digit.charCodeAt(0);
  return String(code >= 0x6f0 ? code - 0x6f0 : code - 0x660);
});
const integer = (value, fallback = 0) => {
  const number = Number(digits(value));
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
};

/**
 * فيلم واحد = صيغة MOVIE بلا أكثر من حلقة (#323 U-02). AniList يصنّف أعمالًا متعددة الحلقات MOVIE
 * (مثل «17-26»، 8 حلقات)، فكانت تُعرض «شاهد الفيلم» بلا قائمة حلقات.
 */
export const isSingleMovie = (m) => m?.format === 'MOVIE' && !(Number(m?.episodes) > 1);

/** Available episodes, distinct from an announced future season length. Movies have no list. */
export function episodeCount(m = {}) {
  if (isSingleMovie(m) || m.status === 'NOT_YET_RELEASED') return 0;
  const aired = integer(m.aired);
  if (aired) return aired;
  if (m.status === 'RELEASING' && m.next?.episode != null) return Math.max(0, integer(m.next.episode) - 1);
  if (m.status === 'RELEASING' && m.aired === 0) return 0;
  return integer(m.episodes);
}

/**
 * Filter and order first, then page. Only `numbers` should become episode rows.
 * `groups` describe those same filtered pages; labels are numeric and should render dir=ltr.
 * Null pageIndex follows currentEpisode; explicit pageIndex always wins and is clamped.
 */
export function episodePage({
  total = 0, pageSize = 25, pageIndex = null, currentEpisode = 1,
  query = '', newestFirst = false, hideSeen = false,
  titleOf = () => '', isSeen = () => false,
} = {}) {
  total = integer(total);
  pageSize = Math.max(1, integer(pageSize, 25) || 25);
  query = digits(query).trim().toLocaleLowerCase();
  const numericQuery = /^\d+$/.test(query) ? Number(query) : null;
  const matching = [];
  for (let n = 1; n <= total; n++) {
    if (hideSeen && isSeen(n)) continue;
    if (query && (numericQuery != null ? n !== numericQuery : !digits(titleOf(n)).toLocaleLowerCase().includes(query))) continue;
    matching.push(n);
  }
  if (newestFirst) matching.reverse();
  const pageCount = Math.ceil(matching.length / pageSize);
  const groups = [];
  for (let offset = 0; offset < matching.length; offset += pageSize) {
    const first = matching[offset];
    const last = matching[Math.min(matching.length - 1, offset + pageSize - 1)];
    const from = Math.min(first, last);
    const to = Math.max(first, last);
    groups.push({ index: groups.length, from, to, count: Math.min(pageSize, matching.length - offset), label: from === to ? String(from) : `${from}–${to}` });
  }
  const currentAt = matching.indexOf(integer(currentEpisode, 1));
  const chosen = pageIndex == null ? Math.max(0, Math.floor(currentAt / pageSize)) : integer(pageIndex);
  pageIndex = Math.min(chosen, Math.max(0, pageCount - 1));
  return {
    numbers: matching.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
    groups, pageIndex, pageCount, total, matchedCount: matching.length, pageSize, query,
  };
}

/** A bounded inclusive marking range; empty works never create episode zero marks. */
export function normalizeEpisodeRange(from, to, total) {
  total = integer(total);
  if (!total) return { from: 0, to: 0, count: 0 };
  const clamp = value => Math.max(1, Math.min(total, integer(value, 1)));
  const a = clamp(from);
  const b = clamp(to);
  return { from: Math.min(a, b), to: Math.max(a, b), count: Math.abs(a - b) + 1 };
}

/**
 * Read the existing watch shape without changing it or inferring playback from manual marks.
 * Account isSeen, when supplied, is authoritative over device-local done flags.
 */
export function resumeEpisode({ m = {}, watch = null, isSeen = null } = {}) {
  const movie = isSingleMovie(m);
  const episodes = watch?.episodes ?? {};
  const seen = isSeen ?? (n => Boolean(episodes[n]?.done));
  const base = { episode: 1, resume: false, completed: false, replay: false };
  const available = episodeCount(m);
  const knownEmpty = m.status === 'NOT_YET_RELEASED' || (m.status === 'RELEASING' && (m.aired === 0 || m.next?.episode === 1));
  const playback = n => Number(episodes[n]?.duration) > 0 || Number(episodes[n]?.position) > 0;
  let total = movie ? 1 : available;
  // Cards can open before any episode metadata arrives. Keep their real playback
  // pointer until the fetched detail supplies bounds; never create list rows here.
  if (!total && !knownEmpty) {
    total = integer(watch?.total);
    for (const key of Object.keys(episodes)) {
      const n = Number(key);
      if (Number.isInteger(n) && n > total && playback(n)) total = n;
    }
  }
  if (!total) return base;

  const credible = n => n >= 1 && n <= total && playback(n);
  let last = integer(watch?.episode);
  if (!credible(last)) {
    last = 0;
    let latest = -Infinity;
    for (const key of Object.keys(episodes)) {
      const n = Number(key);
      if (!Number.isInteger(n) || !credible(n)) continue;
      const at = Number(episodes[key]?.at) || 0;
      if (at > latest) { last = n; latest = at; }
    }
  }

  const unseen = [];
  for (let n = 1; n <= total; n++) if (!seen(n)) unseen.push(n);
  if (!unseen.length) {
    const continuing = !movie && (!available || m.status === 'RELEASING' || integer(m.episodes) > total || integer(m.next?.episode) > total);
    return { ...base, episode: continuing ? last || total : 1, completed: !continuing, replay: true };
  }
  if (!last) return { ...base, episode: unseen[0], resume: unseen[0] > 1 };
  if (!seen(last)) return { ...base, episode: last, resume: true, record: episodes[last] };
  return { ...base, episode: unseen.find(n => n > last) ?? unseen[0], resume: true };
}
