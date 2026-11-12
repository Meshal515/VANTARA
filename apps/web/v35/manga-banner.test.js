import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isWideMangaArtwork } from './manga-work.js';

describe('manga profile banner', () => {
  it('recognizes genuine wide artwork, never treats portrait cover art as a wide banner', () => {
    expect(isWideMangaArtwork(1200, 500)).toBe(true);
    expect(isWideMangaArtwork(1200, 1000)).toBe(true);
    expect(isWideMangaArtwork(500, 1000)).toBe(false);
    expect(isWideMangaArtwork(1000, 1000)).toBe(false);
    expect(isWideMangaArtwork(1000, 900)).toBe(false);
  });

  it('rejects failed or incomplete image dimensions', () => {
    for (const size of [[0, 0], [400, 0], [NaN, 400], [-20, 100], [Infinity, 30]]) {
      expect(isWideMangaArtwork(...size)).toBe(false);
    }
  });

  it('crops fallback art across the banner without rendering an oversized portrait rectangle', () => {
    const css = readFileSync(new URL('./manga.css', import.meta.url), 'utf8');
    const fallback = css.match(/\.mw-ban--cover > img\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(fallback).toContain('object-fit: cover');
    expect(fallback).toContain('filter: none');
    expect(fallback).not.toContain('object-fit: contain');
    expect(fallback).not.toContain('blur(');
    expect(css).toMatch(/\.mw-ban--cover \.mw-ban-amb\s*\{\s*display: none;/);
    // The detailed poster stays its own size instead of inheriting banner treatment.
    expect(css).toMatch(/\.mw-idrow \.mw-cover\s*\{\s*flex: 0 0 112px;/);
  });
});
