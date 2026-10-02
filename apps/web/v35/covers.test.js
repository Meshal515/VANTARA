import { describe, expect, it } from 'vitest';
import { coverPreview } from './covers.js';

describe('coverPreview', () => {
  it('pairs a heavy Team-X cover with its light thumbnail', () => {
    expect(coverPreview('https://olympustaff.com/images/manga/b27aa95a.webp')).toBe('https://olympustaff.com/images/manga/thumbnail_b27aa95a.webp');
    expect(coverPreview('https://olympustaff.com/images/manga/thumbnail_b27aa95a.webp')).toBeNull();
    expect(coverPreview('https://uploads.mangadex.org/covers/x/y.jpg.512.jpg')).toBeNull();
    expect(coverPreview(null)).toBeNull();
  });
});
