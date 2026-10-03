/**
 * سيرفرات الفيديو المضمّنة (نسخة الويب من `hosts/Embeds.kt` في الـAPK): من
 * رابط صفحة المشغّل إلى رابط فيديو يشغّله المتصفح.
 *
 *   ok.ru            data-options ← metadata ← HLS + كل جودة MP4
 *   Google Drive     رابط التنزيل المؤكَّد (MP4 بدعم المدى)
 *   MegaMax          Inertia ← مرايا بالجودات ← كل مرآة تُحلّ هنا
 *   vk               url720/hls من الصفحة
 *   videa.hu         رمز `_xt` ← `/player/xml` (RC4 بمفتاح الرمز + `x-videa-xs`) ← كل جودة
 *   Dailymotion      `/player/metadata/video/<id>` ← HLS بكل الجودات (أو سبب الحذف)
 *   الباقي           الاستخراج العام: روابط m3u8/mp4 في الصفحة وكتل packer بعد فكها،
 *                    وطبقة iframe واحدة، والمرايا المعروفة (StreamHG ← vibuxer)
 *
 * لا متصفح مخفي في الويب: مشغّل يبني الرابط بسكربت حقيقي لا يُحل هنا (يُعلَن
 * «غير متاح» بصدق بدل تعليق). لا يُنفَّذ أي JavaScript من المواقع.
 */

import { attr, parseHtml, q, qa, resolve as resolveUrl } from './dom.js';

/** @typedef {{ url: string, referer: string|null, quality: number|null, label: string, type: 'hls'|'mp4' }} Stream */

const MIRRORS = new Map([['hgcloud.to', 'vibuxer.com']]);
const MEDIA = /(?:https?:)?\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?=[?#"'\s<>\\,)]|$)(?:\?[^\s"'<>\\]*)?/g;
const NOISE = /\/(ads?|vast|preroll|banner)\/|[?&](ad|vast)=|\.(jpg|jpeg|png|webp|gif)(\?|$)/i;
const IFRAME_NOISE = /youtube\.com|youtu\.be|googletagmanager|doubleclick|\/ads?\/|facebook\.com|twitter\.com/i;
const PACKED = /\}\('(.*?)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/gs;
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const typeOf = (url) => (/\.m3u8(\?|$)/i.test(url) ? 'hls' : 'mp4');
const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** فك `eval(function(p,a,c,k,e,d){…})` نصيًّا: استبدال كلمات بقاموسها، بلا تنفيذ. */
export function unpackAll(source) {
  const out = [];
  for (const m of String(source).matchAll(PACKED)) {
    const payload = m[1].replace(/\\'/g, "'");
    const base = Number(m[2]);
    const words = m[4].split('|');
    if (!(base >= 2 && base <= 62)) continue;
    out.push(
      payload.replace(/\b\w+\b/g, (w) => {
        let n = 0;
        for (const ch of w) {
          const d = ALPHABET.indexOf(ch);
          if (d < 0 || d >= base) return w;
          n = n * base + d;
        }
        return n < words.length && words[n] ? words[n] : w;
      }),
    );
  }
  return out;
}

/** روابط فيديو من صفحة مشغّل، قائمة HLS أولًا. */
export function genericStreams(html, pageUrl) {
  const found = new Set();
  for (const t of [html, ...unpackAll(html)]) {
    for (const m of String(t).replace(/\\\//g, '/').matchAll(MEDIA)) {
      // نص الصفحة الخام: الرابط داخل سمة HTML يحمل `&amp;` (sendvid: validfrom=…&amp;validto=…)
      const raw = m[0].replace(/&amp;/g, '&');
      const u = raw.startsWith('//') ? `https:${raw}` : raw;
      found.add(u.startsWith('http') ? u : resolveUrl(u, pageUrl));
    }
  }
  const doc = parseHtml(html);
  for (const el of qa(doc, 'video[src], video source[src], source[type^=video][src]')) {
    const u = resolveUrl(attr(el, 'src'), pageUrl);
    if (u.startsWith('http')) found.add(u);
  }
  return [...found].filter((u) => u.startsWith('http') && !NOISE.test(u)).sort((a, b) => (a.includes('.m3u8') ? 0 : 1) - (b.includes('.m3u8') ? 0 : 1));
}

export function firstIframe(html, pageUrl) {
  for (const el of qa(parseHtml(html), 'iframe[src]')) {
    const u = resolveUrl(attr(el, 'src'), pageUrl);
    if (u.startsWith('http') && !IFRAME_NOISE.test(u)) return u;
  }
  return null;
}

const OK_QUALITY = { mobile: 144, lowest: 240, low: 360, sd: 480, hd: 720, full: 1080, quad: 1440, ultra: 2160 };

export function okRuStreams(html) {
  const options = attr(q(parseHtml(html), '[data-options]'), 'data-options');
  if (!options) return [];
  let meta;
  try {
    const flash = JSON.parse(options).flashvars ?? {};
    meta = typeof flash.metadata === 'string' ? JSON.parse(flash.metadata) : flash.metadata;
  } catch {
    return [];
  }
  if (!meta) return [];
  const ref = 'https://ok.ru/';
  const files = (meta.videos ?? [])
    .filter((v) => String(v?.url ?? '').startsWith('http'))
    .map((v) => ({ url: v.url, referer: ref, quality: OK_QUALITY[v.name] ?? null, label: `ok.ru ${v.name}`, type: 'mp4' }))
    .sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));
  const hls = String(meta.hlsManifestUrl ?? '').startsWith('http') ? [{ url: meta.hlsManifestUrl, referer: ref, quality: null, label: 'ok.ru auto', type: 'hls' }] : [];
  return [...hls, ...files];
}

export function megamaxMirrors(body) {
  const PREFERENCE = ['mp4upload', 'earnvids', 'lulustream', 'streamhg', 'streamwish', 'mixdrop', 'krakenfiles', 'fileupload', 'voe'];
  let data;
  try {
    data = JSON.parse(body)?.props?.streams?.data ?? [];
  } catch {
    return [];
  }
  return data
    .flatMap((qItem) => {
      const quality = Number(String(qItem?.label ?? '').match(/(\d{3,4})p/)?.[1]) || null;
      return (qItem?.mirrors ?? []).filter((m) => m?.link).map((m) => ({ driver: String(m.driver ?? ''), link: m.link, quality }));
    })
    .sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0) || rank(a.driver) - rank(b.driver));
  function rank(d) {
    const i = PREFERENCE.indexOf(d);
    return i < 0 ? PREFERENCE.length : i;
  }
}

