/**
 * VANTARA — Arabic source catalog audit with a statistical confidence target.
 *
 * Goal:
 *   1) enumerate the full catalog exposed by every Arabic source;
 *   2) count unique works, not just test one famous title;
 *   3) verify a deterministic, spread-out sample of works end-to-end;
 *   4) report an estimated readable-work count with a 99% confidence interval.
 *
 * Important: this intentionally does NOT open every chapter of every work. That would
 * hammer source sites and is unnecessary for a statistically reliable estimate.
 * It enumerates every work, then samples enough works to detect a >=1% failure rate
 * with 99% confidence when the sample has zero failures (459 samples).
 *
 * Input:
 *   PROBE_SOURCES='[{"id":"sw:...","name":"Azora","lang":"ar"}, ...]'
 *
 * Useful knobs:
 *   SUWAYOMI_URL=http://uchiyomi-suwayomi:4567
 *   AUDIT_CONFIDENCE=0.99
 *   AUDIT_MAX_FAILURE_RATE=0.01
 *   AUDIT_MAX_PAGES=2000
 *   AUDIT_DELAY_MS=250
 *   AUDIT_STEP_TIMEOUT_MS=45000
 *
 * Output: JSON to stdout. Progress goes to stderr.
 */

const SU = process.env.SUWAYOMI_URL || 'http://uchiyomi-suwayomi:4567';
const CONFIDENCE = Number(process.env.AUDIT_CONFIDENCE || 0.99);
const MAX_FAILURE_RATE = Number(process.env.AUDIT_MAX_FAILURE_RATE || 0.01);
const MAX_PAGES = Number(process.env.AUDIT_MAX_PAGES || 2000);
const DELAY_MS = Number(process.env.AUDIT_DELAY_MS || 250);
const STEP_TIMEOUT_MS = Number(process.env.AUDIT_STEP_TIMEOUT_MS || 45_000);

