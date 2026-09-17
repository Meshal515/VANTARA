import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as domain from '@vantara/domain';
import * as library from './library.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

describe('B6 source and chapter contract', () => {
  it('exposes a stable user-facing source contract instead of raw verdict jargon', () => {
    const toPublicSource = (domain as Record<string, unknown>)['toPublicSource'];
    expect(typeof toPublicSource).toBe('function');
    if (typeof toPublicSource !== 'function') return;

    const source = toPublicSource({
      id: 'arabic-source',
      name: 'Arabic Source',
      lang: 'ar',
      verdict: 'SUPPORTED',
    }) as Record<string, unknown>;

    expect(source).toEqual({
      id: 'arabic-source',
      name: 'Arabic Source',
      language: 'ar',
      health: 'healthy',
      capabilities: { search: true, read: true },
    });
    expect(source).not.toHaveProperty('verdict');
  });

  it('keys the web source map by the API contract id', async () => {
    const web = await readFile(join(ROOT, 'apps/web/app.js'), 'utf8');
    expect(web).toContain('state.sources.set(source.id, source)');
    expect(web).not.toContain('state.sources.set(source.sourceId, source)');
  });

  it('keeps chapter fallback in a server-side testable function', () => {
    const fetchChapterWithFallback = (library as Record<string, unknown>)[
      'fetchChapterWithFallback'
    ];
    expect(typeof fetchChapterWithFallback).toBe('function');
  });
});