export function vkStreams(html, pageUrl) {
  const out = [];
  for (const m of String(html).matchAll(/"(url(\d{3,4})|hls)"\s*:\s*"([^"]+)"/g)) {
    const url = m[3].replace(/\\\//g, '/');
    if (!url.startsWith('http')) continue;
    const qn = Number(m[2]) || null;
    out.push({ url, referer: pageUrl, quality: qn, label: `vk ${m[1]}`, type: qn == null ? 'hls' : 'mp4' });
  }
  return [...new Map(out.map((s) => [s.url, s])).values()].sort((a, b) => (b.quality ?? 1e9) - (a.quality ?? 1e9));
}

export function googleDrive(url) {
  const m = String(url).match(/\/file\/d\/([A-Za-z0-9_-]{10,})|[?&]id=([A-Za-z0-9_-]{10,})/);
  if (!m) return [];
  const id = m[1] || m[2];
  return [{ url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, referer: null, quality: null, label: 'google drive', type: 'mp4' }];
}

// ───────────── videa.hu (نفس Videa في Wrappers.kt) ─────────────

const VIDEA_SECRET = 'xHb0ZvME5q8CBcoQi6AngerDu3FGO9fkUlwPmLVY_RTzj2hJIS4NasXWKy1td7p';

/** رمز الطلب من `_xt`: أول 16 للطلب، والباقي لمفتاح فك RC4. */
export function videaToken(html) {
  const nonce = /_xt\s*=\s*"([^"]+)"/.exec(String(html))?.[1];
  if (!nonce || nonce.length < 64) return null;
  const l = nonce.slice(0, 32);
  const s = nonce.slice(32);
  let out = '';
  for (let i = 0; i < 32; i++) {
    const k = VIDEA_SECRET.indexOf(l[i]);
    if (k < 0) return null;
    const idx = i - (k - 31);
    const ch = s[idx < 0 ? s.length + idx : idx];
    if (ch === undefined) return null;
    out += ch;
  }
  return out;
}

export function rc4(data, key) {
  const k = new TextEncoder().encode(key);
  const st = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + st[i] + k[i % k.length]) & 0xff;
    [st[i], st[j]] = [st[j], st[i]];
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + st[i]) & 0xff;
    [st[i], st[j]] = [st[j], st[i]];
    out[n] = data[n] ^ st[(st[i] + st[j]) & 0xff];
  }
  return out;
}

const fromBase64 = (b64) => Uint8Array.from(atob(String(b64).replace(/\s+/g, '')), (ch) => ch.charCodeAt(0));

