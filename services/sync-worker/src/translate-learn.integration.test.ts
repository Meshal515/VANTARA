import { describe, expect, it } from 'vitest';
import { handleTranslateLearn, handleTranslateText, LEARN_SYSTEM_PROMPT, TEXT_SYSTEM_PROMPT } from './translate.ts';
import { sqliteEnv } from './test-d1.ts';

/**
 * `POST /v1/translate/learn` — Luna تتعلم من الفصول العربية الموجودة لنفس العمل:
 * أسماء الشخصيات والمصطلحات كما كتبها الفريق العربي، وملاحظات أسلوبه، فتكمل
 * الفصول الإنجليزية بنفس الصوت.
 */

const A = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
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

function fakeGpt(answer: (body: Record<string, unknown>) => unknown) {
  const calls: Array<{ body: Record<string, unknown> }> = [];
  const fake: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ body });
    return new Response(
      JSON.stringify({ id: 'resp', model: 'gpt-6-luna', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer(body)) }] }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return { fetch: fake, calls };
}

const pair = (i: number) => ({ english: { mediaType: 'image/jpeg', data: `EN${i}` }, arabic: { mediaType: 'image/jpeg', data: `AR${i}` }, pageIndex: i });
const learnReq = (over: Record<string, unknown> = {}) =>
  new Request('https://sync.test/v1/translate/learn', {
    method: 'POST',
    body: JSON.stringify({ seriesRef: 'ext:the breaker', seriesTitle: 'The Breaker', chapterNumber: 33, pairs: [pair(0), pair(4), pair(9)], ...over }),
  });

const lesson = {
  characters: [
    { name: 'Goomoonryong', arabic: 'غومون ريونغ', gender: 'male' },
    { name: 'Shioon', arabic: 'شيون', gender: 'male' },
  ],
  terms: [
    { term: 'Murim', arabic: 'الموريم', kind: 'organization', note: 'kept as a proper noun with the article' },
    { term: 'Sunwoo Clan', arabic: 'عشيرة سونوو', kind: 'organization', note: null },
    { term: 'ki-center', arabic: 'مركز الكي', kind: 'other', note: null },
  ],
  style: ['فصحى سلسة، جمل قصيرة، الشتائم مخفّفة.', 'الألقاب: «سيد» للأسياد و«شيخ» لكبار العشيرة، بلا -nim.', 'شيون يتكلم بتردد وكثرة نقاط الحذف.'],
};

