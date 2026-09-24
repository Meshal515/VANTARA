import { describe, expect, it } from 'vitest';
import { handleTranslateCached, handleTranslatePage, SYSTEM_PROMPT } from './translate.ts';
import { sqliteEnv } from './test-d1.ts';

const A = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const B = 'bedcf897-a6f0-4730-b757-402b14891ca5';
const hash = (c: string) => c.repeat(64).slice(0, 64);

function testEnv(extra: Record<string, string> = {}) {
  return sqliteEnv({
    VANTARA_SESSION_SECRET: 'translate-secret-that-is-at-least-32-characters',
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
    OPENAI_API_KEY: 'test-key',
    ...extra,
  });
}

interface Call {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}

/** OpenAI مزيّف (Responses API): يسجّل كل طلب ويردّ بما نعطيه. */
function fakeGpt(answer: (body: Record<string, unknown>) => unknown, mode: 'ok' | 'refusal' = 'ok') {
  const calls: Call[] = [];
  const fake: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(input), body, headers: new Headers(init?.headers) });
    const content = mode === 'refusal' ? [{ type: 'refusal', refusal: 'no' }] : [{ type: 'output_text', text: JSON.stringify(answer(body)) }];
    return new Response(
      JSON.stringify({ id: `resp_${calls.length}`, model: 'gpt-6-luna', status: 'completed', output: [{ type: 'message', content }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return { fetch: fake, calls };
}
const first = (calls: Call[]): Call => {
  const call = calls[0];
  if (!call) throw new Error('model was not called');
  return call;
};
const promptOf = (call: Call) => {
  const input = call.body.input as Array<{ content: Array<{ type: string; text?: string }> }>;
  return input[0]?.content.find((c) => c.type === 'input_text')?.text ?? '';
};

const page = (over: Record<string, unknown> = {}) =>
  new Request('https://sync.test/v1/translate/page', {
    method: 'POST',
    body: JSON.stringify({
      pageHash: hash('a'),
      seriesRef: 'ext:solo leveling',
      seriesTitle: 'Solo Leveling',
      chapterKey: 'ext:solo leveling#n:23',
      chapterNumber: 23,
      pageIndex: 0,
      sourceLang: 'en',
      image: { mediaType: 'image/jpeg', data: 'AAAA', width: 800, height: 1200 },
      ...over,
    }),
  });

const firstPage = {
  regions: [
    { x: 100, y: 80, w: 200, h: 90, kind: 'speech', speaker: 'Jinwoo', source: "I'm not weak anymore.", arabic: 'لم أعد ضعيفًا.' },
    { x: 500, y: 700, w: 900, h: 9000, kind: 'sfx', speaker: null, source: 'BOOM', arabic: 'بوم' },
    { x: 10, y: 1150, w: 120, h: 30, kind: 'credit', speaker: null, source: 'scans by X', arabic: null },
  ],
  new_terms: [{ term: 'Shadow Monarch', arabic: 'ملك الظلال', kind: 'title', note: null }],
  characters: [{ name: 'Jinwoo', arabic: 'جينوو', gender: 'male' }],
  summary: 'جينوو يواجه الوحش بثقة جديدة.',
};

describe('translation engine (server)', () => {
  it('translates once with GPT-6 Luna: team prompt first (cached prefix), image at original detail, strict schema', async () => {
    const { env } = testEnv();
    const gpt = fakeGpt(() => firstPage);
    const res = await handleTranslatePage(page(), env, A, Date.UTC(2026, 8, 24), { fetch: gpt.fetch });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { cached: boolean; regions: Array<Record<string, unknown>> };
    expect(out.cached).toBe(false);

    const { url, body, headers } = first(gpt.calls);
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(headers.get('authorization')).toBe('Bearer test-key');
    expect(body.model).toBe('gpt-6-luna');
    expect(body.instructions).toBe(SYSTEM_PROMPT);
    expect(body.store).toBe(false);
    expect(body.reasoning).toEqual({ effort: 'medium' });
    expect(body.text).toMatchObject({ format: { type: 'json_schema', name: 'page_translation', strict: true } });
    const content = (body.input as Array<{ content: Array<Record<string, unknown>> }>)[0]?.content ?? [];
    expect(content[0]).toEqual({ type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA', detail: 'original' });

    // المؤثرات والحقوق بلا عربي، والصندوق داخل الصورة
    expect(out.regions[0]).toMatchObject({ kind: 'speech', arabic: 'لم أعد ضعيفًا.', speaker: 'Jinwoo' });
    expect(out.regions[1]).toMatchObject({ kind: 'sfx', arabic: null, x: 500, w: 300, h: 500 });
    expect(out.regions[2]).toMatchObject({ kind: 'credit', arabic: null });
  });

  it('a page translated once is free for everyone after: same hash, no model call', async () => {
    const { env } = testEnv();
    await handleTranslatePage(page(), env, A, 1, { fetch: fakeGpt(() => firstPage).fetch });
    const second = fakeGpt(() => firstPage);
    const res = await handleTranslatePage(page(), env, B, 2, { fetch: second.fetch });
    expect(((await res.json()) as { cached: boolean }).cached).toBe(true);
    expect(second.calls).toHaveLength(0);

    const cached = await handleTranslateCached(new URL(`https://sync.test/v1/translate/cached?hashes=${hash('a')},${hash('b')}`), env);
    const pages = ((await cached.json()) as { pages: Record<string, unknown> }).pages;
    expect(Object.keys(pages)).toEqual([hash('a')]);
  });

  it('the next page is translated with the glossary, characters, story so far and last lines; the first decision sticks', async () => {
    const { env, db } = testEnv();
    await handleTranslatePage(page(), env, A, 1, { fetch: fakeGpt(() => firstPage).fetch });
    const next = fakeGpt(() => ({
      regions: [{ x: 1, y: 1, w: 10, h: 10, kind: 'speech', speaker: 'Jinwoo', source: 'Arise.', arabic: 'انهض.' }],
      new_terms: [{ term: 'Shadow Monarch', arabic: 'عاهل الظل', kind: 'title', note: null }],
      characters: [],
      summary: 'يستدعي جيشه.',
    }));
    await handleTranslatePage(page({ pageHash: hash('b'), pageIndex: 1 }), env, A, 2, { fetch: next.fetch });
    const prompt = promptOf(first(next.calls));
    expect(prompt).toContain('Shadow Monarch → ملك الظلال');
    expect(prompt).toContain('Jinwoo → جينوو, male');
    expect(prompt).toContain('جينوو يواجه الوحش بثقة جديدة.');
    expect(prompt).toContain('Jinwoo: لم أعد ضعيفًا.');
    // الترجمة الثانية للمصطلح لا تغيّر الأولى
    expect(db.prepare("SELECT arabic FROM translation_terms WHERE term = 'Shadow Monarch'").get()).toEqual({ arabic: 'ملك الظلال' });
  });

  it('no key: 503 and nothing is stored; the daily limit stops paid calls but not cached pages', async () => {
    const noKey = testEnv({ OPENAI_API_KEY: '' });
    const res = await handleTranslatePage(page(), noKey.env, A, 1, { fetch: fakeGpt(() => firstPage).fetch });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('translation_not_configured');

    const { env } = testEnv({ TRANSLATE_DAILY_PAGES: '1' });
    await handleTranslatePage(page(), env, A, 1, { fetch: fakeGpt(() => firstPage).fetch });
    const over = await handleTranslatePage(page({ pageHash: hash('c') }), env, A, 2, { fetch: fakeGpt(() => firstPage).fetch });
    expect(over.status).toBe(429);
    const again = await handleTranslatePage(page(), env, A, 3, { fetch: fakeGpt(() => firstPage).fetch });
    expect(again.status).toBe(200);
  });

  it('a refusal or a broken image is an error, never a stored empty translation', async () => {
    const { env, db } = testEnv();
    const refused = await handleTranslatePage(page(), env, A, 1, { fetch: fakeGpt(() => ({}), 'refusal').fetch });
    expect(refused.status).toBe(422);
    const huge = await handleTranslatePage(page({ image: { mediaType: 'image/jpeg', data: 'AAAA', width: 800, height: 9000 } }), env, A, 1, { fetch: fakeGpt(() => firstPage).fetch });
    expect(huge.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM translation_pages').get()).toEqual({ n: 0 });
  });
});