/** الجودات من XML، الأعلى أولًا، بروابط موقّعة (md5 + expires). */
export function videaSources(xml, pageUrl) {
  const exp = /<video_sources[^>]*\bexp="(\d+)"/.exec(xml)?.[1];
  const out = [];
  for (const m of String(xml).matchAll(/<video_source\b([^>]*)>([^<]+)<\/video_source>/g)) {
    const a = (name) => new RegExp(`\\b${name}="([^"]*)"`).exec(m[1])?.[1];
    const name = a('name');
    if (!name) continue;
    const hash = new RegExp(`<hash_value_${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>([^<]+)<`).exec(xml)?.[1];
    const itemExp = a('exp') ?? exp;
    let url = m[2].trim().replace(/&amp;/g, '&');
    if (url.startsWith('//')) url = `https:${url}`;
    if (hash && itemExp) url += `${url.includes('?') ? '&' : '?'}md5=${hash}&expires=${itemExp}`;
    const height = Number(a('height')) || null;
    out.push({ url, referer: pageUrl, quality: height, label: 'videa', type: 'mp4' });
  }
  return out.sort((x, y) => (y.quality ?? 0) - (x.quality ?? 0));
}

// ───────────── Dailymotion ─────────────

/** معرّف الفيديو من رابط المشغّل أو الصفحة. */
export const dailymotionId = (url) => /dailymotion\.com\/(?:embed\/)?video\/([a-z0-9]+)/i.exec(url)?.[1] ?? /dai\.ly\/([a-z0-9]+)/i.exec(url)?.[1] ?? null;

/** metadata ← HLS (الجودة auto تحمل كل المستويات)؛ فيديو محذوف ⇒ خطأ بسببه. */
export function dailymotionStreams(meta) {
  if (meta?.error) {
    const e = new Error(`Dailymotion: ${meta.error.title ?? meta.error.message ?? 'غير متاح'}`);
    e.code = meta.error.code ?? 'removed';
    throw e;
  }
  const q = meta?.qualities ?? {};
  const out = [];
  for (const [label, list] of Object.entries(q)) {
    for (const v of list ?? []) {
      if (!v?.url) continue;
      const hls = /mpegurl/i.test(v.type ?? '') || /\.m3u8/.test(v.url);
      out.push({ url: v.url, referer: 'https://www.dailymotion.com/', quality: label === 'auto' ? null : Number(label) || null, label: 'dailymotion', type: hls ? 'hls' : 'mp4' });
    }
  }
  // auto (HLS بكل المستويات) أولًا، ثم الأعلى
  return out.sort((a, b) => Number(b.quality === null) - Number(a.quality === null) || (b.quality ?? 0) - (a.quality ?? 0));
}

/**
 * @param {{ text: Function }} fetch جالب الويب (pwa/net/fetcher.js)
 */
