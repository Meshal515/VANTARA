import { describe, expect, it } from 'vitest';
import { cleanTextRegionsIn, cleanTextRegionsOut, handleTranslateText, TEXT_SYSTEM_PROMPT, textEngineOf } from './translate.ts';
import { sqliteEnv } from './test-d1.ts';

/**
 * `POST /v1/translate/text` — خط الرؤية: النصوص تأتي بمعرّفات من عامل جهاز
 * البيت، وLuna تردّ بالمعرّف. لا إحداثيات تخرج من النموذج.
 */

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
  body: Record<string, unknown>;
}

function fakeGpt(answer: (body: Record<string, unknown>) => unknown) {
  const calls: Call[] = [];
  const fake: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ body });
    return new Response(
      JSON.stringify({
        id: `resp_${calls.length}`,
        model: 'gpt-6-luna',
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer(body)) }] }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return { fetch: fake, calls };
}

const promptOf = (call: Call) => {
  const input = call.body.input as Array<{ content: Array<{ type: string; text?: string }> }>;
  return input[0]?.content.find((c) => c.type === 'input_text')?.text ?? '';
};

const regionsIn = [
  { id: 'r1a2b3c4d', source: 'ONLY OUR MAGICIAN KNOWS THE TRUTH.', kind: 'speech', box: [172, 613, 513, 763] },
  { id: 'rdeadbeef', source: 'CLANG', kind: 'sfx', box: [13, 1911, 295, 2038] },
];

const req = (over: Record<string, unknown> = {}) =>
  new Request('https://sync.test/v1/translate/text', {
    method: 'POST',
    body: JSON.stringify({
      pageHash: hash('a'),
      seriesRef: 'ext:wizardly tower',
      seriesTitle: 'Wizardly Tower',
      chapterKey: 'ext:wizardly tower#n:5',
      chapterNumber: 5,
      pageIndex: 3,
      sourceLang: 'en',
      image: { mediaType: 'image/jpeg', data: 'AAAA', width: 1080, height: 2316 },
      regions: regionsIn,
      ...over,
    }),
  });

const answer = {
  regions: [
    { id: 'r1a2b3c4d', source: 'ONLY OUR MAGICIAN KNOWS THE TRUTH.', kind: 'speech', arabic: 'ساحرنا وحده يعرف الحقيقة.', speaker: 'Yuria' },
    { id: 'rdeadbeef', source: 'CLANG', kind: 'sfx', arabic: 'كلانغ', speaker: null },
    { id: 'rinvented', source: 'made up', kind: 'speech', arabic: 'مختلق', speaker: null },
  ],
  new_terms: [{ term: 'Murim', arabic: 'الموريم', kind: 'organization', note: null }],
  characters: [{ name: 'Yuria', arabic: 'يوريا', gender: 'female' }],
  summary: 'يوريا تكشف أن الساحر وحده يعرف الحقيقة.',
};

