import { describe, expect, it } from 'vitest';
import { sqliteEnv } from './test-d1.ts';
import { handleTranslateTextBatch } from './translation-batch.ts';

const user = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const page = (index: number, source = `Page ${index}`) => ({
  pageHash: String(index+1).repeat(64),
  seriesRef: 'ext:work',
  chapterKey: 'work#1',
  pageIndex: index,
  sourceLang: 'en',
  image: { mediaType: 'image/jpeg', data: 'AAAA', width: 800, height: 1200 },
  regions: [{ id: 'same_id', source, kind: 'speech', box: [10,10,100,100] }],
});
const req = (pages: unknown[]) => new Request('https://sync.test/v1/translate/text-batch',{ method: 'POST', body: JSON.stringify({ pages }) });
const setup = () => sqliteEnv({ OPENAI_API_KEY: 'test-key' });

const translatedPage = (index: number) => ({
  pageKey:`p${index}`,
  translation:{
    regions:[{ id:'same_id', source:`Page ${index}`, kind:'speech', arabic:`صفحة ${index}`, speaker:null }],
    summary:'',
    new_terms:[],
    characters:[],
  },
});

describe('adaptive multi-page Luna requests', () => {
  it('isolates identical region ids and stores actual aggregate cost, using one model call', async () => {
    const { env } = setup(); let calls=0;
    const fetcher: typeof fetch = async (_url, init) => {
      calls++;
      const body=JSON.parse(String(init?.body));
      expect(body.input[0].content.filter((c: { type: string }) => c.type==='input_image')).toHaveLength(2);
      return Response.json({ status: 'completed', model: 'gpt-6-luna', usage: { input_tokens: 101, output_tokens: 51 }, output: [{ type:'message', content:[{ type:'output_text', text:JSON.stringify({ pages:[0,1].map(translatedPage) }) }] }] });
    };
    const response = await handleTranslateTextBatch(req([page(0),page(1)]),env,user,Date.UTC(2026,9,5),{ fetch:fetcher });
    const body=await response.json() as { pages: Array<{ pageHash: string; status: number; body: { regions: Array<{ arabic: string }>; perf?: {providerNetworkMs?:number} } }> };
    expect(calls).toBe(1);
    expect(body.pages.map(p=>p.body.regions[0]?.arabic)).toEqual(['صفحة 0','صفحة 1']);
    expect(body.pages.map(p=>p.pageHash)).toEqual([page(0).pageHash,page(1).pageHash]);
    const spend=await env.DB.prepare('SELECT usd,reserved FROM translation_spend').first<{usd:number;reserved:number}>();
    expect(spend?.usd).toBeCloseTo((101*.1+51*.5)/1e6,12); expect(spend?.reserved).toBe(0);
  });

  it('accepts six light pages and coalesces them into one provider call',async()=> {
    const {env}=setup();let calls=0;
    const fetcher: typeof fetch=async(_url,init)=>{
      calls++;
      const body=JSON.parse(String(init?.body));
      expect(body.input[0].content.filter((c:{type:string})=>c.type==='input_image')).toHaveLength(6);
      return Response.json({status:'completed',model:'gpt-6-luna',usage:{input_tokens:600,output_tokens:300},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({pages:Array.from({length:6},(_,i)=>translatedPage(i))})}]}]});
    };
    const response=await handleTranslateTextBatch(req(Array.from({length:6},(_,i)=>page(i))),env,user,Date.UTC(2026,9,5),{fetch:fetcher});
    const body=await response.json() as {pages:Array<{status:number}>};
    expect(response.status).toBe(200);expect(body.pages.every(p=>p.status===200)).toBe(true);expect(calls).toBe(1);
  });

  it('rejects cross-work, cross-chapter, cross-mode and oversized batches before billing', async () => {
    const { env } = setup();
    for (const field of ['seriesRef','chapterKey','speed']) {
      const response=await handleTranslateTextBatch(req([page(0),{...page(1),[field]:'different'}]),env,user,Date.now());
      expect(response.status).toBe(400);
    }
    expect((await handleTranslateTextBatch(req(Array.from({length:7},(_,i)=>page(i))),env,user,Date.now())).status).toBe(400);
    expect((await handleTranslateTextBatch(req([page(0),page(0)]),env,user,Date.now())).status).toBe(400);
    expect(await env.DB.prepare('SELECT 1 FROM translation_spend').first()).toBeNull();
  });

  it('rejects text-heavy batches by source chars or estimated tokens before provider work',async()=> {
    const {env}=setup();let calls=0;
    const fetcher:typeof fetch=async()=>{calls++;return Response.json({});};
    const chars=await handleTranslateTextBatch(req([page(0,'A'.repeat(4000)),page(1,'B'.repeat(4000))]),env,user,Date.now(),{fetch:fetcher});
    expect(chars.status).toBe(400);
    const tokens=await handleTranslateTextBatch(req([page(2,'日'.repeat(1500)),page(3,'本'.repeat(1500))]),env,user,Date.now(),{fetch:fetcher});
    expect(tokens.status).toBe(400);
    expect(calls).toBe(0);
  });

  it('retains successful pages and records cost even for malformed paid results', async () => {
    const { env } = setup(); let calls=0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return Response.json({ status:'completed', usage:{input_tokens:100,output_tokens:100}, output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({pages:[{pageKey:'p0',translation:{regions:[{id:'same_id',source:'Page 0',kind:'speech',arabic:'نجاح',speaker:null}],summary:'',new_terms:[],characters:[]}}]})}]}] });
    };
    const response=await handleTranslateTextBatch(req([page(0),page(1)]),env,user,Date.UTC(2026,9,5),{fetch:fetcher});
    const body=await response.json() as {pages:Array<{status:number}>};
    expect(body.pages[0]?.status).toBe(200);expect(body.pages[1]?.status).toBe(502);expect(calls).toBe(1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM translation_pages').first<{n:number}>())?.n).toBe(1);
    expect((await env.DB.prepare('SELECT usd FROM translation_spend').first<{usd:number}>())?.usd).toBeCloseTo(.00006,12);
  });
});