export function createHostResolver(fetch) {
  async function page(url, referer) {
    const res = await fetch.text(url, { referer: referer ?? undefined });
    const doc = parseHtml(res.text);
    qa(doc, 'script, style').forEach((node) => node.remove());
    const visible = q(doc, 'body')?.textContent || doc.documentElement?.textContent || (res.text.includes('<') ? '' : res.text);
    const removed = /^(?:\s*File was deleted\s*)$|File is no longer available as it expired or has been deleted\.|We can't find the video you are looking for\.|Video not found/i.test(visible);
    if (removed || res.status === 404 || res.status === 410) {
      const e = new Error(`${removed ? 'UPSTREAM_REMOVED: الفيديو حُذف أو انتهت صلاحيته عند المضيف' : `UPSTREAM_HTTP_${res.status}`} · ${hostOf(res.url)}`);
      e.code = removed ? 'UPSTREAM_REMOVED' : `UPSTREAM_HTTP_${res.status}`;
      e.host = hostOf(res.url);
      throw e;
    }
    return { url: res.url, body: res.text, ok: res.status >= 200 && res.status < 300 };
  }

  const fromPage = (list, pageUrl) => list.slice(0, 3).map((u) => ({ url: u, referer: pageUrl, quality: null, label: hostOf(pageUrl), type: typeOf(u) }));

  async function generic(url, referer, depth) {
    const host = hostOf(url);
    const mirror = MIRRORS.get(host);
    if (mirror) {
      try {
        const target = new URL(url);
        target.hostname = mirror;
        const p = await page(target.toString(), url);
        const found = p.ok ? genericStreams(p.body, p.url) : [];
        if (found.length) return fromPage(found, p.url);
      } catch (error) {
        if (error?.code === 'UPSTREAM_REMOVED' || error?.code === 'UPSTREAM_HTTP_410') throw error;
        // المرآة ماتت: الطريق العادي
      }
    }
    const p = await page(url, referer);
    if (!p.ok) return [];
    const found = genericStreams(p.body, p.url);
    if (found.length) return fromPage(found, p.url);
    if (depth === 0) {
      const inner = firstIframe(p.body, p.url);
      if (inner && inner !== p.url) return resolve(inner, p.url, depth + 1);
    }
    return [];
  }

  async function megamax(url, referer, onStreams) {
    const first = await page(url, referer);
    // صفحة Inertia: JSON الصفحة نص `<script data-page>` (وقيمة السمة اسم التطبيق فقط)
    const doc = parseHtml(first.body);
    const data = q(doc, 'script[data-page]')?.textContent || attr(q(doc, 'div[data-page]'), 'data-page') || '';
    let version = null;
    try {
      version = JSON.parse(data).version ?? null;
    } catch {
      version = null;
    }
    if (!version) return [];
    const res = await fetch.text(first.url, {
      referer: first.url,
      xhr: true,
      headers: {
        'x-inertia': 'true',
        'x-inertia-version': String(version),
        'x-inertia-partial-component': 'files/mirror/video',
        'x-inertia-partial-data': 'streams',
        accept: 'text/html, application/xhtml+xml',
      },
    });
    const mirrors = megamaxMirrors(res.text).slice(0, onStreams ? 20 : 6);
    // Each completed mirror starts the next; a dead peer cannot hold a ready one.
    return new Promise((settle) => {
      let next = 0, pending = 0, returned = false;
      const gathered = [];
      const start = () => {
        if (next >= mirrors.length || returned) return;
        const m = mirrors[next++];
        pending++;
        void resolve(m.link, first.url, 1).then((list) => {
          const found = list.map((s) => ({ ...s, quality: s.quality ?? m.quality, label: `megamax/${m.driver}` }));
          if (found.length && !returned) {
            gathered.push(...found);
            if (onStreams) onStreams(found);
            else { returned = true; settle(found); }
          }
        }).catch(() => {}).finally(() => {
          pending--;
          start();
          if (!pending && next >= mirrors.length && !returned) {
            returned = true;
            settle([...new Map(gathered.map((s) => [s.url, s])).values()]);
          }
        });
      };
      start(); start();
      if (!mirrors.length) settle([]);
    });
  }

  async function videa(url, referer) {
    const p = await page(url, referer);
    const token = videaToken(p.body);
    const v = (() => {
      try {
        return new URL(p.url).searchParams.get('v') ?? new URL(url).searchParams.get('v');
      } catch {
        return null;
      }
    })();
    if (!token || !v) return [];
    const seed = Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
    const res = await fetch.text(`https://videa.hu/player/xml?v=${encodeURIComponent(v)}&_s=${seed}&_t=${token.slice(0, 16)}`, { referer: p.url });
    let xml = res.text;
    if (!xml.trimStart().startsWith('<?xml')) {
      // XML مشفّر: المفتاح من الرمز + البذرة + رأس x-videa-xs (يمرّره الجالب)
      const xs = res.headers?.['x-videa-xs'];
      if (!xs) return [];
      xml = new TextDecoder().decode(rc4(fromBase64(xml), token.slice(16) + seed + xs));
    }
    // «Törölt videó!» وأمثالها: المضيف حذف الفيديو، يُقال كذلك لا «فارغ»
    const error = /<error\b[^>]*>([^<]+)</.exec(xml)?.[1]?.trim();
    const list = videaSources(xml, p.url);
    if (!list.length && error) throw new Error(`Videa: ${/törölt|deleted|removed/i.test(error) ? 'الفيديو محذوف عند المضيف' : error}`);
    return list;
  }

  /** @returns {Promise<Stream[]>} */
  async function resolve(embed, referer = null, depth = 0, onStreams = null) {
    const url = String(embed).startsWith('//') ? `https:${embed}` : String(embed);
    const host = hostOf(url);
    if (!host) return [];
    if (host.endsWith('ok.ru') || host.endsWith('odnoklassniki.ru')) return okRuStreams((await page(url, referer)).body);
    if (host.endsWith('mega.nz') || host.endsWith('mega.co.nz')) return [];
    if (host.endsWith('drive.google.com') || host.endsWith('docs.google.com')) return googleDrive(url);
    if ((host === 'share4max.net' || host.endsWith('share4max.com') || host.includes('megamax') || host.includes('megatuktuk')) && depth === 0) return megamax(url, referer, onStreams);
    if (host.endsWith('videa.hu')) return videa(url, referer);
    if (host.endsWith('dailymotion.com') || host === 'dai.ly') {
      const id = dailymotionId(url);
      if (!id) return [];
      const res = await fetch.text(`https://www.dailymotion.com/player/metadata/video/${id}`, { referer: 'https://www.dailymotion.com/', headers: { accept: 'application/json' } });
      return dailymotionStreams(JSON.parse(res.text));
    }
    if (host.endsWith('vk.com') || host.endsWith('vkvideo.ru') || host.endsWith('vk.ru')) {
      const p = await page(url, referer);
      return vkStreams(p.body, p.url);
    }
    return generic(url, referer, depth);
  }

  return { resolve };
}
