import { handleTranslateText, TEXT_OUTPUT_SCHEMA, type TranslationEnv, type TranslateDeps } from './translate.ts';
import type { D1PreparedStatement } from './types.ts';

const response = (body: unknown, status=200) => Response.json(body,{status});
type Raw = Record<string, unknown>;
const object = (v: unknown): v is Raw => Boolean(v && typeof v==='object' && !Array.isArray(v));
const SOURCE_LANGS = new Set(['en','ja','ko','zh','auto']);
const semanticLang = (page: Raw) => typeof page.sourceLang==='string' && SOURCE_LANGS.has(page.sourceLang) ? page.sourceLang : 'auto';
const semanticMode = (page: Raw) => page.speed==='fast' ? 'fast' : 'quality';

export const LUNA_BATCH_LIMITS = Object.freeze({
  maxPages: 6,
  maxRegions: 48,
  maxSourceChars: 7_000,
  maxSourceTokens: 2_600,
  maxEncodedBytes: 6_000_000,
  providerAssemblyMs: 30,
});

function sourceBudget(raw: unknown): { chars: number; tokens: number } {
  if (!Array.isArray(raw)) return {chars:0,tokens:0};
  let chars=0,ascii=0,nonAscii=0;
  for (const item of raw) {
    if (!object(item) || typeof item.source!=='string') continue;
    chars+=item.source.length;
    for (const char of item.source) {
      if ((char.codePointAt(0) ?? 0) <= 0x7f) ascii++;
      else nonAscii++;
    }
  }
  return {chars,tokens:Math.max(0,Math.ceil(ascii/4+nonAscii*1.25))};
}

function timedResponse(source: Response, providerNetworkMs: number, batchWaitMs: number): Response {
  const headers=new Headers(source.headers);
  headers.set('x-vantara-luna-provider-ms',String(Math.max(0,Math.round(providerNetworkMs))));
  headers.set('x-vantara-luna-batch-wait-ms',String(Math.max(0,Math.round(batchWaitMs))));
  return new Response(source.body,{status:source.status,statusText:source.statusText,headers});
}

