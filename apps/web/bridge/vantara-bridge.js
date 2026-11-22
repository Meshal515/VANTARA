// جسر فانتارا الخاص — انشره في حسابك على Cloudflare Workers.
// 1) أنشئ Worker جديدًا وألصق هذا الملف كاملًا مكان الكود الافتراضي ثم انشره.
// 2) في إعدادات الـWorker: أضف سرًّا (Secret) باسم VANTARA_BRIDGE_KEY وقيمته مفتاح طويل (24 حرفًا فأكثر).
// 3) في فانتارا: الإعدادات ← جسر الويب: ألصق رابط الـWorker والمفتاح نفسه.
// المحتوى يمر عبر حسابك أنت، لا عبر خادم فانتارا. الرخصة: AGPL-3.0-only (مستودع فانتارا).
// packages/domain/src/presence.ts
var HEARTBEAT_INTERVAL_MS = 25e3;
var MAX_BEAT_CREDIT_MS = HEARTBEAT_INTERVAL_MS * 2;

// packages/domain/src/media-token.ts
var MAX_MEDIA_TOKEN_TTL_MS = 10 * 6e4;
var DEFAULT_MEDIA_TOKEN_TTL_MS = 5 * 6e4;

// packages/domain/src/downloads.ts
var DEFAULT_MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

// packages/domain/src/diagnostics.ts
var REDACTED = "[redacted]";
var SECRET_IN_TEXT = [
  [/\buy_[A-Za-z0-9._-]{8,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9._-]{16,}/g, REDACTED],
  [/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, REDACTED],
  [/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, REDACTED],
  // توقيع رابط الصفحة: `?t=<hmac>`.
  //
  // هذا الرابط يفتح الصفحة بلا جلسة ولا ترويسة — هذا قصده. ومفتاحه `t` لا
  // يُشبه سرًّا، وقيمته سداسية بلا نقاط فلا يمسكها نمط JWT. وبلاغ «صفحة
  // ناقصة» يحمل رابط الصفحة بطبيعته، فكانت قدرةُ الفتح تُخزَّن في جدول
  // البلاغات. القيمة وحدها تُشطب ويبقى المفتاح والمسار، وهو ما يفيد التشخيص.
  [/([?&](?:t|sig|signature|token)=)[A-Za-z0-9._%-]{16,}/gi, `$1${REDACTED}`]
];

// packages/domain/src/sync.ts
var MAX_USAGE_OP_MS = 15 * 6e4;

// packages/domain/src/identity-token.ts
var TOKEN_VERSION = 2;
var ACCESS_TTL_MS = 15 * 60 * 1e3;
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function base64UrlDecode(value) {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
function validString(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}
function parseClaims(bytes) {
  try {
    const value = JSON.parse(decoder.decode(bytes));
    if (value.v !== TOKEN_VERSION || !validString(value.uid) || !validString(value.did) || typeof value.iat !== "number" || typeof value.exp !== "number" || !Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp) || value.iat < 0 || value.exp <= value.iat || value.exp - value.iat > ACCESS_TTL_MS) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}
async function verifyIdentityToken(token, secret, now = Date.now()) {
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;
  if (!payloadPart || !signaturePart) return null;
  const payload = base64UrlDecode(payloadPart);
  const signature = base64UrlDecode(signaturePart);
  if (!payload || !signature) return null;
  let signatureValid = false;
  try {
    signatureValid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      signature,
      encoder.encode(payloadPart)
    );
  } catch {
    return null;
  }
  if (!signatureValid) return null;
  const claims = parseClaims(payload);
  if (!claims || now < claims.iat || now >= claims.exp) return null;
  return {
    version: TOKEN_VERSION,
    userId: claims.uid,
    deviceId: claims.did,
    issuedAt: claims.iat,
    expiresAt: claims.exp
  };
}

