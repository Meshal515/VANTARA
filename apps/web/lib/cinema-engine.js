/** Cinema has its own manifest; the native engine merges content namespaces. */
import { groupRoutes, upsertRoute, clock, on } from './anime-engine.js';
export { groupRoutes, upsertRoute, clock, on };
const bridge = () => globalThis.Capacitor?.Plugins?.AnimeEngine ?? null;
export const available = () => Boolean(bridge());
let pending;
export function configure({ force = false, fetchImpl = globalThis.fetch } = {}) {
  if (!available()) return Promise.resolve(null);
  if (pending && !force) return pending;
  pending = (async () => {
    const response = await fetchImpl('/cinema/sources.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('تعذّر قراءة مصادر السينما');
    const manifest = await response.json();
    const result = await bridge().configure({ manifest, content: 'cinema' });
    if (!result?.ok) throw new Error((result?.errors ?? ['المصادر غير متاحة']).join('، '));
    return manifest;
  })().catch((error) => { pending = null; throw error; });
  return pending;
}
async function call(method, args = {}) {
  if (!available()) return null;
  await configure();
  return bridge()[method](args);
}
export async function page(sourceId, listing = 'popular', pageNumber = 1, query = '') {
  return (await call('page', { sourceId, listing, page: pageNumber, query }))?.page ?? null;
}
export async function details(anime) { return (await call('details', { anime }))?.anime ?? anime; }
export async function seasons(anime) { return (await call('seasons', { anime }))?.seasons ?? []; }
export async function episodes(anime) { return (await call('episodes', { anime }))?.episodes ?? []; }
export async function prepare(args) { return call('prepare', args); }
export async function routes(session) { return call('routes', { session }); }
export async function best(session, prefer = null) { return call('best', { session, prefer, waitMs: 45_000 }); }
export async function pick(session, route) { return (await call('pick', { session, route }))?.candidate ?? null; }
export async function open(args) { return call('play', args); }
export async function closeSession(session) { return call('closeSession', { session }); }