describe('translate by region id (vision pipeline)', () => {
  it('sends ids + OCR drafts + the page, returns Arabic by id, drops sfx Arabic and invented ids', async () => {
    const { env } = testEnv();
    const gpt = fakeGpt(() => answer);
    const res = await handleTranslateText(req(), env, A, Date.UTC(2026, 8, 24), { fetch: gpt.fetch });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { engine: string; cached: boolean; regions: Array<{ id: string; arabic: string | null; kind: string }>; summary: string };
    expect(body.engine).toBe(textEngineOf(env));
    expect(body.cached).toBe(false);
    expect(body.regions.map((r) => r.id)).toEqual(['r1a2b3c4d', 'rdeadbeef']);
    expect(body.regions[0]?.arabic).toBe('ساحرنا وحده يعرف الحقيقة.');
    // المؤثر الصوتي: الرسم يحتفظ به مهما قال النموذج
    expect(body.regions[1]).toMatchObject({ kind: 'sfx', arabic: null });

    const call = gpt.calls[0]!;
    expect(call.body.instructions).toBe(TEXT_SYSTEM_PROMPT);
    const prompt = promptOf(call);
    expect(prompt).toContain('r1a2b3c4d');
    expect(prompt).toContain('"ONLY OUR MAGICIAN KNOWS THE TRUTH."');
    expect(prompt).toContain('box=172,613,513,763');
    const format = (call.body.text as { format: { schema: { properties: { regions: { items: { required: string[] } } } } } }).format;
    expect(format.schema.properties.regions.items.required).toEqual(['id', 'source', 'kind', 'arabic', 'speaker']);
  });

  it('caches by page hash for every account and feeds the glossary', async () => {
    const { env } = testEnv();
    const gpt = fakeGpt(() => answer);
    await handleTranslateText(req(), env, A, Date.UTC(2026, 8, 24), { fetch: gpt.fetch });
    const again = await handleTranslateText(req(), env, B, Date.UTC(2026, 8, 24), { fetch: gpt.fetch });
    const body = (await again.json()) as { cached: boolean; regions: unknown[] };
    expect(body.cached).toBe(true);
    expect(body.regions).toHaveLength(2);
    expect(gpt.calls).toHaveLength(1);

    const terms = await env.DB.prepare('SELECT term, arabic FROM translation_terms WHERE series_ref = ?').bind('ext:wizardly tower').all<{ term: string; arabic: string }>();
    expect(terms.results).toEqual([{ term: 'Murim', arabic: 'الموريم' }]);
    // الصفحة التالية ترى القاموس والملخص
    const next = fakeGpt(() => ({ regions: [], new_terms: [], characters: [], summary: '' }));
    await handleTranslateText(req({ pageHash: hash('b'), pageIndex: 4, regions: [regionsIn[0]] }), env, A, Date.UTC(2026, 8, 24), { fetch: next.fetch });
    const prompt = promptOf(next.calls[0]!);
    expect(prompt).toContain('Murim → الموريم');
    expect(prompt).toContain('يوريا تكشف');
  });

  it('counts against the weekly limit and refuses without a key', async () => {
    const { env } = testEnv({ TRANSLATE_WEEKLY_PAGES: '1' });
    const gpt = fakeGpt(() => answer);
    expect((await handleTranslateText(req(), env, A, Date.UTC(2026, 8, 24), { fetch: gpt.fetch })).status).toBe(200);
    const limited = await handleTranslateText(req({ pageHash: hash('c') }), env, A, Date.UTC(2026, 8, 24), { fetch: gpt.fetch });
    expect(limited.status).toBe(429);
    const { env: noKey } = testEnv({ OPENAI_API_KEY: '' });
    expect((await handleTranslateText(req(), noKey, A, Date.UTC(2026, 8, 24))).status).toBe(503);
  });

  it('validates the request and returns an empty reply for a page with no readable regions', async () => {
    const { env } = testEnv();
    expect((await handleTranslateText(req({ pageHash: 'nope' }), env, A, 0)).status).toBe(400);
    const empty = await handleTranslateText(req({ regions: [] }), env, A, 0);
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { regions: unknown[] }).regions).toEqual([]);
  });
});

describe('region cleaning', () => {
  it('keeps only well-formed unique ids and clamps boxes', () => {
    const cleaned = cleanTextRegionsIn(
      [
        { id: 'r1', source: ' hi ', kind: 'speech', box: [-5, 10, 9999, 20] },
        { id: 'r1', source: 'dup' },
        { id: 'BAD ID', source: 'x' },
        { id: 'r2', source: 'no box' },
      ],
      100,
      200,
    );
    expect(cleaned).toEqual([
      { id: 'r1', source: 'hi', kind: 'speech', box: [0, 10, 200, 20] },
      { id: 'r2', source: 'no box', kind: 'speech', box: [0, 0, 0, 0] },
    ]);
  });

  it('never returns Arabic for credits or sound effects, and never an unknown id', () => {
    const out = cleanTextRegionsOut(
      [
        { id: 'a', source: 's', kind: 'credit', arabic: 'x', speaker: null },
        { id: 'b', source: 's', kind: 'weird', arabic: ' ok ', speaker: ' Kim ' },
        { id: 'zzz', source: 's', kind: 'speech', arabic: 'no', speaker: null },
      ],
      new Set(['a', 'b']),
    );
    expect(out).toEqual([
      { id: 'a', source: 's', kind: 'credit', arabic: null, speaker: null },
      { id: 'b', source: 's', kind: 'speech', arabic: 'ok', speaker: 'Kim' },
    ]);
  });
});

