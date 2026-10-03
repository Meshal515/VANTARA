/**
 * جالب الويب الحقيقي (Cloudflare) لأدوات القياس، بتوكن هوية مؤقت يُصكّ من سرّ
 * النشر لمستخدم وهمي — أي ما يراه متصفح الـPWA بالضبط. للـCI فقط.
 */
import { mintIdentityToken } from '../../packages/domain/dist/index.js';
import { createFetcher } from '../../apps/web/pwa/net/fetcher.js';

export const EDGE_BASE = process.env.FETCH_BASE ?? 'https://vantara-fetch.ngm-309.workers.dev';

export async function edgeFetcher({ deviceId = 'edge-matrix' } = {}) {
  const secret = process.env.VANTARA_IDENTITY_SECRET;
  if (!secret) throw new Error('VANTARA_IDENTITY_SECRET مطلوب');
  const user = { userId: '00000000-0000-4000-8000-0000000ed9e0', deviceId };
  let token = await mintIdentityToken(user, secret);
  const memory = new Map();
  const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };
  return createFetcher({
    auth: { header: () => `Bearer ${token}`, refresh: async () => { token = await mintIdentityToken(user, secret); } },
    base: () => EDGE_BASE,
    storage,
  });
}