/** Reference single-page handler still owns cache, claims, quotas, correction and persistence. */
export async function handleTranslateTextBatch(request: Request, env: TranslationEnv, userId: string, now: number, deps: TranslateDeps = {}): Promise<Response> {
  const encoded=await request.text();
  if (encoded.length>LUNA_BATCH_LIMITS.maxEncodedBytes) return response({error:'batch_too_large'},413);
  let raw: unknown;
  try { raw=JSON.parse(encoded); } catch { return response({error:'bad_batch'},400); }
  if (!object(raw) || !Array.isArray(raw.pages) || !raw.pages.length || raw.pages.length>LUNA_BATCH_LIMITS.maxPages || !raw.pages.every(object)) return response({error:'bad_batch'},400);

  const pages=raw.pages as Raw[];
  const first=pages[0]!;
  const hashes=new Set<string>(), indices=new Set<number>();
  let regions=0, sourceChars=0, sourceTokens=0;
  for (const p of pages) {
    if (typeof p.pageHash!=='string' || !/^[a-f0-9]{64}$/.test(p.pageHash) || hashes.has(p.pageHash) || !Number.isInteger(p.pageIndex) || Number(p.pageIndex)<0 || indices.has(Number(p.pageIndex)) || !Array.isArray(p.regions) || !object(p.image)) return response({error:'bad_batch'},400);
    if (p.seriesRef!==first.seriesRef || p.chapterKey!==first.chapterKey || semanticLang(p)!==semanticLang(first) || semanticMode(p)!==semanticMode(first) || !first.seriesRef || !first.chapterKey) return response({error:'mixed_batch_identity'},400);
    hashes.add(p.pageHash);
    indices.add(Number(p.pageIndex));
    regions+=p.regions.length;
    const budget=sourceBudget(p.regions);
    sourceChars+=budget.chars;
    sourceTokens+=budget.tokens;
  }
  if (regions>LUNA_BATCH_LIMITS.maxRegions) return response({error:'batch_too_many_regions'},400);
  if (sourceChars>LUNA_BATCH_LIMITS.maxSourceChars) return response({error:'batch_too_many_source_chars'},400);
  if (sourceTokens>LUNA_BATCH_LIMITS.maxSourceTokens) return response({error:'batch_too_many_source_tokens'},400);

  const upstream=deps.fetch ?? fetch;
  type Pending={
    body: Raw;
    url: Parameters<typeof fetch>[0];
    init: RequestInit | undefined;
    queuedAt: number;
    resolve: (response: Response)=>void;
    reject: (error: unknown)=>void;
  };
  let pending: Pending[]=[];
  let timer: ReturnType<typeof setTimeout> | null=null;

  const flush=async () => {
    if (timer) clearTimeout(timer);
    timer=null;
    const group=pending;
    pending=[];
    if (!group.length) return;

    const dispatchedAt=Date.now();
    if (group.length===1) {
      const entry=group[0]!;
      const providerStarted=Date.now();
      try {
        const result=await upstream(entry.url,entry.init);
        entry.resolve(timedResponse(result,Date.now()-providerStarted,dispatchedAt-entry.queuedAt));
      } catch(error) {
        entry.reject(error);
      }
      return;
    }

    const keys=group.map((_,i)=>`p${i}`);
    const body={...group[0]!.body};
    body.instructions=String(body.instructions)+'\nThis request contains independent labelled pages. Return pages with pageKey and translation. Never merge regions across pages, even when their region IDs match. Each translation uses the same region contract. Respect page boundaries and reading order.';
    const content=group.flatMap((entry,i)=>[
      {type:'input_text',text:`PAGE ${keys[i]} — all following image/text content belongs only to this page.`},
      ...(entry.body.input as Array<{content: unknown[]}>)[0]!.content,
    ]);
    body.input=[{role:'user',content}];
    body.text={format:{type:'json_schema',name:'chapter_page_translations',strict:true,schema:{type:'object',additionalProperties:false,required:['pages'],properties:{pages:{type:'array',items:{type:'object',additionalProperties:false,required:['pageKey','translation'],properties:{pageKey:{type:'string',enum:keys},translation:TEXT_OUTPUT_SCHEMA}}}}}}};
    body.max_output_tokens=24000;

    const providerStarted=Date.now();
    try {
      const result=await upstream(group[0]!.url,{...group[0]!.init,body:JSON.stringify(body)});
      const providerNetworkMs=Date.now()-providerStarted;
      if (!result.ok) {
        for (const entry of group) entry.resolve(timedResponse(result.clone(),providerNetworkMs,dispatchedAt-entry.queuedAt));
        return;
      }
      const payload=await result.json() as Raw;
      const output=(Array.isArray(payload.output)?payload.output:[]) as Array<{type?:string;content?:Array<{type?:string;text?:string}>}>;
      const text=output.filter(o=>o.type==='message').flatMap(o=>o.content ?? []).find(c=>c.type==='output_text')?.text ?? '';
      let translated: Array<{pageKey?:string;translation?:unknown}>=[];
      try {
        const parsed=JSON.parse(text);
        if(Array.isArray(parsed.pages)) translated=parsed.pages;
      } catch {
        /* Each failed page still receives its incurred usage. */
      }
      const usage=object(payload.usage)?payload.usage:{};
      // Partition integers exactly; sum of recorded page token costs equals the actual aggregate cost.
      const share=(value:unknown,i:number) => {
        const n=typeof value==='number' && Number.isFinite(value) ? Math.max(0,Math.floor(value)):0;
        return Math.floor(n/group.length)+(i<n%group.length?1:0);
      };
      group.forEach((entry,i)=> {
        const matches=translated.filter(p=>object(p) && p.pageKey===keys[i]);
        const perUsage={
          input_tokens:share(usage.input_tokens,i),
          output_tokens:share(usage.output_tokens,i),
          input_tokens_details:{cached_tokens:share(object(usage.input_tokens_details)?usage.input_tokens_details.cached_tokens:0,i)},
        };
        const refused=output.some(o=>(o.content ?? []).some(c=>c.type==='refusal'));
        const perOutput=matches.length===1 && object(matches[0]!.translation) ? JSON.stringify(matches[0]!.translation) : '';
        const perPage=response({...payload,usage:perUsage,output:refused ? payload.output : [{type:'message',content:[{type:'output_text',text:perOutput}]}]});
        entry.resolve(timedResponse(perPage,providerNetworkMs,dispatchedAt-entry.queuedAt));
      });
    } catch(error) {
      for(const entry of group) entry.reject(error);
    }
  };

  const batchedFetch: typeof fetch = async (url,init) => new Promise<Response>((resolve,reject)=> {
    const body=JSON.parse(String(init?.body)) as Raw;
    pending.push({url,init,body,queuedAt:Date.now(),resolve,reject});
    // All pages in this HTTP batch are already admitted by source budgets. When
    // every logical page reaches the provider barrier, dispatch immediately;
    // otherwise a short hard window catches cache/memory timing skew.
    if(pending.length>=Math.min(LUNA_BATCH_LIMITS.maxPages,pages.length)) void flush();
    else if(!timer) timer=setTimeout(()=>void flush(),LUNA_BATCH_LIMITS.providerAssemblyMs);
  });

  const memory=new Map<number,D1PreparedStatement[]>();
  const results=await Promise.all(pages.map(async page=> {
    const request=new Request('https://internal/v1/translate/text',{method:'POST',body:JSON.stringify(page)});
    try {
      const result=await handleTranslateText(request,env,userId,now,{
        ...deps,
        fetch:batchedFetch,
        deferMemory:(index,statements)=>memory.set(index,statements),
      });
      return {pageHash:page.pageHash,pageIndex:page.pageIndex,status:result.status,body:await result.json()};
    } catch {
      return {pageHash:page.pageHash,pageIndex:page.pageIndex,status:503,body:{error:'storage_failed'}};
    }
  }));

  const ordered=[...memory].sort(([a],[b])=>a-b).flatMap(([,statements])=>statements);
  let memorySaved=true;
  if (ordered.length) {
    try { await env.DB.batch(ordered); }
    catch { memorySaved=false; }
  }
  return response({
    pages:results,
    perf:{
      pages:pages.length,
      regions,
      sourceChars,
      sourceTokens,
    },
    ...(!memorySaved ? {memorySaved:false}: {}),
  });
}
