/**
 * جالب حيّ للتجربة من الطرفية (لا CI): نفس واجهة `pwa/net/fetcher.js`
 * (text/page/json) لكنه يطلب المواقع مباشرة عبر curl بنفس ترويسات الجالب.
 * يُستعمل في `tools/pwa/probe.mjs` لفحص محركات المصادر على المواقع الحقيقية.
 */
import { execFileSync } from 'node:child_process';
import { DOMParser } from 'linkedom';
import { setParser } from '../../apps/web/pwa/sources/dom.js';

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

export function useLinkedom() {
  setParser((html, type = 'text/html') => new DOMParser().parseFromString(html, type));
}

export class LiveError extends Error {
  constructor(code, info = {}) {
    super(info.message ?? code);
    this.code = code;
    Object.assign(this, info);
  }
}

export function liveFetcher({ log = () => {} } = {}) {
  const jar = new Map();
  function text(url, opts = {}) {
    const args = ['-s', ...(opts.follow === false ? [] : ['-L', '--max-redirs', '6']), '-m', '30', '-A', UA, '-H', 'Accept-Language: ar,en;q=0.8', '-D', '-', '-o', '-', '-w', '\n__VF__%{http_code} %{url_effective}'];
    const headers = { ...(opts.headers ?? {}) };
    if (opts.referer) headers.referer = opts.referer;
    if (opts.xhr) headers['x-requested-with'] = 'XMLHttpRequest';
    let body = opts.body;
    if (opts.form) {
      body = new URLSearchParams(Object.entries(opts.form).map(([k, v]) => [k, String(v)])).toString();
      headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
    const host = new URL(url).hostname.split('.').slice(-2).join('.');
    if (jar.get(host)) args.push('-H', `Cookie: ${jar.get(host)}`);
    const method = opts.method ?? (body !== undefined ? 'POST' : 'GET');
    if (method === 'POST') args.push('-X', 'POST', '--data-binary', body ?? '');
    args.push(url);
    const started = Date.now();
    const out = execFileSync('curl', args, { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
    const marker = out.lastIndexOf('\n__VF__');
    const [code, finalUrl] = out.slice(marker + 7).trim().split(' ');
    let rest = out.slice(0, marker);
    // ترويسات كل قفزة ثم الجسم: آخر كتلة ترويسات قبل الجسم
    let headerBlock = '';
    while (/^HTTP\/[\d.]+ \d+/.test(rest)) {
      const end = rest.indexOf('\r\n\r\n');
      headerBlock = rest.slice(0, end);
      rest = rest.slice(end + 4);
    }
    const cookies = [...headerBlock.matchAll(/^set-cookie:\s*([^;\r\n]+)/gim)].map((m) => m[1]);
    if (cookies.length) jar.set(host, [jar.get(host), ...cookies].filter(Boolean).join('; '));
    const status = Number(code);
    const challenge = [403, 503, 429].includes(status) && /just a moment|cf-chl|challenge-platform/i.test(rest) ? 'js' : 'none';
    log(`${method} ${url} → ${status} ${Date.now() - started}ms`);
    if (challenge !== 'none' && !opts.allowChallenge) throw new LiveError('challenge', { status, challenge });
    const location = headerBlock.match(/^location:\s*(\S+)/im)?.[1] ?? null;
    return Promise.resolve({ status, url: finalUrl, text: rest, challenge, location: location ? new URL(location, finalUrl).toString() : null });
  }
  async function page(url, opts = {}) {
    const out = await text(url, opts);
    if (out.status < 200 || out.status >= 300) throw new LiveError('http', { status: out.status, message: `HTTP ${out.status} ${url}` });
    return out;
  }
  async function json(url, opts = {}) {
    return JSON.parse((await page(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers ?? {}) } })).text);
  }
  return { text, page, json, mediaUrl: (u) => u, ensureGrant: async () => '' };
}
