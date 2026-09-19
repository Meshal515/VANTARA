import { registerPlugin } from '@capacitor/core';

const ExtensionEngine = registerPlugin('ExtensionEngine', {
  web: () => import('./extension-engine-web.js').then(m => new m.ExtensionEngineWeb()),
});

export const extensions = {
  mangalek: {
    url: 'https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.mangalek-v1.4.65.apk',
    sha256: '3474d105c5e7192b65ce1efd82a932fdc057375282d70838ca9950a1b97fc5a1',
    baseUrl: 'https://mangalek.com',
    name: 'Mangalek',
    pkg: 'eu.kanade.tachiyomi.extension.ar.mangalek',
  },
  mangaspark: {
    url: 'https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.mangaspark-v1.4.60.apk',
    sha256: '1912b552e3c1777c8ee797d7024ecffbc55108a14f883d16fdddca8074bceec3',
    baseUrl: 'https://mangaspark.com',
    name: 'MangaSpark',
    pkg: 'eu.kanade.tachiyomi.extension.ar.mangaspark',
  },
  azora: {
    url: 'https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.azora-v1.6.73.apk',
    sha256: '34c01978ce98c809ac47168ebb37b4c5abd14cc4fba10d15aa3c3103c5f668f0',
    baseUrl: 'https://www.azora.top',
    name: 'Azora',
    pkg: 'eu.kanade.tachiyomi.extension.ar.azora',
  },
  mangaswat: {
    url: 'https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.mangaswat-v1.6.61.apk',
    sha256: 'a9d1cca2acd447d581fe6e1a00db68d352746eb18bab931077b2dd60b976917e',
    baseUrl: 'https://mangaswat.com',
    name: 'MangaSwat',
    pkg: 'eu.kanade.tachiyomi.extension.ar.mangaswat',
  },
  teamx: {
    url: 'https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.teamx-v1.6.33.apk',
    sha256: '57292720171427ad511b53116e3f1b183185973ee961fd1bde19353d36d9d335',
    baseUrl: 'https://teamx.info',
    name: 'Team X',
    pkg: 'eu.kanade.tachiyomi.extension.ar.teamx',
  },
};

/**
 * Test if an extension source works
 * Returns {success, baseUrl, chapterSpan, imageFromChapter, catalogueSample, catalogueFull}
 */
export async function testSource(sourceName) {
  const source = extensions[sourceName];
  if (!source) throw new Error(`Unknown source: ${sourceName}`);

  return ExtensionEngine.testSource({
    sourceUrl: source.url,
    sourceSha256: source.sha256,
    baseUrl: source.baseUrl,
  });
}

/**
 * Search for manga in a specific source
 * Returns array of {title, url, thumbnail}
 */
export async function searchManga(sourceName, query) {
  const source = extensions[sourceName];
  if (!source) throw new Error(`Unknown source: ${sourceName}`);

  const result = await ExtensionEngine.searchManga({
    sourceUrl: source.url,
    sourceSha256: source.sha256,
    baseUrl: source.baseUrl,
    query,
  });

  return result.results || [];
}

/**
 * Get chapters for a manga
 * Returns array of {name, url, dateUpload, chapterNumber}
 */
export async function getChapters(sourceName, mangaUrl) {
  const source = extensions[sourceName];
  if (!source) throw new Error(`Unknown source: ${sourceName}`);

  const result = await ExtensionEngine.getChapters({
    sourceUrl: source.url,
    sourceSha256: source.sha256,
    baseUrl: source.baseUrl,
    mangaUrl,
  });

  return result.chapters || [];
}

/**
 * Get pages for a chapter
 * Returns array of {imageUrl, url, pageNumber}
 */
export async function getPages(sourceName, chapterUrl) {
  const source = extensions[sourceName];
  if (!source) throw new Error(`Unknown source: ${sourceName}`);

  const result = await ExtensionEngine.getPages({
    sourceUrl: source.url,
    sourceSha256: source.sha256,
    baseUrl: source.baseUrl,
    chapterUrl,
  });

  return result.pages || [];
}

/**
 * Get image data (base64)
 * Returns {imageBase64}
 */
export async function getImage(sourceName, imageUrl) {
  const source = extensions[sourceName];
  if (!source) throw new Error(`Unknown source: ${sourceName}`);

  const result = await ExtensionEngine.getImage({
    sourceUrl: source.url,
    sourceSha256: source.sha256,
    baseUrl: source.baseUrl,
    imageUrl,
  });

  return result.imageBase64;
}

/**
 * Get all available extension sources
 */
export function getAvailableSources() {
  return Object.entries(extensions).map(([key, ext]) => ({
    id: key,
    name: ext.name,
    baseUrl: ext.baseUrl,
  }));
}

export default {
  ExtensionEngine,
  extensions,
  testSource,
  searchManga,
  getChapters,
  getPages,
  getImage,
  getAvailableSources,
};