if (!(CONFIDENCE > 0 && CONFIDENCE < 1)) throw new Error('AUDIT_CONFIDENCE must be 0..1');
if (!(MAX_FAILURE_RATE > 0 && MAX_FAILURE_RATE < 1)) {
  throw new Error('AUDIT_MAX_FAILURE_RATE must be 0..1');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const gql = async (query, variables) => {
  const res = await fetch(`${SU}/api/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  if (body?.errors?.length) {
    throw new Error(String(body.errors[0]?.message || 'GraphQL error').split('\n')[0].slice(0, 220));
  }
  return body.data;
};

function sniff(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'JPEG';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'PNG';
  if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') {
    return 'WEBP';
  }
  if (buffer.slice(0, 4).toString().startsWith('GIF8')) return 'GIF';
  const head = buffer.slice(0, 512).toString('utf8').toLowerCase();
  if (head.includes('<html') || head.includes('<!doctype')) return 'HTML';
  return `UNKNOWN(${buffer.slice(0, 8).toString('hex')})`;
}

async function fetchCatalogPage(sourceId, page) {
  const data = await gql(
    `mutation($i:FetchSourceMangaInput!){fetchSourceManga(input:$i){mangas{id title}}}`,
    { i: { source: sourceId, type: 'POPULAR', page } },
  );
  return data.fetchSourceManga.mangas || [];
}

async function enumerateCatalog(sourceId) {
  const works = new Map();
  let stagnantPages = 0;
  let page = 1;

  for (; page <= MAX_PAGES; page++) {
    const mangas = await fetchCatalogPage(sourceId, page);
    if (!mangas.length) break;

    let added = 0;
    for (const manga of mangas) {
      if (!works.has(manga.id)) {
        works.set(manga.id, { id: manga.id, title: manga.title || '' });
        added++;
      }
    }

    // Some extensions repeat their last page forever. Two pages with zero new IDs
    // is a safer stop condition than trusting the extension to return an empty page.
    stagnantPages = added === 0 ? stagnantPages + 1 : 0;
    if (stagnantPages >= 2) break;

    await sleep(DELAY_MS);
  }

  return {
    works: [...works.values()],
    pagesVisited: page,
    hitMaxPages: page > MAX_PAGES,
  };
}

async function fetchChapters(mangaId) {
  const data = await gql(
    `mutation($i:FetchChaptersInput!){fetchChapters(input:$i){chapters{id name chapterNumber}}}`,
    { i: { mangaId } },
  );
  return data.fetchChapters.chapters || [];
}

async function fetchPages(chapterId) {
  const data = await gql(
    `mutation($i:FetchChapterPagesInput!){fetchChapterPages(input:$i){pages}}`,
    { i: { chapterId } },
  );
  return data.fetchChapterPages.pages || [];
}

async function validateImage(pageUrl) {
  const res = await fetch(SU + pageUrl, { signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
  const buffer = Buffer.from(await res.arrayBuffer());
  const type = sniff(buffer);
  return {
    ok: res.ok && ['JPEG', 'PNG', 'WEBP', 'GIF'].includes(type) && buffer.length > 256,
    status: res.status,
    type,
    bytes: buffer.length,
  };
}

// n such that observing zero failures rejects a true failure rate >= MAX_FAILURE_RATE
// at CONFIDENCE. For 99% / 1% this is 459.
function zeroFailureSampleSize() {
  return Math.ceil(Math.log(1 - CONFIDENCE) / Math.log(1 - MAX_FAILURE_RATE));
}

function deterministicSpreadSample(items, wanted) {
  if (wanted >= items.length) return items.map((item, index) => ({ item, index }));
  if (wanted <= 1) return [{ item: items[0], index: 0 }];

  const out = [];
  const used = new Set();
  for (let i = 0; i < wanted; i++) {
    const index = Math.round((i * (items.length - 1)) / (wanted - 1));
    if (!used.has(index)) {
      used.add(index);
      out.push({ item: items[index], index });
    }
  }
  return out;
}

function wilsonInterval(successes, n, z = 2.5758293035489004) {
  if (!n) return [0, 0];
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function oneSidedZeroFailureLowerBound(n) {
  if (!n) return 0;
  // If 0 failures are observed, the one-sided upper bound on failure probability is
  // 1 - alpha^(1/n), where alpha = 1-confidence.
  const failureUpper = 1 - Math.pow(1 - CONFIDENCE, 1 / n);
  return Math.max(0, 1 - failureUpper);
}

async function validateWork(work, sampleOrdinal) {
  try {
    const chapters = await fetchChapters(work.id);
    if (!chapters.length) {
      return { ok: false, title: work.title, reason: 'no_chapters' };
    }

    // Rotate oldest / middle / newest across the sample so failures tied to era are visible
    // without making 3x requests for every sampled work.
    const positions = [chapters.length - 1, Math.floor((chapters.length - 1) / 2), 0];
    const chapter = chapters[positions[sampleOrdinal % positions.length]];
    const pages = await fetchPages(chapter.id);
    if (!pages.length) {
      return {
        ok: false,
        title: work.title,
        chapter: chapter.name,
        chapterNumber: chapter.chapterNumber,
        reason: 'no_pages',
      };
    }

    const image = await validateImage(pages[0]);
    if (!image.ok) {
      return {
        ok: false,
        title: work.title,
        chapter: chapter.name,
        chapterNumber: chapter.chapterNumber,
        reason: 'invalid_image',
        image,
      };
    }

    return {
      ok: true,
      title: work.title,
      chapters: chapters.length,
      chapterNumber: chapter.chapterNumber,
      pages: pages.length,
      imageType: image.type,
    };
  } catch (error) {
    return {
      ok: false,
      title: work.title,
      reason: 'exception',
      error: String(error?.message || error).slice(0, 220),
    };
  }
}

async function auditSource(source) {
  const sourceId = source.id.replace(/^sw:/, '');
  const startedAt = new Date().toISOString();
  const started = Date.now();

  process.stderr.write(`\n[${source.name}] enumerating full catalog...\n`);
  let catalog;
  try {
    catalog = await enumerateCatalog(sourceId);
  } catch (error) {
    return {
      source,
      startedAt,
      elapsedMs: Date.now() - started,
      status: 'CATALOG_FAILED',
      error: String(error?.message || error).slice(0, 220),
    };
  }

  const total = catalog.works.length;
  if (!total) {
    return {
      source,
      startedAt,
      elapsedMs: Date.now() - started,
      status: 'NO_WORKS',
      catalog: { totalWorks: 0, pagesVisited: catalog.pagesVisited, hitMaxPages: catalog.hitMaxPages },
    };
  }

  const requiredForTarget = zeroFailureSampleSize();
  const sample = deterministicSpreadSample(catalog.works, Math.min(total, requiredForTarget));
  const checks = [];

  process.stderr.write(
    `[${source.name}] ${total} unique works; checking ${sample.length} spread across the catalog...\n`,
  );

  for (let i = 0; i < sample.length; i++) {
    const { item, index } = sample[i];
    const check = await validateWork(item, i);
    checks.push({ catalogIndex: index, ...check });

    if ((i + 1) % 25 === 0 || i + 1 === sample.length) {
      const failures = checks.filter((c) => !c.ok).length;
      process.stderr.write(
        `[${source.name}] ${i + 1}/${sample.length}; failures=${failures}\n`,
      );
    }
    await sleep(DELAY_MS);
  }

  const successes = checks.filter((c) => c.ok).length;
  const failures = checks.length - successes;
  const observed = successes / checks.length;
  const [wilsonLow, wilsonHigh] = wilsonInterval(successes, checks.length);
  const zeroFailureLower = failures === 0 ? oneSidedZeroFailureLowerBound(checks.length) : null;
  const conservativeLower = failures === 0 ? Math.max(wilsonLow, zeroFailureLower) : wilsonLow;

  return {
    source,
    startedAt,
    elapsedMs: Date.now() - started,
    status:
      failures === 0 && checks.length >= requiredForTarget && conservativeLower >= 1 - MAX_FAILURE_RATE
        ? 'VERIFIED_99'
        : failures === 0 && checks.length === total
          ? 'ALL_DISCOVERED_WORKS_SAMPLED_OK'
          : 'ESTIMATED',
    catalog: {
      totalWorks: total,
      pagesVisited: catalog.pagesVisited,
      hitMaxPages: catalog.hitMaxPages,
    },
    verification: {
      confidence: CONFIDENCE,
      targetMaxFailureRate: MAX_FAILURE_RATE,
      requiredZeroFailureSample: requiredForTarget,
      sampleSize: checks.length,
      successes,
      failures,
      observedReadableRate: observed,
      confidenceInterval99: [conservativeLower, wilsonHigh],
      estimatedReadableWorks: Math.round(total * observed),
      estimatedReadableWorks99Low: Math.floor(total * conservativeLower),
      estimatedReadableWorks99High: Math.ceil(total * wilsonHigh),
    },
    failures: checks.filter((c) => !c.ok).slice(0, 100),
  };
}

(async () => {
  const sources = JSON.parse(process.env.PROBE_SOURCES || '[]');
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('PROBE_SOURCES must be a non-empty JSON array');
  }

  const results = [];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    process.stderr.write(`\n=== ${i + 1}/${sources.length}: ${source.name} ===\n`);
    const result = await auditSource(source);
    results.push(result);
    await sleep(Math.max(DELAY_MS * 4, 1000));
  }

  const totals = results.reduce(
    (acc, result) => {
      const works = result.catalog?.totalWorks || 0;
      acc.discoveredWorks += works;
      if (result.verification) {
        acc.estimatedReadableWorks += result.verification.estimatedReadableWorks;
        acc.estimatedReadableWorks99Low += result.verification.estimatedReadableWorks99Low;
        acc.estimatedReadableWorks99High += result.verification.estimatedReadableWorks99High;
      }
      acc.byStatus[result.status] = (acc.byStatus[result.status] || 0) + 1;
      return acc;
    },
    {
      discoveredWorks: 0,
      estimatedReadableWorks: 0,
      estimatedReadableWorks99Low: 0,
      estimatedReadableWorks99High: 0,
      byStatus: {},
    },
  );

  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        method: {
          confidence: CONFIDENCE,
          targetMaxFailureRate: MAX_FAILURE_RATE,
          requiredZeroFailureSample: zeroFailureSampleSize(),
          note:
            'Every catalog entry is enumerated. Readability is estimated from a deterministic spread sample; the audit does not hammer every chapter/page of every work.',
        },
        totals,
        sources: results,
      },
      null,
      2,
    ),
  );
})();
