import { describe, expect, it } from 'vitest';
import type { ChapterCopy } from '@vantara/domain';
import * as library from '../routes/library.ts';

const first: ChapterCopy = {
  key: 'source-a:chapter-a',
  source: 'source-a',
  chosen: true,
  pages: 20,
};
const second: ChapterCopy = {
  key: 'source-b:chapter-b',
  source: 'source-b',
  pages: 18,
};

type FallbackOptions = {
  copies: ChapterCopy[];
  fetchCopy: (copy: ChapterCopy | null) => Promise<unknown>;
  verifyAvailable: (copy: ChapterCopy | null) => Promise<boolean>;
};
type FallbackResult = { chosen: string | null; attempts: number };
type FallbackFn = (options: FallbackOptions) => Promise<FallbackResult>;

function fallbackFn(): FallbackFn | null {
  const candidate = (library as Record<string, unknown>)['fetchChapterWithFallback'];
  return typeof candidate === 'function' ? (candidate as FallbackFn) : null;
}

describe('fetchChapterWithFallback', () => {
  it('automatically tries the next copy when the preferred source throws', async () => {
    const fetchChapterWithFallback = fallbackFn();
    expect(fetchChapterWithFallback).not.toBeNull();
    if (!fetchChapterWithFallback) return;

    const attempts: string[] = [];
    const result = await fetchChapterWithFallback({
      copies: [first, second],
      fetchCopy: async (copy) => {
        attempts.push(copy?.key ?? 'automatic');
        if (copy?.key === first.key) throw new Error('source down');
        return { queued: true };
      },
      verifyAvailable: async (copy) => copy?.key === second.key,
    });

    expect(attempts).toEqual([first.key, second.key]);
    expect(result.chosen).toBe(second.key);
    expect(result.attempts).toBe(2);
  });

  it('moves on when a fetch call succeeds but the requested chapter never appears', async () => {
    const fetchChapterWithFallback = fallbackFn();
    expect(fetchChapterWithFallback).not.toBeNull();
    if (!fetchChapterWithFallback) return;

    const attempts: string[] = [];
    const result = await fetchChapterWithFallback({
      copies: [first, second],
      fetchCopy: async (copy) => {
        attempts.push(copy?.key ?? 'automatic');
        return { queued: true };
      },
      verifyAvailable: async (copy) => copy?.key === second.key,
    });

    expect(attempts).toEqual([first.key, second.key]);
    expect(result.chosen).toBe(second.key);
  });

  it('uses upstream automatic selection once when no copy metadata exists', async () => {
    const fetchChapterWithFallback = fallbackFn();
    expect(fetchChapterWithFallback).not.toBeNull();
    if (!fetchChapterWithFallback) return;

    let calls = 0;
    const result = await fetchChapterWithFallback({
      copies: [],
      fetchCopy: async (copy) => {
        calls += 1;
        expect(copy).toBeNull();
        return { queued: true };
      },
      verifyAvailable: async () => true,
    });

    expect(calls).toBe(1);
    expect(result.chosen).toBeNull();
    expect(result.attempts).toBe(1);
  });

  it('fails with a stable user-facing code only after every known copy is exhausted', async () => {
    const fetchChapterWithFallback = fallbackFn();
    expect(fetchChapterWithFallback).not.toBeNull();
    if (!fetchChapterWithFallback) return;

    await expect(
      fetchChapterWithFallback({
        copies: [first, second],
        fetchCopy: async () => {
          throw new Error('down');
        },
        verifyAvailable: async () => false,
      }),
    ).rejects.toMatchObject({ code: 'chapter_unavailable', attempts: 2 });
  });
});
