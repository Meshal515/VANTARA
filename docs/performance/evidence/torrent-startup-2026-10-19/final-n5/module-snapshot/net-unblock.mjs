/**
 * تجاوز الحجب في ويندوز بنفس سلوك الـAPK (AnimeDns + SniFragment + AnimeHostRouter.describe).
 *
 * مزوّدو الإنترنت يحجبون مواقع الأنمي والسينما والإضافات بطريقتين:
 *  1. DNS: الاسم لا يُحلّ، أو يُحلّ إلى صفحة حجب. الـAPK يسأل DNS عبر HTTPS (Cloudflare ثم Google)
 *     أولًا، ثم DNS النظام. ويندوز كان يسأل النظام فقط، فيفشل الطلب وتظهر «انتهت المهلة».
 *  2. فحص اسم الموقع (SNI) في أول رسالة TLS: الاتصال ينجح ثم يُقطع فور المصافحة. الـAPK يعيد
 *     المحاولة بتقسيم أول كتابة إلى جزأين، فلا يرى جدار الحجب الاسم في الحزمة الأولى.
 */
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns/promises';
import { Duplex } from 'node:stream';

/** خوادم DoH بعناوين حرفية: لا نحتاج DNS لحلّ خادم الـDNS نفسه. شهاداتها تحمل هذه العناوين. */
export const DOH_RESOLVERS = Object.freeze([
  Object.freeze({ name: 'Cloudflare', host: '1.1.1.1', path: '/dns-query' }),
  Object.freeze({ name: 'Google', host: '8.8.8.8', path: '/resolve' }),
]);
const TTL_MS = 10 * 60_000;
// الدالة الأصلية لحظة التحميل: استبدال https.request لاحقًا (اختبارات fixture) لا يمس استعلام DNS.
const originalRequest = https.request;
export const SPLIT_OFFSET = 5;

function isPrivate(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
  }
  if (family === 6) {
    const v = address.toLowerCase();
    return v === '::' || v === '::1' || v.startsWith('fe80:') || /^f[cd]/.test(v);
  }
  return true;
}
/** نفس AnimeDns.isSinkhole: كل العناوين محلية أو صفرية = إجابة حجب، لا موقع عام. */
export const isSinkhole = addresses => addresses.length > 0 && addresses.every(a => isPrivate(a.address));

/** طلب DoH واحد بصيغة JSON (application/dns-json) يدعمها Cloudflare وGoogle. */
export function dohQuery(resolver, name, type, { timeout = 4000, request = originalRequest } = {}) {
  return new Promise((resolve, reject) => {
    const path = `${resolver.path}?name=${encodeURIComponent(name)}&type=${type}`;
    const req = request({ host: resolver.host, servername: resolver.host, path, method: 'GET', headers: { accept: 'application/dns-json' }, agent: false }, res => {
      const chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > 64 * 1024) req.destroy(new Error('رد DoH أكبر من الحد')); else chunks.push(c); });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw new Error(`DoH ${resolver.name} أعاد ${res.statusCode}`);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const want = type === 'AAAA' ? 28 : 1, family = type === 'AAAA' ? 6 : 4;
          resolve((body.Answer ?? []).filter(a => a.type === want && net.isIP(a.data) === family).map(a => ({ address: a.data, family })));
        } catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.setTimeout(timeout, () => req.destroy(new Error(`انتهت مهلة DoH ${resolver.name}`)));
    req.on('error', reject); req.end();
  });
}

/**
 * محلّل يفضّل DoH (مثل عميل مشغل الـAPK: AnimeDns(preferDoh = { true })) ثم DNS النظام.
 * IPv4 أولًا؛ IPv6 فقط إن لم يوجد IPv4 (جهاز بلا مسار IPv6 يفشل عليه فورًا).
 */
export function createUnblockingLookup({ query = dohQuery, system = host => dns.lookup(host, { all: true, verbatim: true }), resolvers = DOH_RESOLVERS, now = Date.now } = {}) {
  const cache = new Map();
  async function viaDoh(host) {
    let last;
    for (const resolver of resolvers) {
      try {
        let found = await query(resolver, host, 'A');
        if (!found.length) found = await query(resolver, host, 'AAAA');
        if (found.length && !isSinkhole(found)) return found;
        last = new Error(`DoH ${resolver.name}: بلا عنوان عام`);
      } catch (e) { last = e; }
    }
    throw last ?? new Error('DoH بلا نتيجة');
  }
  return async function lookup(host) {
    const key = host.toLowerCase(), hit = cache.get(key);
    if (hit && hit.until > now()) return hit.addresses;
    let dohError;
    try {
      const addresses = await viaDoh(key);
      cache.set(key, { addresses, until: now() + TTL_MS });
      return addresses;
    } catch (e) { dohError = e; }
    let addresses;
    try { addresses = await system(key); }
    catch (e) { throw Object.assign(new Error(`الدومين لا يُحلّ (حجب DNS؟): ${host}`), { code: e.code ?? 'ENOTFOUND', cause: e, dohError }); }
    if (isSinkhole(addresses)) throw Object.assign(new Error(`الدومين محجوب بالـDNS: ${host}`), { code: 'DNS_SINKHOLE', dohError });
    return addresses;
  };
}