it('earlier chapter pages win glossary even when a later HTTP batch completes first',async()=> {
  const {env}=setup();let release: ()=>void=()=>{};
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  const fetcher: typeof fetch=async(_url,init)=> {
    const body=JSON.parse(String(init?.body));
    const text=JSON.stringify(body.input);
    const early=text.includes('Page 0');
    if(early) await waiting;
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({regions:[{id:'same_id',source:'Page',kind:'speech',arabic:'نجاح',speaker:null}],summary:'',new_terms:[{term:'Name',arabic:early?'الأول':'الثاني',kind:'name'}],characters:[{name:'Name',arabic:early?'الأول':'الثاني',gender:'male'}]})}]}]});
  };
  const early=handleTranslateTextBatch(req([page(0)]),env,user,Date.UTC(2026,9,5),{fetch:fetcher});
  await handleTranslateTextBatch(req([page(1)]),env,user,Date.UTC(2026,9,5),{fetch:fetcher});
  release();await early;
  expect((await env.DB.prepare("SELECT arabic FROM translation_terms WHERE term='Name'").first<{arabic:string}>())?.arabic).toBe('الأول');
  expect((await env.DB.prepare("SELECT arabic FROM translation_characters WHERE name='Name'").first<{arabic:string}>())?.arabic).toBe('الأول');
});

it('charges aggregate cost even when a paid page array contains null',async()=> {
  const {env}=setup();
  const fetcher: typeof fetch=async()=>Response.json({status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:'{"pages":[null]}'}]}]});
  const response=await handleTranslateTextBatch(req([page(0),page(1)]),env,user,Date.UTC(2026,9,5),{fetch:fetcher});
  const body=await response.json() as {pages:Array<{status:number}>};
  expect(body.pages.map(p=>p.status)).toEqual([502,502]);
  expect((await env.DB.prepare('SELECT usd FROM translation_spend').first<{usd:number}>())?.usd).toBeCloseTo(.00006,12);
});

it('isolates one failed page transaction and releases its paid reservation',async()=> {
  const {env}=setup(); const batch=env.DB.batch.bind(env.DB); let failed=false;
  env.DB.batch=async statements=> {
    if (!failed && statements.some(s=>(s as unknown as {sql:string;values:unknown[]}).sql.includes('INSERT INTO translation_pages') && (s as unknown as {values:unknown[]}).values[0]===page(1).pageHash)) { failed=true;throw new Error('storage unavailable'); }
    return batch(statements);
  };
  const fetcher: typeof fetch=async()=>Response.json({status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({pages:[0,1].map(i=>({pageKey:`p${i}`,translation:{regions:[{id:'same_id',source:'Hello',kind:'speech',arabic:'مرحبا',speaker:null}],summary:'',new_terms:[],characters:[]}}))})}]}]});
  const result=await handleTranslateTextBatch(req([page(0),page(1)]),env,user,Date.UTC(2026,9,5),{fetch:fetcher});
  const body=await result.json() as {pages:Array<{status:number}>};
  expect(body.pages.map(p=>p.status)).toEqual([200,503]);
  const spend=await env.DB.prepare('SELECT usd,reserved FROM translation_spend').first<{usd:number;reserved:number}>();
  expect(spend?.reserved).toBe(0);expect(spend?.usd).toBeCloseTo(.00006,12);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM translation_pages').first<{n:number}>())?.n).toBe(1);
});
