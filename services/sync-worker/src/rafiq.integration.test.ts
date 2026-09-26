import { describe, expect, it } from 'vitest';
import { cleanIntent, handleRafiqConversations, handleRafiqFeedback, handleRafiqMessage, handleRafiqPrefs, handleRafiqState, statsAnswer, type RafiqEnv } from './rafiq.ts';
import { partialString } from './rafiq-llm.ts';
import { sqliteEnv } from './test-d1.ts';

/**
 * «رفيق»: مقفل لغير صاحبه (لا نداء أبدًا)، لا يعرض إلا أعمالًا من المرشّحين الحقيقيين،
 * أسئلة الأرقام بلا نموذج، الرأي يصير ذاكرة تُرى وتُحذف، وإعادة الإرسال لا تكرر شيئًا.
 */

const A = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const B = '1f0c1d2e-7a55-4c1b-9d7e-3b1a2c4d5e6f';
const NOW = Date.UTC(2026, 8, 26, 12);

function testEnv(extra: Record<string, string> = {}) {
  const { env } = sqliteEnv({
    VANTARA_SESSION_SECRET: 'rafiq-secret-that-is-at-least-32-characters',
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
    ...extra,
  } as never);
  const renv = env as RafiqEnv;
  if (!('DEEPSEEK_API_KEY' in extra)) renv.DEEPSEEK_API_KEY = 'ds-test';
  if (!('RAFIQ_USERS' in extra)) renv.RAFIQ_USERS = 'mishal';
  return renv;
}

async function seedAccounts(env: RafiqEnv) {
  await env.DB.prepare('INSERT INTO accounts (user_id, username, created_at) VALUES (?, ?, 0) ON CONFLICT (user_id) DO UPDATE SET username = excluded.username').bind(A, 'Mishal').run();
  await env.DB.prepare('INSERT INTO accounts (user_id, username, created_at) VALUES (?, ?, 0) ON CONFLICT (user_id) DO UPDATE SET username = excluded.username').bind(B, 'Brother').run();
}

const media = (id: number, title: string, genres: string[], tags: string[], extra: Record<string, unknown> = {}) => ({
  id,
  type: 'MANGA',
  format: 'MANGA',
  status: 'FINISHED',
  episodes: null,
  chapters: 40,
  averageScore: 82,
  popularity: 50000,
  genres,
  isAdult: false,
  seasonYear: null,
  startDate: { year: 2019 },
  countryOfOrigin: 'JP',
  title: { romaji: title, english: title, native: null },
  synonyms: [],
  coverImage: { large: `https://img/${id}.jpg`, extraLarge: null, color: '#123456' },
  bannerImage: null,
  description: `${title} synopsis.<br>More.`,
  tags: tags.map((name) => ({ name, rank: 80, isMediaSpoiler: false, isGeneralSpoiler: false })),
  ...extra,
});

const CATALOG = [
  media(101, 'Fast Start', ['Action', 'Mystery'], ['Survival', 'Twist']),
  media(102, 'Quick Blades', ['Action', 'Adventure'], ['Swordplay']),
  media(103, 'Slow Hearts', ['Romance', 'Drama'], ['School']),
];

interface Fake {
  fetch: typeof fetch;
  llm: Array<Record<string, unknown>>;
  anilist: number;
}

/** DeepSeek وAniList وهميّان: `intent` لنداء الفهم، و`answer` للرد المبثوث. */
function fake(intent: unknown, answer: unknown): Fake {
  const out: Fake = { llm: [], anilist: 0, fetch: undefined as never };
  out.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (url.includes('anilist')) {
      out.anilist += 1;
      return new Response(JSON.stringify({ data: { Page: { media: CATALOG } } }), { status: 200 });
    }
    out.llm.push(body);
    if (!body.stream) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(intent) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }), { status: 200 });
    }
    const text = JSON.stringify(answer);
    // يُبث على قطع صغيرة كما يفعل DeepSeek
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += 7) chunks.push(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 7) } }] })}\n\n`);
    chunks.push(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 120 } })}\n\n`, 'data: [DONE]\n\n');
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(c) {
          for (const ch of chunks) c.enqueue(enc.encode(ch));
          c.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  };
  return out;
}