describe('learning from the Arabic edition', () => {
  it('sends the page pairs, stores the team glossary as learned (winning over model guesses) and the style notes', async () => {
    const { env } = testEnv();
    // تخمين سابق من النموذج يجب أن يُستبدل بما كتبه الفريق
    await env.DB.prepare(`INSERT INTO translation_terms (series_ref, term, arabic, kind, note, origin, updated_at) VALUES ('ext:the breaker', 'Murim', 'موريم', 'organization', NULL, 'model', 1)`).run();
    const gpt = fakeGpt(() => lesson);
    const res = await handleTranslateLearn(learnReq(), env, A, Date.UTC(2026, 8, 24), { fetch: gpt.fetch });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { learned: boolean; learnedFrom: string; styleLines: number };
    expect(body).toMatchObject({ learned: true, learnedFrom: 'chapter:33', styleLines: 3 });

    const call = gpt.calls[0]!;
    expect(call.body.instructions).toBe(LEARN_SYSTEM_PROMPT);
    const content = (call.body.input as Array<{ content: Array<{ type: string; image_url?: string }> }>)[0]!.content;
    expect(content.filter((c) => c.type === 'input_image')).toHaveLength(6);
    expect(content.find((c) => c.type === 'input_image')?.image_url).toBe('data:image/jpeg;base64,EN0');

    const terms = await env.DB.prepare('SELECT term, arabic, origin FROM translation_terms WHERE series_ref = ? ORDER BY term').bind('ext:the breaker').all<{ term: string; arabic: string; origin: string }>();
    expect(terms.results).toEqual([
      { term: 'Murim', arabic: 'الموريم', origin: 'learned' },
      { term: 'Sunwoo Clan', arabic: 'عشيرة سونوو', origin: 'learned' },
      { term: 'ki-center', arabic: 'مركز الكي', origin: 'learned' },
    ]);
    const style = await env.DB.prepare('SELECT notes, pairs FROM translation_style WHERE series_ref = ?').bind('ext:the breaker').first<{ notes: string; pairs: number }>();
    expect(style?.pairs).toBe(3);
    expect(style?.notes).toContain('شيون يتكلم بتردد');
  });

  it('later page translations carry the learned glossary and style to Luna', async () => {
    const { env } = testEnv();
    const learn = fakeGpt(() => lesson);
    await handleTranslateLearn(learnReq(), env, A, Date.UTC(2026, 8, 24), { fetch: learn.fetch });
    const gpt = fakeGpt(() => ({ regions: [], new_terms: [], characters: [], summary: '' }));
    const req = new Request('https://sync.test/v1/translate/text', {
      method: 'POST',
      body: JSON.stringify({
        pageHash: hash('a'),
        seriesRef: 'ext:the breaker',
        seriesTitle: 'The Breaker',
        chapterKey: 'ext:the breaker#n:70',
        chapterNumber: 70,
        pageIndex: 0,
        sourceLang: 'en',
        image: { mediaType: 'image/jpeg', data: 'AAAA', width: 1080, height: 2316 },
        regions: [{ id: 'r1', source: 'ELDER MIN! THAT BOY...', kind: 'speech', box: [1, 2, 3, 4] }],
      }),
    });
    await handleTranslateText(req, env, A, Date.UTC(2026, 8, 24), { fetch: gpt.fetch });
    const input = gpt.calls[0]!.body.input as Array<{ content: Array<{ type: string; text?: string }> }>;
    const prompt = input[0]!.content.find((c) => c.type === 'input_text')?.text ?? '';
    expect(prompt).toContain('Sunwoo Clan → عشيرة سونوو');
    expect(prompt).toContain('Goomoonryong → غومون ريونغ');
    expect(prompt).toContain('Style of the Arabic team');
    expect(prompt).toContain('الألقاب: «سيد»');
    // بنك الأمثلة في التعليمات الثابتة (البادئة المخزّنة)
    expect(TEXT_SYSTEM_PROMPT).toContain('Reference translations');
    expect(TEXT_SYSTEM_PROMPT).toContain('«ابتعد عن طريقي!»');
  });

  it('learns once per chapter, counts one page, and validates its input', async () => {
    const { env } = testEnv({ TRANSLATE_WEEKLY_PAGES: '1' });
    const gpt = fakeGpt(() => lesson);
    expect((await handleTranslateLearn(learnReq(), env, A, Date.UTC(2026, 8, 24), { fetch: gpt.fetch })).status).toBe(200);
    const again = await handleTranslateLearn(learnReq(), env, A, Date.UTC(2026, 8, 24), { fetch: gpt.fetch });
    expect(((await again.json()) as { cached: boolean }).cached).toBe(true);
    expect(gpt.calls).toHaveLength(1);
    // فصل أحدث = درس جديد، لكن الحد الأسبوعي (1) استُهلك
    const newer = await handleTranslateLearn(learnReq({ chapterNumber: 40 }), env, A, Date.UTC(2026, 8, 24), { fetch: gpt.fetch });
    expect(newer.status).toBe(429);
    expect((await handleTranslateLearn(learnReq({ pairs: [] }), env, A, 0)).status).toBe(400);
    expect((await handleTranslateLearn(learnReq({ pairs: [{ english: { mediaType: 'text/html', data: 'x' }, arabic: pair(0).arabic }] }), env, A, 0)).status).toBe(400);
  });
});
