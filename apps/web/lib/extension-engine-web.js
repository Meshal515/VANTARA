/**
 * Web fallback for ExtensionEngine plugin
 * Simulates extension engine for development/testing
 */

export class ExtensionEngineWeb {
  async testSource(options) {
    // Simulate a test run
    console.log('Extension Engine (Web fallback) - testSource:', options);

    return {
      success: true,
      baseUrl: options.baseUrl,
      chapterSpan: 'الأحدث: 2026-09-19 · الأقدم: 2024-01-01',
      imageFromChapter: 'Chapter 001',
      catalogueSample: {
        count: 123,
        sample: ['Manga 1', 'Manga 2', 'Manga 3'],
      },
      catalogueFull: {
        count: 1234,
        stopReason: 'time_budget',
      },
      hypotheses: [],
    };
  }

  async searchManga(options) {
    console.log('Extension Engine (Web fallback) - searchManga:', options);

    // Return mock results
    return {
      results: [
        {
          title: `Mock Result: ${options.query}`,
          url: 'https://example.com/manga/1',
          thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==',
        },
      ],
    };
  }

  async getChapters(options) {
    console.log('Extension Engine (Web fallback) - getChapters:', options);

    return {
      chapters: [
        {
          name: 'Chapter 001',
          url: 'https://example.com/chapter/1',
          dateUpload: 1695100800000,
          chapterNumber: 1,
        },
        {
          name: 'Chapter 002',
          url: 'https://example.com/chapter/2',
          dateUpload: 1695187200000,
          chapterNumber: 2,
        },
      ],
    };
  }

  async getPages(options) {
    console.log('Extension Engine (Web fallback) - getPages:', options);

    return {
      pages: [
        {
          imageUrl: 'https://example.com/page/1.jpg',
          url: 'https://example.com/page/1',
          pageNumber: 1,
        },
        {
          imageUrl: 'https://example.com/page/2.jpg',
          url: 'https://example.com/page/2',
          pageNumber: 2,
        },
      ],
    };
  }

  async getImage(options) {
    console.log('Extension Engine (Web fallback) - getImage:', options);

    // Return a 1x1 transparent PNG as base64
    return {
      imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==',
    };
  }
}
