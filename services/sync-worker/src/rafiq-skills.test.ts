import { describe, expect, it } from 'vitest';
import { handleRafiqExternal, handleRafiqMessage, handleRafiqUsage, statsAnswer, type RafiqEnv } from './rafiq.ts';
import { costOf, isPeak, route } from './rafiq-models.ts';
import { sqliteEnv } from './test-d1.ts';

/**
 * المهارات: الترتيب من الكتالوج لا من الخيال، المقارنة بجدول من البيانات، سؤال العمل
 * بآراء القرّاء، والذوق بأرقام محسوبة. وكل نداء محسوب في الرصيد.
 */

const A = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const NOW = Date.UTC(2026, 8, 26, 12); // سبت: خارج الذروة

function testEnv() {
  const { env } = sqliteEnv({ VANTARA_SESSION_SECRET: 'x'.repeat(40), VANTARA_IDENTITY_SECRET: 'y'.repeat(40), VANTARA_DEVICE_PEPPER: 'z'.repeat(40) } as never);
  const e = env as RafiqEnv;
  e.DEEPSEEK_API_KEY = 'k';
  e.RAFIQ_USERS = 'mishal';
  return e;
}
async function seed(env: RafiqEnv) {
  await env.DB.prepare("INSERT INTO accounts (user_id, username, created_at) VALUES (?, 'Mishal', 0) ON CONFLICT (user_id) DO UPDATE SET username = 'Mishal'").bind(A).run();
}

const media = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
  id, type: 'MANGA', format: 'MANGA', status: 'FINISHED', episodes: null, chapters: 100, averageScore: 85, popularity: 50000,
  genres: ['Action'], isAdult: false, seasonYear: null, startDate: { year: 2020 }, countryOfOrigin: 'KR',
  title: { romaji: title, english: title, native: null }, synonyms: [], coverImage: { large: `https://img/${id}.jpg`, extraLarge: null, color: null },
  bannerImage: null, description: `${title} story.`, tags: [{ name: 'Delinquents', rank: 90, isMediaSpoiler: false, isGeneralSpoiler: false }], relations: { edges: [] }, ...extra,
});
const RANKED = [media(1, 'Top One', { averageScore: 90, popularity: 90000 }), media(2, 'Top Two', { averageScore: 88, popularity: 80000 }), media(3, 'Top Three', { averageScore: 86, popularity: 70000 }), media(4, 'Top Four', { averageScore: 84, popularity: 60000 })];
const PROFILE = (id: number, title: string) => ({
  ...media(id, title),
  favourites: 1200,
  staff: { edges: [{ role: 'Story & Art', node: { name: { full: 'Author A' } } }] },
  stats: { scoreDistribution: [{ score: 100, amount: 50 }, { score: 80, amount: 30 }, { score: 40, amount: 20 }] },
  reviews: { nodes: [{ summary: 'Slow start, great payoff after chapter 30.', score: 85, rating: 40, ratingAmount: 50 }] },
  rankings: [{ rank: 12, context: 'highest rated', allTime: true, type: 'RATED' }],
});