// apps/web/pwa/sources/allow.json
var allow_default = {
  $comment: "\u0627\u0644\u0645\u0648\u0627\u0642\u0639 \u0627\u0644\u062A\u064A \u064A\u062D\u0642 \u0644\u062C\u0627\u0644\u0628 \u0627\u0644\u0648\u064A\u0628 \u0637\u0644\u0628\u0647\u0627 (services/web-fetcher). \u0633\u0637\u0631 \u064A\u0637\u0627\u0628\u0642 \u0627\u0644\u0645\u0648\u0642\u0639 \u0648\u0646\u0637\u0627\u0642\u0627\u062A\u0647 \u0627\u0644\u0641\u0631\u0639\u064A\u0629. \u0643\u0644 \u0645\u0636\u064A\u0641 \u0641\u064A \u062A\u0639\u0631\u064A\u0641\u0627\u062A \u0627\u0644\u0645\u0635\u0627\u062F\u0631 \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0647\u0646\u0627 (\u064A\u062D\u0631\u0633\u0647 repository-safety).",
  redirectAliases: {
    "tuktuk-sa.online": ["tuktukhd.com", "tuktuk-sa.online"],
    "k8w4e.sbs": ["egydead.live", "egydead.space", "egydead.fyi", "m6o3p.sbs", "k8w4e.sbs"],
    "share4max.net": ["share4max.com", "share4max.net", "megamax.me", "megatuktuk.com", "megatuktuk.store"],
    "lolololu.website": ["lulustream.com", "luluvdo.com", "earnvids.com", "lolololu.website"],
    "uqload.vc": ["uqload.is", "uqload.net", "uqload.vc"],
    "vidmoly.net": ["vidmoly.net", "vidmoly.biz", "vidmoly.to", "vmpx.online"],
    "vmpx.online": ["vidmoly.net", "vidmoly.biz", "vidmoly.to", "vmpx.online"]
  },
  hosts: [
    "3asq.online",
    "starzmanga.net",
    "sparkmanga.net",
    "hizomanga.net",
    "mangalik.net",
    "lekmanga.online",
    "mangatime.org",
    "hijala.com",
    "meshmanga.com",
    "olympustaff.com",
    "azorafly.com",
    "mangadex.org",
    "mangadex.network",
    "witanime.site",
    "witanime.net",
    "shahiid-anime.net",
    "anime4up.rest",
    "myseed.pics",
    "myseed.tv",
    "tuktukhd.com",
    "tuktuk-sa.online",
    "egydead.live",
    "egydead.space",
    "egydead.fyi",
    "m6o3p.sbs",
    "k8w4e.sbs",
    "ok.ru",
    "okcdn.ru",
    "mycdn.me",
    "megamax.me",
    "share4max.com",
    "share4max.net",
    "megatuktuk.com",
    "sendvid.com",
    "vidara.to",
    "hgcloud.to",
    "vibuxer.com",
    "mp4upload.com",
    "cdn.makeup",
    "megatuktuk.store",
    "earnvids.com",
    "lulustream.com",
    "luluvdo.com",
    "lolololu.website",
    "streamwish.to",
    "mixdrop.ag",
    "mixdrop.co",
    "krakenfiles.com",
    "voe.sx",
    "filemoon.sx",
    "uqload.net",
    "uqload.vc",
    "videa.hu",
    "vk.com",
    "vkvideo.ru",
    "drive.google.com",
    "docs.google.com",
    "yonaplay.org",
    "streamruby.com",
    "rubyvid.com",
    "dood.re",
    "mxdrop.top",
    "firestream.to",
    "upns.one",
    "arcomixverse.blogspot.com",
    "loner-tl.blogspot.com",
    "manga-ai-land.blogspot.com",
    "manhatok.blogspot.com",
    "infinity896.blogspot.com",
    "xsano-manga.com",
    "yokai-team.blogspot.com",
    "lavascans.com",
    "link-manga.net",
    "manga-lionz.org",
    "dailymotion.com",
    "anime7u.com",
    "vtbe.to",
    "upload.do",
    "akwam.ss",
    "downet.net",
    "morencius.com",
    "mixdrop.top",
    "acek-cdn.com",
    "premilkyway.com",
    "mxcontent.net",
    "ristoanime.me",
    "vidmoly.biz",
    "vidmoly.net",
    "vmpx.online",
    "vidmoly.to",
    "uqload.is",
    "sibnet.ru",
    "turbovidhls.com",
    "okanime.xyz"
  ]
};