/**
 * نمط حجب SNI (AnimeHostRouter.looksLikeSniReset): اتصال TCP نجح ثم انقطعت المصافحة فورًا.
 * أخطاء الشهادة ليست حجبًا فلا تُطابق.
 */
export function looksLikeSniReset(error) {
  const code = String(error?.code ?? '');
  if (/^(ERR_TLS_CERT|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO|ERR_SSL_WRONG_VERSION)/.test(code)) return false;
  if (['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(code)) return true;
  return /socket disconnected before secure TLS connection|socket hang up|handshake/i.test(String(error?.message ?? ''));
}

/** مقبس يقسم أول كتابة كبيرة (ClientHello) إلى جزأين منفصلين على الشبكة (SniFragmentingOutputStream). */
export function fragmentingStream(raw, { offset = SPLIT_OFFSET, gapMs = 3 } = {}) {
  let armed = true;
  const stream = new Duplex({
    write(chunk, _encoding, callback) {
      if (armed && chunk.length > offset + 1) {
        armed = false;
        raw.write(chunk.subarray(0, offset));
        setTimeout(() => raw.write(chunk.subarray(offset), callback), gapMs);
        return;
      }
      armed = false;
      raw.write(chunk, callback);
    },
    read() { raw.resume(); },
    final(callback) { raw.end(); callback(); },
    destroy(error, callback) { raw.destroy(); callback(error); },
  });
  raw.on('data', chunk => { if (!stream.push(chunk)) raw.pause(); });
  raw.on('end', () => stream.push(null));
  raw.on('error', error => stream.destroy(error));
  raw.on('close', () => { if (!stream.destroyed) stream.destroy(); });
  return stream;
}

/**
 * وكيل HTTPS يتصل بالعنوان المثبّت (منع إعادة الربط) ويقسّم ClientHello. Node يتجاهل
 * createConnection الممرَّر لـrequest إذا وُجد وكيل، فالتجزئة تعيش في الوكيل نفسه.
 */
export class FragmentingAgent extends https.Agent {
  constructor({ address, port = 443, ...options } = {}) { super({ keepAlive: false, ...options }); this.pinned = address; this.pinnedPort = port; }
  createConnection(options, oncreate) {
    const raw = net.connect({ host: this.pinned, port: options.port ?? this.pinnedPort });
    raw.setNoDelay(true); // Nagle قد يعيد دمج الجزأين في حزمة واحدة
    let settled = false;
    const done = (error, socket) => { if (settled) return; settled = true; oncreate(error, socket); };
    raw.once('error', error => done(error));
    raw.once('connect', () => {
      const socket = tls.connect({ socket: fragmentingStream(raw), servername: options.servername ?? options.host, ALPNProtocols: ['http/1.1'] });
      done(null, socket);
    });
    return undefined;
  }
}

/** سبب مقروء مثل AnimeHostRouter.describe: نوع الخطأ الأعمق ورسالته. */
export function describeNetError(error) {
  const code = String(error?.code ?? error?.cause?.code ?? '');
  const message = String(error?.message ?? '');
  if (code === 'DNS_SINKHOLE' || /محجوب بالـDNS/.test(message)) return message;
  if (['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'].includes(code) || /لا يُحلّ/.test(message)) return 'الدومين لا يُحلّ (حجب DNS؟)';
  if (code === 'ETIMEDOUT' || /مهلة|timed? ?out/i.test(message)) return 'انتهت مهلة الاتصال بالموقع';
  if (code === 'ECONNREFUSED') return 'رفض الموقع الاتصال';
  if (looksLikeSniReset(error)) return 'قُطع الاتصال الآمن فور المصافحة (حجب؟)';
  if (/CERT|SSL|TLS/i.test(code + message)) return 'خطأ شهادة/اتصال آمن';
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') return 'لا مسار شبكة إلى الموقع';
  return code || message.slice(0, 120) || 'خطأ شبكة غير معروف';
}
