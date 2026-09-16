/**
 * الفحص الخمسي الآلي لكل مصدر عربي.
 *
 * يجيب على السؤال الذي لا يجيب عليه عدد الإضافات: كم مصدرًا **يعمل**؟
 * لكل مصدر: POPULAR ثم SEARCH ثم CHAPTERS ثم صفحات أقدم فصل وأحدثه، ثم فكّ
 * ترميز الصور فعليًا بالـmagic bytes — لا ثقة بـContent-Type.
 *
 *   docker cp 05-probe-all-arabic.js uchiyomi:/tmp/
 *   docker exec uchiyomi node /tmp/05-probe-all-arabic.js > verdicts.json
 */
const SU = process.env.SUWAYOMI_URL || 'http://uchiyomi-suwayomi:4567';
const FALLBACK_QUERY = process.env.PROBE_QUERY || 'nano machine';
const STEP_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 45_000);

const gql = async (query, variables) => {
  const res = await fetch(`${SU}/api/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
  });
  return res.json();
};

const firstError = (payload) =>
  payload?.errors?.[0]?.message?.split('\n')[0]?.slice(0, 120) ?? null;

/** نفس منطق @vantara/domain: وجود نتائج ليس صلة. */
function looksRelevant(query, titles) {
  const norm = (s) =>
    s
      .toLowerCase()
      .replace(/[ً-ْ]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const needle = norm(query);
  if (!needle) return false;
  const terms = needle.split(' ').filter((t) => t.length >= 3);
  if (!terms.length) return titles.some((t) => norm(t).includes(needle));
  return titles.some((title) => terms.every((term) => norm(title).includes(term)));
}

function sniff(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'JPEG';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'PNG';
  if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP')
    return 'WEBP';
  if (buffer.slice(0, 4).toString().startsWith('GIF8')) return 'GIF';
  const head = buffer.slice(0, 256).toString('utf8').toLowerCase();
  if (head.includes('<html') || head.includes('<!doctype')) return 'HTML';
  return `UNKNOWN(${buffer.slice(0, 6).toString('hex')})`;
}

const step = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err).slice(0, 120) };
  }
};

async function fetchList(sourceId, type, query) {
  const payload = await gql(
    `mutation($i:FetchSourceMangaInput!){fetchSourceManga(input:$i){mangas{id title}}}`,
    { i: { source: sourceId, type, page: 1, ...(query ? { query } : {}) } },
  );
  const error = firstError(payload);
  if (error) return { ok: false, error };
  const mangas = payload.data.fetchSourceManga.mangas;
  return { ok: true, count: mangas.length, mangas };
}

async function probeSource(source) {
  const sourceId = source.id.replace(/^sw:/, '');
  // كل مصدر واستعلامه. مصدر عربي قد لا يطابق عنوانًا لاتينيًا مركّبًا، وفحصه
  // باستعلام واحد يصنّفه SEARCH_BROKEN وهو سليم — وهذا ما حدث في أول جولة.
  const QUERY = source.query || FALLBACK_QUERY;
  const out = {
    id: source.id,
    name: source.name,
    lang: source.lang,
    popular: { ok: false },
    search: { ok: false },
    chapters: { ok: false },
    pagesOldest: { ok: false },
    pagesNewest: { ok: false },
    imagesDecoded: { ok: false },
  };

  const popular = await step(() => fetchList(sourceId, 'POPULAR'));
  out.popular = popular.ok ? { ok: true, count: popular.count } : popular;

  const search = await step(() => fetchList(sourceId, 'SEARCH', QUERY));
  if (search.ok) {
    const titles = search.mangas.map((m) => m.title);
    out.search = { ok: true, count: search.count, relevant: looksRelevant(QUERY, titles) };
  } else {
    out.search = search;
  }

  // الاكتشاف للفصول: نتيجة البحث إن صلحت، وإلا أول عنصر من POPULAR.
  // هذا يسمح بتقييم مصدر بحثه معطوب لكنه سليم فيما عدا ذلك.
  const candidate =
    (out.search.ok && out.search.relevant && search.mangas[0]) ||
    (popular.ok && popular.mangas[0]) ||
    (search.ok && search.mangas[0]) ||
    null;

  if (!candidate) return out;
  out.probedWork = candidate.title;
  out.probeQuery = QUERY;

  const chapters = await step(async () => {
    const payload = await gql(
      `mutation($i:FetchChaptersInput!){fetchChapters(input:$i){chapters{id name chapterNumber}}}`,
      { i: { mangaId: candidate.id } },
    );
    const error = firstError(payload);
    if (error) return { ok: false, error };
    return { ok: true, chapters: payload.data.fetchChapters.chapters };
  });

  if (!chapters.ok) {
    out.chapters = chapters;
    return out;
  }
  const list = chapters.chapters;
  out.chapters = { ok: true, count: list.length };
  if (!list.length) {
    out.chapters = { ok: false, count: 0, error: 'no chapters returned' };
    return out;
  }

  const pagesOf = (chapter) =>
    step(async () => {
      const payload = await gql(
        `mutation($i:FetchChapterPagesInput!){fetchChapterPages(input:$i){pages}}`,
        { i: { chapterId: chapter.id } },
      );
      const error = firstError(payload);
      if (error) return { ok: false, error };
      const pages = payload.data.fetchChapterPages.pages;
      return { ok: pages.length > 0, count: pages.length, pages };
    });

  // الأقدم والأحدث: الفصل الأول قد يعمل والأحدث لا، وهذا ما يهم القارئ
  const oldest = await pagesOf(list[list.length - 1]);
  const newest = await pagesOf(list[0]);
  out.pagesOldest = { ok: oldest.ok, ...(oldest.count !== undefined ? { count: oldest.count } : {}), ...(oldest.error ? { error: oldest.error } : {}) };
  out.pagesNewest = { ok: newest.ok, ...(newest.count !== undefined ? { count: newest.count } : {}), ...(newest.error ? { error: newest.error } : {}) };

  const pageUrl = (oldest.ok && oldest.pages?.[0]) || (newest.ok && newest.pages?.[0]) || null;
  if (!pageUrl) return out;

  out.imagesDecoded = await step(async () => {
    const res = await fetch(SU + pageUrl, { signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
    const buffer = Buffer.from(await res.arrayBuffer());
    const type = sniff(buffer);
    const real = ['JPEG', 'PNG', 'WEBP', 'GIF'].includes(type);
    return real
      ? { ok: true, types: [type], bytes: buffer.length }
      : { ok: false, error: `not an image: ${type}`, bytes: buffer.length };
  });

  return out;
}

const CLOUDFLARE = ['cloudflare', 'flaresolverr', 'challenge'];

function verdictFrom(e) {
  const errors = [e.popular, e.search, e.chapters, e.pagesOldest, e.pagesNewest]
    .map((s) => s.error)
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  if (errors.some((err) => CLOUDFLARE.some((marker) => err.includes(marker))))
    return 'NEEDS_FLARESOLVERR';
  if (!e.popular.ok && !e.search.ok) return 'PARSER_FAILED';
  if (!(e.search.ok && e.search.relevant === true)) return 'SEARCH_BROKEN';
  if (!e.chapters.ok) return 'PARSER_FAILED';
  if (!e.pagesOldest.ok || !e.pagesNewest.ok) return 'PARSER_FAILED';
  if (!e.imagesDecoded.ok) return 'PARSER_FAILED';
  return 'SUPPORTED';
}

(async () => {
  const sources = JSON.parse(process.env.PROBE_SOURCES || '[]');
  const results = [];

  for (const source of sources) {
    const started = Date.now();
    const evidence = await probeSource(source);
    evidence.verdict = verdictFrom(evidence);
    evidence.elapsedMs = Date.now() - started;
    results.push(evidence);
    // تقدّم على stderr حتى يبقى stdout بيانات JSON نقية
    process.stderr.write(
      `${String(results.length).padStart(2)}/${String(sources.length)} ${evidence.verdict.padEnd(20)} ${source.name}\n`,
    );
  }

  process.stdout.write(JSON.stringify(results, null, 2));
})();
