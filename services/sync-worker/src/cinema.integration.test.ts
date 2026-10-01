import { describe, expect, it } from 'vitest';
import { DAILY_NEW, handleCinemaOverviews, type CinemaEnv } from './cinema.ts';
import { sqliteEnv } from './test-d1.ts';

/**
 * السؤال: هل تُترجم القصة مرة واحدة لكل نص وتُخدم بعدها للجميع بلا نداء؟ وهل
 * تغيّر النص يعيد ترجمته؟ وهل يرجع الإنجليزي إن تعطّل المترجم بدل نجاح مزيّف؟
 */
const A = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const B = '1b7d0c2e-6a1f-4e8b-9d3c-5f2a7e9b0c41';
const NOW = Date.UTC(2026, 9, 1, 12);

function env() {
  const { env } = sqliteEnv({ VANTARA_SESSION_SECRET: 'x'.repeat(40), VANTARA_IDENTITY_SECRET: 'y'.repeat(40), VANTARA_DEVICE_PEPPER: 'z'.repeat(40) } as never);
  const e = env as CinemaEnv;
  e.DEEPSEEK_API_KEY = 'k';
  return e;
}
function fakeLlm(answer: (keys: string[]) => Record<string, string>) {
  const calls: string[][] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
    const keys = Object.keys(JSON.parse(payload.messages[1]!.content) as Record<string, string>);
    calls.push(keys);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ t: answer(keys) }) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }));
  }) as typeof fetch;
  return { impl, calls };
}
const ask = (items: unknown) => new Request('https://x/v1/cinema/overviews', { method: 'POST', body: JSON.stringify({ items }) });
const read = async (res: Response) => (await res.json()) as { overviews: Record<string, string>; pending?: string[]; reason?: string };

describe('قصص السينما بالعربية', () => {
  it('translates once, then serves every account from the cache', async () => {
    const e = env();
    const llm = fakeLlm((keys) => Object.fromEntries(keys.map((k) => [k, `قصة ${k}`])));
    const items = [{ key: 'tt1375666', text: 'A thief who steals corporate secrets through dreams.' }, { key: 'tt0944947:1:1', text: 'Lord Stark is troubled by reports from the Night Watch.' }];
    const first = await read(await handleCinemaOverviews(ask(items), e, A, NOW, llm.impl));
    expect(first.overviews).toEqual({ tt1375666: 'قصة tt1375666', 'tt0944947:1:1': 'قصة tt0944947:1:1' });
    const second = await read(await handleCinemaOverviews(ask(items), e, B, NOW + 1000, llm.impl));
    expect(second.overviews).toEqual(first.overviews);
    expect(llm.calls).toHaveLength(1);
  });

  it('a changed source text is translated again; bad keys and short texts are ignored', async () => {
    const e = env();
    let n = 0;
    const llm = fakeLlm((keys) => Object.fromEntries(keys.map((k) => [k, `نسخة ${++n}`])));
    await handleCinemaOverviews(ask([{ key: 'tt1', text: 'First version of the plot summary.' }]), e, A, NOW, llm.impl);
    const out = await read(await handleCinemaOverviews(ask([{ key: 'tt1', text: 'Second, corrected plot summary.' }, { key: 'kitsu:1', text: 'Not an IMDb work at all.' }, { key: 'tt2', text: 'short' }]), e, A, NOW, llm.impl));
    expect(out.overviews).toEqual({ tt1: 'نسخة 2' });
    expect(llm.calls).toEqual([['tt1'], ['tt1']]);
  });

  it('no fake success: English echoes are not stored, and a down model says so', async () => {
    const e = env();
    const echo = fakeLlm((keys) => Object.fromEntries(keys.map((k) => [k, 'A thief who steals secrets.'])));
    const out = await read(await handleCinemaOverviews(ask([{ key: 'tt3', text: 'A thief who steals secrets.' }]), e, A, NOW, echo.impl));
    expect(out.overviews).toEqual({});
    const down = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    const failed = await read(await handleCinemaOverviews(ask([{ key: 'tt3', text: 'A thief who steals secrets.' }]), e, A, NOW, down));
    expect(failed).toMatchObject({ overviews: {}, pending: ['tt3'], reason: 'upstream' });
  });

  it('caps new translations per account per day', async () => {
    const e = env();
    const rows = Array.from({ length: DAILY_NEW }, (_, i) => e.DB.prepare('INSERT INTO cinema_overviews (key, source_hash, text_ar, created_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(`tt9${i}`, 'h', 'ع', A, NOW - 1000));
    await e.DB.batch(rows);
    const llm = fakeLlm(() => ({}));
    const out = await read(await handleCinemaOverviews(ask([{ key: 'tt77', text: 'Something new to translate today.' }]), e, A, NOW, llm.impl));
    expect(out).toMatchObject({ pending: ['tt77'], reason: 'daily_limit' });
    expect(llm.calls).toHaveLength(0);
  });
});
