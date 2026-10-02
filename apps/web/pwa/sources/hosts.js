/**
 * سيرفرات الفيديو المضمّنة (نسخة الويب من `hosts/Embeds.kt` في الـAPK): من
 * رابط صفحة المشغّل إلى رابط فيديو يشغّله المتصفح.
 *
 *   ok.ru            data-options ← metadata ← HLS + كل جودة MP4
 *   Google Drive     رابط التنزيل المؤكَّد (MP4 بدعم المدى)
 *   MegaMax          Inertia ← مرايا بالجودات ← كل مرآة تُحلّ هنا
 *   vk               url720/hls من الصفحة
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
      const u = m[0].startsWith('//') ? `https:${m[0]}` : m[0];
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

/**
 * @param {{ text: Function }} fetch جالب الويب (pwa/net/fetcher.js)
 */
export function createHostResolver(fetch) {
  async function page(url, referer) {
    const res = await fetch.text(url, { referer: referer ?? undefined });
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
      } catch {
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

  async function megamax(url, referer) {
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
    const mirrors = megamaxMirrors(res.text).slice(0, 6);
    // مرآتان معًا، وأول ناجحة تكفي
    for (let i = 0; i < mirrors.length; i += 2) {
      const batch = await Promise.all(
        mirrors.slice(i, i + 2).map((m) =>
          resolve(m.link, first.url, 1)
            .then((list) => list.map((s) => ({ ...s, quality: s.quality ?? m.quality, label: `megamax/${m.driver}` })))
            .catch(() => []),
        ),
      );
      const ok = batch.flat();
      if (ok.length) return ok;
    }
    return [];
  }

  /** @returns {Promise<Stream[]>} */
  async function resolve(embed, referer = null, depth = 0) {
    const url = String(embed).startsWith('//') ? `https:${embed}` : String(embed);
    const host = hostOf(url);
    if (!host) return [];
    if (host.endsWith('ok.ru') || host.endsWith('odnoklassniki.ru')) return okRuStreams((await page(url, referer)).body);
    if (host.endsWith('mega.nz') || host.endsWith('mega.co.nz')) return [];
    if (host.endsWith('drive.google.com') || host.endsWith('docs.google.com')) return googleDrive(url);
    if ((host.endsWith('share4max.com') || host.includes('megamax') || host.includes('megatuktuk')) && depth === 0) return megamax(url, referer);
    if (host.endsWith('vk.com') || host.endsWith('vkvideo.ru') || host.endsWith('vk.ru')) {
      const p = await page(url, referer);
      return vkStreams(p.body, p.url);
    }
    return generic(url, referer, depth);
  }

  return { resolve };
}