describe('a bubble Luna skipped is never skipped for good', () => {
  const two = [
    { id: 'rleft0001', source: 'THE LEFT COFFIN IS EMPTY...', kind: 'speech', box: [620, 120, 930, 300] },
    { id: 'rright001', source: "AND THE RIGHT IS... OH NO! THERE'S A SCARY SKELETON IN IT!", kind: 'speech', box: [220, 456, 729, 614] },
  ];
  const left = { id: 'rleft0001', source: 'THE LEFT COFFIN IS EMPTY...', kind: 'speech', arabic: 'التابوت الأيسر فارغ…', speaker: null };
  const right = { id: 'rright001', source: "AND THE RIGHT IS... OH NO! THERE'S A SCARY SKELETON IN IT!", kind: 'speech', arabic: 'والأيمن… يا إلهي! فيه هيكل عظمي مخيف!', speaker: null };
  const reply = (regions: unknown[]) => ({ regions, new_terms: [], characters: [], summary: 'فتاة تفتح تابوتين.' });

  it('asks again for just the missing bubble and returns both', async () => {
    const { env } = testEnv();
    const gpt = fakeGpt((body) => (promptOf({ body }).includes('rleft0001') ? reply([left]) : reply([right])));
    const res = await handleTranslateText(req({ regions: two }), env, A, Date.UTC(2026, 8, 24), { fetch: gpt.fetch });
    const out = (await res.json()) as { regions: Array<{ id: string; arabic: string }> };
    expect(out.regions.map((r) => r.arabic)).toEqual([left.arabic, right.arabic]);
    expect(gpt.calls).toHaveLength(2);
    const retryPrompt = promptOf(gpt.calls[1]!);
    expect(retryPrompt).toContain('rright001');
    expect(retryPrompt).not.toContain('rleft0001');
    expect(retryPrompt).toContain('Each one is its own bubble');
    expect(promptOf(gpt.calls[0]!)).not.toContain('Each one is its own bubble');
    // الإصلاح لا يُحسب صفحة ثانية
    const usage = await env.DB.prepare('SELECT pages FROM translation_usage').first<{ pages: number }>();
    expect(usage?.pages).toBe(1);
  });

  it('speech with null Arabic counts as missing; sfx and signs without Arabic do not', async () => {
    const { env } = testEnv();
    const withSign = [...two, { id: 'rsign0001', source: 'EXIT', kind: 'free', box: [10, 10, 60, 30] }];
    const gpt = fakeGpt(() => reply([left, { ...right, arabic: null }, { id: 'rsign0001', source: 'EXIT', kind: 'sign', arabic: null, speaker: null }]));
    await handleTranslateText(req({ regions: withSign }), env, A, Date.UTC(2026, 8, 24), { fetch: gpt.fetch });
    expect(gpt.calls).toHaveLength(2);
    expect(promptOf(gpt.calls[1]!)).toContain('rright001');
    expect(promptOf(gpt.calls[1]!)).not.toContain('rsign0001');
  });

  it('a saved page with a hole is repaired once, for everyone, without charging the week', async () => {
    const { env } = testEnv({ TRANSLATE_WEEKLY_PAGES: '1' });
    // أول مرة: Luna تُسقط الفقاعة في المحاولتين
    const stubborn = fakeGpt(() => reply([left]));
    await handleTranslateText(req({ regions: two }), env, A, Date.UTC(2026, 8, 24), { fetch: stubborn.fetch });
    // لاحقًا (والأسبوع ممتلئ): المحفوظ ناقص ← سؤال عن الناقص وحده
    const later = fakeGpt(() => reply([right]));
    const res = await handleTranslateText(req({ regions: two }), env, B, Date.UTC(2026, 8, 24), { fetch: later.fetch });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { regions: Array<{ arabic: string }> };
    expect(out.regions.map((r) => r.arabic)).toEqual([left.arabic, right.arabic]);
    expect(later.calls).toHaveLength(1);
    // بعد الإصلاح: من المحفوظ بلا نداء
    const done = fakeGpt(() => reply([]));
    const again = (await (await handleTranslateText(req({ regions: two }), env, A, Date.UTC(2026, 8, 24), { fetch: done.fetch })).json()) as { cached: boolean };
    expect(again.cached).toBe(true);
    expect(done.calls).toHaveLength(0);
  });
});
