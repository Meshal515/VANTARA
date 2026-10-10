/** Optional private browser fallback, restricted to the tested source and authenticated users. */
export interface BrowserEnv { BROWSER_FETCH_URL?: string; BROWSER_FETCH_SECRET?: string }
export async function browserFallback(env: BrowserEnv, userId: string, input: {
  url: string; method: string; body?: string | undefined; headers: Headers; follow: boolean;
}, fetchImpl: typeof fetch): Promise<{ status: number; url: string; text: string; type: string; location?: string } | null> {
  if (!env.BROWSER_FETCH_URL || !env.BROWSER_FETCH_SECRET || new URL(input.url).hostname !== 'witanime.site') return null;
  try {
    const endpoint = new URL(env.BROWSER_FETCH_URL);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return null;
    const data = new TextEncoder().encode(`${env.BROWSER_FETCH_SECRET}\0${userId}`);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const session = [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
    const headers: Record<string,string> = {};
    input.headers.forEach((value,name)=>{headers[name]=value;});
    const r = await fetchImpl(endpoint, {method:'POST', headers:{'content-type':'application/json',authorization:`Bearer ${env.BROWSER_FETCH_SECRET}`},
      body:JSON.stringify({...input, headers, session}), signal:AbortSignal.timeout(40000)});
    if (!r.ok) return null;
    const out = await r.json() as {status:number;url:string;text:string;type:string;location?:string};
    const final = new URL(out.url);
    if (final.protocol !== 'https:' || final.hostname !== 'witanime.site' || final.port || final.username || final.password ||
        !Number.isInteger(out.status) || out.status < 200 || out.status > 399 || typeof out.text !== 'string' || out.text.length > 8000000) return null;
    return out;
  } catch { return null; }
}