interface Fake { fetch: typeof fetch; llm: Array<Record<string, unknown>> }
function fake(intent: unknown, answer: (payload: any) => unknown): Fake {
  const f: Fake = { llm: [], fetch: undefined as never };
  f.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body));
    if (url.includes('anilist')) {
      const q = String(body.query);
      if (q.includes('Media(search')) return Response.json({ data: { Media: media(body.variables.s === 'Viral Hit' ? 11 : 10, body.variables.s) } });
      if (q.includes('Media(id')) return Response.json({ data: { Media: PROFILE(body.variables.id, body.variables.id === 11 ? 'Viral Hit' : 'Lookism') } });
      return Response.json({ data: { Page: { media: RANKED } } });
    }
    f.llm.push(body);
    if (!body.stream) return Response.json({ choices: [{ message: { content: JSON.stringify(intent) } }], usage: { prompt_cache_hit_tokens: 1000, prompt_cache_miss_tokens: 200, completion_tokens: 50 } });
    const payload = JSON.parse(body.messages.at(-1).content);
    const text = JSON.stringify(answer(payload));
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_cache_hit_tokens: 3000, prompt_cache_miss_tokens: 500, completion_tokens: 300 } })}\n\ndata: [DONE]\n\n`);
  };
  return f;
}
const events = async (res: Response) =>
  (await res.text()).split('\n\n').filter(Boolean).map((b) => { const [e, d] = b.split('\n'); return { event: e!.slice(7), data: JSON.parse(d!.slice(6)) as any }; });
const send = (clientId: string, text: string) => new Request('https://x/v1/rafiq/message', { method: 'POST', body: JSON.stringify({ clientId, text }) });

describe('rafiq skills', () => {
  it('«توب 10 مانهوا»: the catalog order stays, the model only writes reasons', async () => {
    const env = testEnv();
    await seed(env);
    const f = fake({ intent: 'ranking', format: 'MANGA', country: 'KR', sort: 'SCORE_DESC', count: 3 }, (p) => ({
      message: 'هذي أعلى المانهوا تقييمًا.',
      // النموذج يحاول يقدّم الثالث ويخترع عملًا: الترتيب يبقى والمخترع يسقط
      ranking: [{ id: 'manga:3', reason: 'ثالث' }, { id: 'manga:1', reason: 'أول' }, { id: 'manga:2', reason: 'ثاني' }, { id: 'manga:999', reason: 'مخترع' }],
      cards: [],
    }));
    const evs = await events(await handleRafiqMessage(send('msg-rank-0001', 'عطني توب 3 مانهوا'), env, A, NOW, f.fetch));
    const final = evs.find((e) => e.event === 'final')!.data.message;
    expect(final.extra.ranking.items.map((x: any) => [x.rank, x.title, x.reason])).toEqual([[1, 'Top One', 'أول'], [2, 'Top Two', 'ثاني'], [3, 'Top Three', 'ثالث']]);
    expect(final.cards).toEqual([]);
    // الترتيب رخيص: بلا تفكير
    expect(f.llm.find((b) => b.stream)!.thinking).toEqual({ type: 'disabled' });
  });

  it('«لوكيسم ولا فيرال هيت؟»: a table built from data, not from the model', async () => {
    const env = testEnv();
    await seed(env);
    const f = fake({ intent: 'compare', format: 'MANGA', references: ['Lookism', 'Viral Hit'] }, (p) => ({ message: 'فيرال هيت أسرع إيقاعًا.', cards: p.candidates.map((c: any) => ({ id: c.id, reason: 'x' })) }));
    const evs = await events(await handleRafiqMessage(send('msg-cmp-0001', 'لوكيسم ولا فيرال هيت؟'), env, A, NOW, f.fetch));
    const final = evs.find((e) => e.event === 'final')!.data.message;
    expect(final.extra.comparison.titles).toEqual(['Lookism', 'Viral Hit']);
    expect(final.extra.comparison.rows.find((r: any) => r.label === 'الطول').values).toEqual(['100 فصل', '100 فصل']);
    expect(final.cards).toHaveLength(2);
    // المقارنة تستاهل تفكير
    expect(f.llm.find((b) => b.stream)!.thinking).toEqual({ type: 'enabled' });
  });

  it('«أنا فصل 20، أكمل؟»: reader reception and the stated progress reach the model', async () => {
    const env = testEnv();
    await seed(env);
    let seen: any = null;
    const f = fake({ intent: 'work', question: 'continue', references: ['Lookism'], progress: 20 }, (p) => {
      seen = p;
      return { message: 'كمّل: القرّاء يقولون يحلو بعد 30.', cards: [{ id: p.candidates[0].id, reason: 'x' }] };
    });
    await events(await handleRafiqMessage(send('msg-work-0001', 'أنا فصل 20 في لوكيسم أكمل؟'), env, A, NOW, f.fetch));
    expect(seen.evidence.asked).toBe('continue');
    expect(seen.evidence.said_progress).toBe(20);
    expect(seen.evidence.reception.review_summaries[0].summary).toContain('great payoff');
    expect(seen.evidence.reception.rated_80_plus_percent).toBe(80);
  });

  it('every model call is accounted, and usage shows where the money went', async () => {
    const env = testEnv();
    await seed(env);
    const f = fake({ intent: 'ranking', format: 'MANGA', count: 3 }, () => ({ message: 'تم', ranking: [], cards: [] }));
    await events(await handleRafiqMessage(send('msg-use-0001', 'توب 3'), env, A, NOW, f.fetch));
    const usage = (await (await handleRafiqUsage(env, A, NOW + 1000)).json()) as any;
    expect(usage.today.calls).toBe(2);
    expect(usage.today.cacheHitRatio).toBe(85);
    expect(usage.bySkill.map((r: any) => r.skill).sort()).toEqual(['ranking', 'router']);
    expect(usage.today.usd).toBeGreaterThan(0);
  });

  it('«قريته برا» removes it from suggestions and feeds the taste', async () => {
    const env = testEnv();
    await seed(env);
    const res = await handleRafiqExternal(new Request('https://x/v1/rafiq/external', { method: 'POST', body: JSON.stringify({ workId: 'manga:1', title: 'Top One', kind: 'manga', status: 'completed', rating: 9 }) }), new URL('https://x/v1/rafiq/external'), env, A, NOW);
    expect(res.status).toBe(200);
    let pool: string[] = [];
    const f = fake({ intent: 'recommend', format: 'MANGA' }, (p) => {
      pool = p.candidates.map((c: any) => c.id);
      return { message: 'x', cards: [] };
    });
    await events(await handleRafiqMessage(send('msg-ext-0001', 'رشح لي'), env, A, NOW + 5000, f.fetch));
    expect(pool).not.toContain('manga:1');
  });
});

describe('zero-AI answers', () => {
  const w = (title: string, progress: number, extra: Record<string, unknown> = {}) => ({ ref: `ext:${title}`, kind: 'manga', title, progress, lastAt: NOW - progress, firstAt: 0, completed: false, rating: null, favorite: false, inLibrary: true, readLater: false, feedback: null, meta: null, state: 'current', ...extra }) as any;
  it('«وين وقفت؟» from the history, «كم فصل X» only for a named work', () => {
    const works = [w('Lookism', 40, { meta: { chapters: 500, status: 'RELEASING', episodes: null } }), w('Eleceed', 12)];
    expect(statsAnswer('وين وقفت؟', works, NOW)).toContain('Eleceed (فصل 12)');
    expect(statsAnswer('وين وقفت في lookism', works, NOW)).toBe('في Lookism وصلت فصل 40 من 500.');
    expect(statsAnswer('lookism كم فصل؟', works, NOW)).toBe('Lookism: 500 فصل · مستمر — وأنت عند 40.');
    expect(statsAnswer('كم فصل في سولو ليفلنق؟', works, NOW)).toBeNull();
  });
});

describe('model router', () => {
  it('prices peak hours double and never routes to Pro on its own', () => {
    const u = { prompt_cache_hit_tokens: 1_000_000, prompt_cache_miss_tokens: 0, completion_tokens: 0 };
    const offPeak = Date.UTC(2026, 8, 26, 12); // سبت
    const peak = Date.UTC(2026, 8, 28, 7); // اثنين 07:00 UTC
    expect(isPeak(offPeak)).toBe(false);
    expect(isPeak(peak)).toBe(true);
    expect(costOf(u, 'deepseek-flash', peak)).toBeCloseTo(2 * costOf(u, 'deepseek-flash', offPeak));
    expect(route('D').model).toBe('deepseek-flash');
    expect(route('D').effort).toBe('max');
    expect(route('D', { budgetLeft: 0.1 }).effort).toBe('high');
    expect(route('B').effort).toBe('none');
  });
});