async function events(res: Response) {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const [ev, data] = block.split('\n');
      return { event: ev!.slice(7), data: JSON.parse(data!.slice(6)) as Record<string, any> };
    });
}

const send = (body: Record<string, unknown>) => new Request('https://sync.test/v1/rafiq/message', { method: 'POST', body: JSON.stringify(body) });

const INTENT = { intent: 'recommend', format: 'MANGA', genres_in: [], genres_out: ['Romance'], tags_in: [], tags_out: [], length: 'short', status: 'ANY', reference: null, exploration: 'normal', mood: null, preference_updates: [], feedback: [] };

describe('rafiq', () => {
  it('is locked for everyone but its owner, without touching DeepSeek or AniList', async () => {
    const env = testEnv();
    await seedAccounts(env);
    const f = fake(INTENT, {});
    const res = await handleRafiqMessage(send({ clientId: 'msg-00000001', text: 'اقترح' }), env, B, NOW, f.fetch);
    expect(res.status).toBe(403);
    expect(f.llm).toHaveLength(0);
    expect(f.anilist).toBe(0);
    const state = await handleRafiqState(new URL('https://sync.test/v1/rafiq/state'), env, B, NOW);
    expect(await state.json()).toEqual({ enabled: false });
  });

  it('never unlocks by accident when no owner is known', async () => {
    const env = testEnv({ RAFIQ_USERS: '' });
    await seedAccounts(env);
    const state = await handleRafiqState(new URL('https://sync.test/v1/rafiq/state'), env, A, NOW);
    expect(await state.json()).toEqual({ enabled: false });
  });

  it('streams the reply and keeps only cards that came from the real candidates', async () => {
    const env = testEnv();
    await seedAccounts(env);
    const f = fake(INTENT, {
      message: 'يا رجل عندي لك شي نار 🔥',
      cards: [
        { id: 'manga:101', reason: 'بدايتها سريعة وقصيرة', exploration: false },
        { id: 'manga:999999', reason: 'عمل مخترع', exploration: false },
        { id: 'manga:101', reason: 'مكرر', exploration: false },
      ],
      chips: ['شي أقصر', 'فاجئني'],
    });
    const res = await handleRafiqMessage(send({ clientId: 'msg-00000001', text: 'أبي مانجا قصيرة، بدايتها سريعة، وما أبي رومانسية كثيرة' }), env, A, NOW, f.fetch);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const evs = await events(res);
    expect(evs[0]!.event).toBe('meta');
    const streamed = evs.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
    expect(streamed).toBe('يا رجل عندي لك شي نار 🔥');
    const final = evs.find((e) => e.event === 'final')!.data.message;
    expect(final.cards.map((c: { workId: string }) => c.workId)).toEqual(['manga:101']);
    // البطاقة من بياناتنا لا من كلام النموذج
    expect(final.cards[0]).toMatchObject({ title: 'Fast Start', cover: 'https://img/101.jpg', count: 40, kind: 'manga', reason: 'بدايتها سريعة وقصيرة' });
    expect(final.chips).toEqual(['شي أقصر', 'فاجئني']);

    // الطلب الحالي وصل للنموذج كشروط، والمرشّحون فقط بعد استبعاد الرومانسية
    const answerCall = f.llm.find((b) => b.stream)!;
    const payload = JSON.parse((answerCall.messages as Array<{ content: string }>)[1]!.content) as { candidates: Array<{ id: string }>; understood: { avoid: string[] } };
    expect(payload.understood.avoid).toContain('Romance');
    expect(payload.candidates.map((c) => c.id)).toContain('manga:101');

    const recs = await env.DB.prepare('SELECT work_id, title FROM rafiq_recs WHERE user_id = ?').bind(A).all();
    expect(recs.results).toEqual([{ work_id: 'manga:101', title: 'Fast Start' }]);
    const spend = await env.DB.prepare('SELECT calls FROM rafiq_spend').first<{ calls: number }>();
    expect(spend?.calls).toBe(2);
  });

  it('a retry with the same client id replays the stored reply without a new call or duplicate message', async () => {
    const env = testEnv();
    await seedAccounts(env);
    const f = fake(INTENT, { message: 'خذ هذي 👀', cards: [{ id: 'manga:102', reason: 'سيوف وسرعة' }], chips: [] });
    await events(await handleRafiqMessage(send({ clientId: 'msg-00000002', text: 'اقترح' }), env, A, NOW, f.fetch));
    const calls = f.llm.length;
    const again = await events(await handleRafiqMessage(send({ clientId: 'msg-00000002', text: 'اقترح' }), env, A, NOW + 5000, f.fetch));
    expect(f.llm.length).toBe(calls);
    expect(again.find((e) => e.event === 'final')!.data.message.content).toBe('خذ هذي 👀');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM rafiq_messages').first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it('answers numbers from the history without the model', async () => {
    const env = testEnv();
    await seedAccounts(env);
    const f = fake(INTENT, {});
    const evs = await events(await handleRafiqMessage(send({ clientId: 'msg-00000003', text: 'كم فصل قريت؟' }), env, A, NOW, f.fetch));
    expect(f.llm).toHaveLength(0);
    expect(evs.find((e) => e.event === 'final')!.data.message.content).toMatch(/^قريت 0 فصل/);
  });

  it('stated preferences and feedback become visible, deletable memory', async () => {
    const env = testEnv();
    await seedAccounts(env);
    const f = fake(
      { ...INTENT, preference_updates: [{ kind: 'tag', key: 'School', polarity: -1, note: 'قال: لا عاد تقترح مدرسية' }] },
      { message: 'أبشر، شلت المدرسية 🫡', cards: [{ id: 'manga:102', reason: 'بعيدة عن المدارس' }], chips: [] },
    );
    const evs = await events(await handleRafiqMessage(send({ clientId: 'msg-00000004', text: 'لا عاد تقترح أعمال مدرسية' }), env, A, NOW, f.fetch));
    const card = evs.find((e) => e.event === 'final')!.data.message.cards[0];

    const fb = await handleRafiqFeedback(
      new Request('https://sync.test/v1/rafiq/feedback', { method: 'POST', body: JSON.stringify({ recId: card.recId, kind: 'not_for_me' }) }),
      env,
      A,
      NOW + 1000,
    );
    expect(await fb.json()).toEqual({ ok: true });
    const rec = await env.DB.prepare('SELECT feedback FROM rafiq_recs WHERE id = ?').bind(card.recId).first<{ feedback: string }>();
    expect(rec?.feedback).toBe('not_for_me');

    const list = (await (await handleRafiqPrefs(new Request('https://sync.test/v1/rafiq/prefs'), new URL('https://sync.test/v1/rafiq/prefs'), env, A)).json()) as { prefs: Array<{ id: string; key: string; source: string; polarity: number }> };
    expect(list.prefs).toEqual([expect.objectContaining({ key: 'School', source: 'explicit', polarity: -1 })]);
    const del = new URL(`https://sync.test/v1/rafiq/prefs?id=${list.prefs[0]!.id}`);
    await handleRafiqPrefs(new Request(del, { method: 'DELETE' }), del, env, A);
    const after = (await (await handleRafiqPrefs(new Request('https://sync.test/v1/rafiq/prefs'), new URL('https://sync.test/v1/rafiq/prefs'), env, A)).json()) as { prefs: unknown[] };
    expect(after.prefs).toEqual([]);

    // ما رُفض لا يُقترح ثانية: يُستبعد من استعلام الكتالوج
    const f2 = fake(INTENT, { message: 'تمام', cards: [], chips: [] });
    await events(await handleRafiqMessage(send({ clientId: 'msg-00000005', text: 'غيرها' }), env, A, NOW + 2000, f2.fetch));
    const payload = JSON.parse((f2.llm.find((b) => b.stream)!.messages as Array<{ content: string }>)[1]!.content) as { candidates: Array<{ id: string }> };
    expect(payload.candidates.map((c) => c.id)).not.toContain('manga:102');
  });

  it('knows where Arabic stops and English goes on, and proposes a pre-translation range within the quota', async () => {
    const env = testEnv({ TRANSLATE_USERS: 'mishal', TRANSLATE_WEEKLY_CHAPTERS: '10' });
    await seedAccounts(env);
    const f = fake(
      { ...INTENT, intent: 'recommend', gap: true },
      { message: 'العربي واقف عند 22 والإنجليزي واصل 72 🔥', cards: [{ id: 'ext:the breaker', reason: 'كملتها لين العربي خلص', summary: 'فتى ضعيف يتعلم فنون قتالية سرًا', translate: { from: 5, to: 500 } }], chips: [] },
    );
    const gaps = [
      { ref: 'ext:the breaker', title: 'The Breaker', ar: 22, en: 72 },
      { ref: 'ext:done', title: 'Done Work', ar: 50, en: 50 },
    ];
    const evs = await events(await handleRafiqMessage(send({ clientId: 'msg-00000007', text: 'مانهوا عربيها متأخر عن الإنجليزي', local: { anime: [], gaps } }), env, A, NOW, f.fetch));
    const card = evs.find((e) => e.event === 'final')!.data.message.cards[0];
    expect(card).toMatchObject({ workId: 'ext:the breaker', ref: 'ext:the breaker', span: { ar: 22, en: 72 }, summary: 'فتى ضعيف يتعلم فنون قتالية سرًا' });
    // النموذج طلب 5–500: الخادم صحّحه لما بعد العربي، وقصّه على حصة الأسبوع (10 فصول)
    expect(card.translate).toEqual({ from: 23, to: 32 });
    const payload = JSON.parse((f.llm.find((b) => b.stream)!.messages as Array<{ content: string }>)[1]!.content) as { candidates: Array<{ id: string; arabic_until: number; english_until: number }> };
    // عمل واحد بفجوة معروفة: أوله، وبعده مانجا مرشّحة يشيّك الجهاز فصولها
    expect(payload.candidates[0]!.id).toBe('ext:the breaker');
    expect(payload.candidates.some((c) => c.id === 'ext:done')).toBe(false);
    expect(payload.candidates[0]).toMatchObject({ arabic_until: 22, english_until: 72 });
  });

  it('lists past conversations by their first message, opens and deletes one', async () => {
    const env = testEnv();
    await seedAccounts(env);
    const f = fake(INTENT, { message: 'خذ 👀', cards: [], chips: [] });
    await events(await handleRafiqMessage(send({ clientId: 'msg-00000008', text: 'أبي شي يحمّس' }), env, A, NOW, f.fetch));
    const listUrl = new URL('https://sync.test/v1/rafiq/conversations');
    const list = (await (await handleRafiqConversations(new Request(listUrl), listUrl, env, A)).json()) as { conversations: Array<{ id: string; title: string; messages: number }> };
    expect(list.conversations).toEqual([expect.objectContaining({ title: 'أبي شي يحمّس', messages: 2 })]);
    const id = list.conversations[0]!.id;
    const state = (await (await handleRafiqState(new URL(`https://sync.test/v1/rafiq/state?conversationId=${id}`), env, A, NOW)).json()) as { messages: Array<{ content: string }> };
    expect(state.messages.map((m) => m.content)).toEqual(['أبي شي يحمّس', 'خذ 👀']);
    // غيرك ما يشوفها ولا يحذفها
    expect((await handleRafiqConversations(new Request(listUrl), listUrl, env, B)).status).toBe(403);
    const del = new URL(`https://sync.test/v1/rafiq/conversations?id=${id}`);
    await handleRafiqConversations(new Request(del, { method: 'DELETE' }), del, env, A);
    const after = (await (await handleRafiqConversations(new Request(listUrl), listUrl, env, A)).json()) as { conversations: unknown[] };
    expect(after.conversations).toEqual([]);
  });

  it('when AniList blocks the Worker, the device fetches the catalog and the second round answers', async () => {
    const env = testEnv();
    await seedAccounts(env);
    const f = fake(INTENT, { message: 'خذ هذي 🔥', cards: [{ id: 'manga:101', reason: 'تناسبك' }], chips: [] });
    const blocked: typeof fetch = async (input, init) => (String(input).includes('anilist') ? new Response('blocked', { status: 403 }) : f.fetch(input, init));

    const first = await events(await handleRafiqMessage(send({ clientId: 'msg-00000009', text: 'عندك عمل جبار' }), env, A, NOW, blocked));
    const need = first.find((e) => e.event === 'need')!.data as { requests: string[]; intent: unknown; round: number };
    expect(need.requests.length).toBeGreaterThan(0);
    expect(first.some((e) => e.event === 'final')).toBe(false);
    const intentCalls = f.llm.filter((b) => !b.stream).length;

    // الجهاز يسأل AniList بنفس الطلبات ويرجع بالردود
    const anilist = need.requests.map((key) => ({ key, data: { Page: { media: CATALOG } } }));
    const second = await events(await handleRafiqMessage(send({ clientId: 'msg-00000009', text: 'عندك عمل جبار', anilist, intent: need.intent, round: need.round }), env, A, NOW + 3000, blocked));
    const final = second.find((e) => e.event === 'final')!.data.message;
    expect(final.cards.map((c: { workId: string }) => c.workId)).toEqual(['manga:101']);
    // الفهم ما انعاد، والرسالة ما تكررت
    expect(f.llm.filter((b) => !b.stream).length).toBe(intentCalls);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM rafiq_messages WHERE role = 'user'").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('never asks the model about an empty catalog', async () => {
    const env = testEnv();
    await seedAccounts(env);
    const f = fake(INTENT, { message: 'ما عندي candidates', cards: [], chips: [] });
    const empty: typeof fetch = async (input, init) => (String(input).includes('anilist') ? new Response(JSON.stringify({ data: { Page: { media: [] } } }), { status: 200 }) : f.fetch(input, init));
    const evs = await events(await handleRafiqMessage(send({ clientId: 'msg-00000010', text: 'رشح لي' }), env, A, NOW, empty));
    expect(f.llm.some((b) => b.stream)).toBe(false);
    expect(evs.find((e) => e.event === 'final')!.data.message.content).not.toContain('candidates');
  });

  it('refuses without a key, before any call', async () => {
    const env = testEnv({ DEEPSEEK_API_KEY: '' });
    await seedAccounts(env);
    const f = fake(INTENT, {});
    const res = await handleRafiqMessage(send({ clientId: 'msg-00000006', text: 'اقترح' }), env, A, NOW, f.fetch);
    expect(res.status).toBe(503);
    expect(f.llm).toHaveLength(0);
  });
});

describe('rafiq helpers', () => {
  it('keeps only known genres and tags from the intent parse', () => {
    const i = cleanIntent({ intent: 'recommend', genres_in: ['Action', 'Nonsense'], tags_out: ['School', 'Made Up'], length: 'tiny', preference_updates: [{ kind: 'tag', key: 'School', polarity: -1 }, { key: 'x', polarity: 3 }] });
    expect(i.genres_in).toEqual(['Action']);
    expect(i.tags_out).toEqual(['School']);
    expect(i.length).toBe('any');
    expect(i.preference_updates).toHaveLength(1);
  });

  it('extracts the message field while it is still being written', () => {
    expect(partialString('{"message": "هلا \\"يا', 'message')).toEqual({ text: 'هلا "يا', closed: false });
    expect(partialString('{"message": "تم", "cards"', 'message')).toEqual({ text: 'تم', closed: true });
  });

  it('stats questions are answered from data', () => {
    expect(statsAnswer('كم حلقة شاهدت؟', [], NOW)).toContain('ما عندي سجل');
    expect(statsAnswer('اقترح شي', [], NOW)).toBeNull();
  });
});