// services/web-fetcher/src/allow.ts
var PRIVATE_SUFFIXES = ["localhost", ".local", ".internal", ".lan", ".home", ".arpa"];
function parseTarget(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.port !== "" || url.username !== "" || url.password !== "") return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return null;
  if (PRIVATE_SUFFIXES.some((s) => host === s.replace(/^\./, "") || host.endsWith(s))) return null;
  return url;
}
function normalizeHost(host) {
  return host.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
}
function hostAllowed(host, list) {
  const h = normalizeHost(host);
  return list.hosts.some((entry) => {
    const e = normalizeHost(entry);
    return e.length > 0 && (h === e || h.endsWith(`.${e}`));
  });
}
function targetAllowed(raw, list) {
  const url = parseTarget(raw);
  return url && hostAllowed(url.hostname, list) ? url : null;
}
function redirectAllowed(from, to, list) {
  if (!hostAllowed(to, list)) return false;
  for (const [alias, family] of Object.entries(list.redirectAliases ?? {})) {
    if (hostAllowed(from, { hosts: [alias] }) && !hostAllowed(to, { hosts: family })) return false;
    if (hostAllowed(to, { hosts: [alias] }) && !hostAllowed(from, { hosts: family })) return false;
  }
  return true;
}

// services/web-fetcher/src/grant.ts
var encoder2 = new TextEncoder();
var decoder2 = new TextDecoder();
var GRANT_TTL_MS = 12 * 60 * 60 * 1e3;
var PURPOSE = "vantara-fetch-grant:v1";
function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
function unb64url(value) {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
async function key(secret) {
  const base = await crypto.subtle.importKey("raw", encoder2.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = new Uint8Array(await crypto.subtle.sign("HMAC", base, encoder2.encode(PURPOSE)));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function mintGrant(userId, secret, now = Date.now()) {
  const exp = now + GRANT_TTL_MS;
  const body = b64url(encoder2.encode(JSON.stringify({ u: userId, e: exp })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder2.encode(body)));
  return { grant: `${body}.${b64url(sig)}`, expiresAt: exp };
}
async function verifyGrant(grant, secret, now = Date.now()) {
  if (typeof grant !== "string" || !secret || grant.length > 512) return null;
  const [body, sig] = grant.split(".");
  if (!body || !sig) return null;
  const signature = unb64url(sig);
  const payload = unb64url(body);
  if (!signature || !payload) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await key(secret), signature, encoder2.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const { u, e } = JSON.parse(decoder2.decode(payload));
    if (typeof u !== "string" || !u || typeof e !== "number" || now >= e || e - now > GRANT_TTL_MS) return null;
    return u;
  } catch {
    return null;
  }
}

// services/web-fetcher/src/browser.ts
async function browserFallback(env, userId, input, fetchImpl) {
  if (!env.BROWSER_FETCH_URL || !env.BROWSER_FETCH_SECRET || new URL(input.url).hostname !== "witanime.site") return null;
  try {
    const endpoint = new URL(env.BROWSER_FETCH_URL);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return null;
    const data = new TextEncoder().encode(`${env.BROWSER_FETCH_SECRET}\0${userId}`);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const session = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const headers = {};
    input.headers.forEach((value, name) => {
      headers[name] = value;
    });
    const r = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.BROWSER_FETCH_SECRET}` },
      body: JSON.stringify({ ...input, headers, session }),
      signal: AbortSignal.timeout(4e4)
    });
    if (!r.ok) return null;
    const out = await r.json();
    const final = new URL(out.url);
    if (final.protocol !== "https:" || final.hostname !== "witanime.site" || final.port || final.username || final.password || !Number.isInteger(out.status) || out.status < 200 || out.status > 399 || typeof out.text !== "string" || out.text.length > 8e6) return null;
    return out;
  } catch {
    return null;
  }
}

// services/web-fetcher/src/hls.ts
function isPlaylist(contentType, url) {
  const type = (contentType ?? "").toLowerCase();
  return type.includes("mpegurl") || /\.m3u8(\?|$)/i.test(url);
}
function rewritePlaylist(text, base, wrap) {
  const resolve = (ref) => {
    try {
      return new URL(ref, base).toString();
    } catch {
      return ref;
    }
  };
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_, ref) => `URI="${wrap(resolve(ref))}"`);
    }
    return wrap(resolve(trimmed));
  }).join("\n");
}

// services/web-fetcher/src/index.ts
var signingSecret = (env) => bridgeMode(env) ? env.VANTARA_BRIDGE_KEY : env.VANTARA_IDENTITY_SECRET;
var bridgeMode = (env) => typeof env.VANTARA_BRIDGE_KEY === "string" && env.VANTARA_BRIDGE_KEY.length >= 24;
function sameSecret(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
var VANTARA_WEB_ORIGINS = ["https://vantara-bcf.pages.dev", "https://localhost", "capacitor://localhost", "vantara://app"];
var PASSED_HEADERS = ["x-videa-xs"];
var ALLOW = allow_default;
var USER_AGENT = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
var APP_AGENT = "VANTARA/1.0 (+https://github.com/Meshal515/VANTARA)";
var wantsAppAgent = (host) => /^(?:api|uploads)\.mangadex\.org$/i.test(host) || /\.mangadex\.network$/i.test(host);
var UPSTREAM_TIMEOUT_MS = 25e3;
var MAX_REDIRECTS = 6;
var MAX_BODY_FOR_POST = 64 * 1024;
var PER_MINUTE = 900;
var FORWARDED = [
  "referer",
  "origin",
  "accept",
  "content-type",
  "x-requested-with",
  "accept-language",
  // Laravel (WitAnime): طلبات السيرفرات تحمل رمز CSRF من الصفحة
  "x-csrf-token",
  // MegaMax (Inertia): قائمة المرايا تُطلب بهذه الترويسات
  "x-inertia",
  "x-inertia-version",
  "x-inertia-partial-component",
  "x-inertia-partial-data"
];
var ANY_PUBLIC_HOST = { hosts: [], any: true };
var NOT_MEDIA = /^(text\/html|application\/(json|xml|xhtml|javascript)|text\/(xml|javascript))/i;
function allowedOrigins(env) {
  const listed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return bridgeMode(env) ? [.../* @__PURE__ */ new Set([...listed, ...VANTARA_WEB_ORIGINS])] : listed;
}
function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, range",
    "access-control-expose-headers": `x-vf-status, x-vf-url, x-vf-set-cookie, x-vf-challenge, x-vf-location, ${PASSED_HEADERS.map((h) => `x-vf-h-${h}`).join(", ")}, content-range, accept-ranges, content-length`,
    "access-control-max-age": "86400",
    vary: "Origin"
  };
}
function json(status, body, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors }
  });
}
async function bearerUser(request, env) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  if (bridgeMode(env)) return sameSecret(token, env.VANTARA_BRIDGE_KEY) ? "bridge-owner" : null;
  const claims = await verifyIdentityToken(token, env.VANTARA_IDENTITY_SECRET);
  return claims?.userId ?? null;
}
var windows = /* @__PURE__ */ new Map();
function overLimit(userId, now = Date.now()) {
  const minute = Math.floor(now / 6e4);
  const w = windows.get(userId);
  if (!w || w.minute !== minute) {
    windows.set(userId, { minute, count: 1 });
    if (windows.size > 500) {
      for (const [k, v] of windows) if (v.minute !== minute) windows.delete(k);
    }
    return false;
  }
  w.count += 1;
  return w.count > PER_MINUTE;
}
var FetchFailure = class extends Error {
  constructor(code, detail = "") {
    super(code);
    this.code = code;
    this.detail = detail;
  }
  code;
  detail;
};
function cookiePairs(response) {
  const all = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : (response.headers.get("set-cookie") ?? "").split(/,(?=\s*[^;,=\s]+=)/);
  return all.map((c) => c.split(";")[0]?.trim() ?? "").filter((c) => c.includes("="));
}
function mergeCookies(base, add) {
  const jar = /* @__PURE__ */ new Map();
  for (const pair of [...(base ?? "").split(";"), ...add]) {
    const p = pair.trim();
    const i = p.indexOf("=");
    if (i > 0) jar.set(p.slice(0, i), p.slice(i + 1));
  }
  return jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join("; ") : void 0;
}
async function upstream(target, init, list, fetchImpl = fetch) {
  let url = target;
  let previousHost = target.hostname;
  let method = init.method;
  let body = init.body;
  let cookies = init.cookies;
  const collected = [];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!parseTarget(url.toString())) throw new FetchFailure(hop === 0 ? "host_not_allowed" : "foreign_redirect", url.hostname);
    if (!list.any && !hostAllowed(url.hostname, list)) throw new FetchFailure(hop === 0 ? "host_not_allowed" : "foreign_redirect", url.hostname);
    if (hop > 0 && !list.any && !redirectAllowed(previousHost, url.hostname, list)) throw new FetchFailure("foreign_redirect", url.hostname);
    const headers = new Headers(init.headers);
    if (!headers.has("user-agent")) headers.set("user-agent", wantsAppAgent(url.hostname) ? APP_AGENT : USER_AGENT);
    if (!headers.has("accept-language")) headers.set("accept-language", "ar,en;q=0.8");
    if (cookies) headers.set("cookie", cookies);
    if (init.range) headers.set("range", init.range);
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers,
        body: method === "POST" && body !== void 0 ? body : null,
        redirect: "manual",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
      });
    } catch (error) {
      const name = error?.name;
      throw new FetchFailure(name === "TimeoutError" || name === "AbortError" ? "upstream_timeout" : "upstream_error", String(error?.message ?? error).slice(0, 200));
    }
    const fresh = cookiePairs(response);
    collected.push(...fresh);
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location && init.follow !== false) {
      let next;
      try {
        next = new URL(location, url);
      } catch {
        return { response, finalUrl: url, setCookies: collected };
      }
      if (next.protocol !== "https:" && next.protocol !== "http:") return { response, finalUrl: url, setCookies: collected };
      cookies = next.hostname === url.hostname ? mergeCookies(cookies, fresh) : void 0;
      if (response.status === 303 || (response.status === 301 || response.status === 302) && method === "POST") {
        method = "GET";
        body = void 0;
      }
      previousHost = url.hostname;
      url = next;
      continue;
    }
    return { response, finalUrl: url, setCookies: collected };
  }
  throw new FetchFailure("too_many_redirects", url.hostname);
}
function challengeOf(status, text) {
  if (status !== 403 && status !== 503 && status !== 429) return "none";
  if (/cf-turnstile|challenges\.cloudflare\.com\/turnstile/i.test(text)) return "interactive";
  if (/just a moment|cf-chl|challenge-platform|cf_chl_opt/i.test(text)) return "js";
  return "none";
}
async function handleFetch(request, env, cors, fetchImpl) {
  const userId = await bearerUser(request, env);
  if (!userId) return json(401, { error: "unauthorized" }, cors);
  if (overLimit(userId)) return json(429, { error: "rate_limited" }, cors);
  let input;
  try {
    input = await request.json();
  } catch {
    return json(400, { error: "bad_request" }, cors);
  }
  const target = targetAllowed(input.url, ALLOW);
  if (!target) return json(403, { error: "host_not_allowed", host: safeHost(input.url) }, cors);
  const method = input.method === "POST" ? "POST" : "GET";
  const body = typeof input.body === "string" ? input.body : void 0;
  if (body && body.length > MAX_BODY_FOR_POST) return json(413, { error: "body_too_large" }, cors);
  const headers = new Headers();
  if (input.headers && typeof input.headers === "object") {
    for (const name of FORWARDED) {
      const value = input.headers[name];
      if (typeof value === "string" && value.length < 2048) headers.set(name, value);
    }
  }
  const cookies = typeof input.cookies === "string" && input.cookies.length < 8192 ? input.cookies : void 0;
  try {
    const { response, finalUrl, setCookies } = await upstream(target, { method, headers, body, cookies, follow: input.follow !== false }, ALLOW, fetchImpl);
    const out = new Headers(cors);
    out.set("content-type", response.headers.get("content-type") ?? "application/octet-stream");
    out.set("cache-control", "no-store");
    out.set("x-vf-status", String(response.status));
    out.set("x-vf-url", finalUrl.toString());
    if (setCookies.length) out.set("x-vf-set-cookie", encodeURIComponent(JSON.stringify(setCookies)));
    for (const name of PASSED_HEADERS) {
      const value = response.headers.get(name);
      if (value && value.length < 512) out.set(`x-vf-h-${name}`, value);
    }
    const location = response.headers.get("location");
    if (location && response.status >= 300 && response.status < 400) out.set("x-vf-location", new URL(location, finalUrl).toString());
    if ([403, 429, 503].includes(response.status) && (response.headers.get("content-type") ?? "").includes("html")) {
      const text = await response.text();
      const challenge = challengeOf(response.status, text);
      if (challenge !== "none") {
        const rendered = await browserFallback(env, userId, { url: target.toString(), method, body, headers, follow: input.follow !== false }, fetchImpl);
        if (rendered) {
          out.set("x-vf-status", String(rendered.status));
          out.set("x-vf-url", rendered.url);
          out.set("content-type", rendered.type || "text/html; charset=utf-8");
          out.delete("x-vf-set-cookie");
          if (rendered.location) out.set("x-vf-location", new URL(rendered.location, rendered.url).toString());
          return new Response(rendered.text, { status: 200, headers: out });
        }
      }
      out.set("x-vf-challenge", challenge);
      return new Response(text, { status: 200, headers: out });
    }
    return new Response(response.body, { status: 200, headers: out });
  } catch (error) {
    if (error instanceof FetchFailure) {
      const status = error.code === "upstream_timeout" ? 504 : error.code === "upstream_error" ? 502 : 403;
      return json(status, { error: error.code, detail: error.detail }, cors);
    }
    return json(502, { error: "upstream_error" }, cors);
  }
}
function safeHost(raw) {
  try {
    return typeof raw === "string" ? new URL(raw).hostname : null;
  } catch {
    return null;
  }
}
async function handleGrant(request, env, cors) {
  const userId = await bearerUser(request, env);
  if (!userId) return json(401, { error: "unauthorized" }, cors);
  return json(200, await mintGrant(userId, signingSecret(env)), cors);
}
async function handleMedia(request, env, cors, fetchImpl) {
  const params = new URL(request.url).searchParams;
  const userId = await verifyGrant(params.get("g"), signingSecret(env));
  if (!userId) return json(401, { error: "unauthorized" }, cors);
  if (overLimit(userId)) return json(429, { error: "rate_limited" }, cors);
  const target = parseTarget(params.get("u"));
  if (!target) return json(403, { error: "host_not_allowed", host: safeHost(params.get("u")) }, cors);
  const referer = params.get("r");
  const headers = new Headers({ accept: request.headers.get("accept") ?? "*/*" });
  if (referer && /^https?:\/\//.test(referer)) headers.set("referer", referer);
  try {
    const { response, finalUrl } = await upstream(target, { method: "GET", headers, range: request.headers.get("range") }, ANY_PUBLIC_HOST, fetchImpl);
    if (NOT_MEDIA.test(response.headers.get("content-type") ?? "") && !isPlaylist(response.headers.get("content-type"), finalUrl.toString())) {
      return json(415, { error: "not_media", status: response.status }, cors);
    }
    const out = new Headers(cors);
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
      const value = response.headers.get(name);
      if (value) out.set(name, value);
    }
    if (isPlaylist(response.headers.get("content-type"), finalUrl.toString()) && response.ok) {
      const text = await response.text();
      const self = new URL(request.url);
      const wrap = (absolute) => {
        const next = new URL("/v1/media", self.origin);
        next.searchParams.set("u", absolute);
        if (referer) next.searchParams.set("r", referer);
        next.searchParams.set("g", params.get("g") ?? "");
        return next.toString();
      };
      out.set("content-type", "application/vnd.apple.mpegurl");
      out.delete("content-length");
      out.set("cache-control", "no-store");
      return new Response(rewritePlaylist(text, finalUrl.toString(), wrap), { status: 200, headers: out });
    }
    const type = response.headers.get("content-type") ?? "";
    out.set("cache-control", type.startsWith("image/") && response.ok ? "private, max-age=604800, immutable" : "no-store");
    return new Response(response.body, { status: response.status, headers: out });
  } catch (error) {
    if (error instanceof FetchFailure) {
      return json(error.code === "upstream_timeout" ? 504 : error.code === "upstream_error" ? 502 : 403, { error: error.code, detail: error.detail }, cors);
    }
    return json(502, { error: "upstream_error" }, cors);
  }
}
async function handleHosts(request, cors, fetchImpl) {
  const asked = (new URL(request.url).searchParams.get("h") ?? "").split(",").map((h) => h.trim()).filter(Boolean).slice(0, 12);
  const results = await Promise.all(
    asked.map(async (host) => {
      const target = targetAllowed(`https://${host}/`, ALLOW);
      if (!target) return { host, error: "host_not_allowed" };
      const started = Date.now();
      try {
        const { response, finalUrl } = await upstream(target, { method: "GET", headers: new Headers({ accept: "text/html" }) }, ALLOW, fetchImpl);
        const text = (await response.text()).slice(0, 2e4);
        return { host, status: response.status, finalHost: finalUrl.hostname, challenge: challengeOf(response.status, text), ms: Date.now() - started };
      } catch (error) {
        return { host, error: error instanceof FetchFailure ? error.code : "upstream_error", detail: error instanceof FetchFailure ? error.detail : void 0, ms: Date.now() - started };
      }
    })
  );
  return json(200, { checkedAt: (/* @__PURE__ */ new Date()).toISOString(), results }, cors);
}
function createHandler(fetchImpl = fetch) {
  return async function handle(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const { pathname } = new URL(request.url);
    if (!env.VANTARA_IDENTITY_SECRET && !bridgeMode(env) && pathname.startsWith("/v1/")) return json(503, { error: "not_configured" }, cors);
    if (pathname === "/v1/fetch" && request.method === "POST") return handleFetch(request, env, cors, fetchImpl);
    if (pathname === "/v1/grant" && request.method === "POST") return handleGrant(request, env, cors);
    if (pathname === "/v1/media" && request.method === "GET") return handleMedia(request, env, cors, fetchImpl);
    if (pathname === "/health/hosts" && request.method === "GET") return handleHosts(request, cors, fetchImpl);
    if (pathname === "/health") return json(200, { ok: true, hosts: ALLOW.hosts.length, bridge: bridgeMode(env) }, cors);
    return json(404, { error: "not_found" }, cors);
  };
}
var index_default = { fetch: createHandler() };
export {
  APP_AGENT,
  FetchFailure,
  USER_AGENT,
  challengeOf,
  createHandler,
  index_default as default,
  overLimit,
  upstream,
  wantsAppAgent
};
