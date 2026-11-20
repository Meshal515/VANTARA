'use strict';
// محرك إضافات المانجا في ويندوز: Suwayomi-Server (MPL-2.0، https://github.com/Suwayomi/Suwayomi-Server) يُنزَّل
// مرة عند أول حاجة، بإصدار مثبّت وبصمة SHA-256 مثبّتة، ويعمل محليًا فقط:
//  - يستمع على 127.0.0.1 بمنفذ عشوائي، بمصادقة BASIC وسر عشوائي جديد كل تشغيل (لا يعرفه إلا هذا التطبيق).
//  - واجهته الويب وأيقونة الشريط وفتح المتصفح معطلة؛ VANTARA تبقى الواجهة الوحيدة (قرار المالك: «محرك فقط»).
//  - بياناته في userData/suwayomi/data (لا تُمسح مع الكاش)، ويتوقف مع إغلاق التطبيق أو بعد 45 دقيقة بلا استعمال.
// لا شيء من هذا يمر عبر Cloudflare.
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const childProcess = require('node:child_process');

// الإصدار المستقر v2.4.2366 رفض كل إضافات Keiyoushi الحالية على ويندوز حقيقي (VerifyError: إضافات ProGuard مع طبقة
// توافق أندرويد قديمة). المعاينة v2.4.2490 (7 نوفمبر) من مستودع Suwayomi الرسمي للمعاينات، ببصمة مثبّتة كذلك.
const PINNED = Object.freeze({
  version: 'v2.4.2490',
  url: 'https://github.com/Suwayomi/Suwayomi-Server-preview/releases/download/v2.4.2490/Suwayomi-Server-v2.4.2490-windows-x64.zip',
  sha256: '999de5d1b93168a6b155e3d8fdee938330bcd9128ee8fc4fccd456aa1d0666c5',
  folder: 'Suwayomi-Server-v2.4.2490-windows-x64',
  maxBytes: 420 * 1024 * 1024,
});
const USER = 'vantara';
const START_TIMEOUT_MS = 150_000;
const IDLE_STOP_MS = 45 * 60_000;
const LOG_LIMIT = 2 * 1024 * 1024;

const arabic = (message, code) => Object.assign(new Error(message), { code });

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

/** معاملات JVM: إعدادات Suwayomi تُمرَّر كخصائص نظام (SystemPropertyOverridableConfigModule) فتعلو ملف الإعداد. */
function launchArgs({ dataDir, port, password }) {
  // القيمة تُقرأ HOCON (`internal=<قيمة>`): النصوص بين علامتي تنصيص فلا تُفسَّر رقمًا أو تركيبًا
  const p = (key, value) => `-Dsuwayomi.tachidesk.config.server.${key}=${value}`;
  const q = (value) => JSON.stringify(String(value));
  return [
    '-Xmx768m', '-Dfile.encoding=UTF-8', '-Djava.awt.headless=true',
    // مدقق بايت كود الـJVM شغال دائمًا ولا يُعطَّل. جُرّب توسيعه على ويندوز حقيقي (20 نوفمبر): MangaDex 1.6.4 الذي
    // رفضه المدقق بـVerifyError أسقط الـJVM كلها (EXCEPTION_ACCESS_VIOLATION) حين شُغّل بلا تدقيق. المدقق يمنع انهيار
    // المحرك بكود تحويل تالف؛ الإضافة المرفوضة تُقال للمستخدم صراحة ولا تُشغَّل.
    p('rootDir', dataDir), p('ip', q('127.0.0.1')), p('port', port),
    p('authMode', q('BASIC_AUTH')), p('authUsername', q(USER)), p('authPassword', q(password)),
    p('webUIEnabled', 'false'), p('initialOpenInBrowserEnabled', 'false'), p('systemTrayEnabled', 'false'),
    p('debugLogsEnabled', 'false'), p('autoDownloadNewChapters', 'false'), p('globalUpdateInterval', '0'),
    // KCEF (متصفح Chromium داخل المحرك) يُنزّل ~100MB عند الإقلاع: معطّل؛ صفحات التحقق لها متصفح VANTARA المخفي
    p('kcefEnabled', 'false'),
    '-jar', path.join('bin', 'Suwayomi-Server.jar'),
  ];
}

function createSuwayomiRuntime({
  root, platform = process.platform, fetch = globalThis.fetch, spawn = childProcess.spawn,
  tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), onProgress = () => {}, now = Date.now,
  pinned = PINNED, healthIntervalMs = 500, startTimeoutMs = START_TIMEOUT_MS, idleStopMs = IDLE_STOP_MS,
} = {}) {
  const engineDir = path.join(root, 'engine', pinned.version);
  const dataDir = path.join(root, 'data');
  const marker = path.join(engineDir, 'vantara-installed.json');
  let installing = null, starting = null, live = null, lastUse = 0, idleTimer = null, downloading = null, output = '';

  const supported = () => platform === 'win32';
  const installed = () => fs.existsSync(marker) && fs.existsSync(path.join(engineDir, 'jre', 'bin', 'java.exe')) && fs.existsSync(path.join(engineDir, 'bin', 'Suwayomi-Server.jar'));

  async function download(file) {
    const response = await fetch(pinned.url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw arabic(`تعذّر تنزيل محرك الإضافات (HTTP ${response.status})`, 'ENGINE_DOWNLOAD');
    const total = Number(response.headers.get('content-length')) || null;
    if (total && total > pinned.maxBytes) throw arabic('حجم محرك الإضافات أكبر من المتوقع؛ أُلغي التنزيل', 'ENGINE_SIZE');
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(file);
    let received = 0, said = 0;
    try {
      for await (const chunk of response.body) {
        received += chunk.length;
        if (received > pinned.maxBytes) throw arabic('حجم محرك الإضافات أكبر من المتوقع؛ أُلغي التنزيل', 'ENGINE_SIZE');
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        downloading = { received, total };
        if (received - said > 2 * 1024 * 1024 || received === total) { said = received; onProgress({ stage: 'download', received, total }); }
      }
      await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    } catch (error) {
      out.destroy();
      if (error?.code === 'ENOSPC') throw arabic('لا مساحة كافية على القرص لمحرك الإضافات (يحتاج قرابة 700MB)', 'ENOSPC');
      throw error;
    }
    if (hash.digest('hex') !== pinned.sha256) throw arabic('بصمة محرك الإضافات لا تطابق الإصدار الموثّق؛ لم يُثبَّت', 'ENGINE_DIGEST');
  }

  function extract(zip, into) {
    return new Promise((resolve, reject) => {
      // tar.exe (bsdtar) مدمج في ويندوز 10+ ويفك ZIP. نأخذ jre وbin فقط (النسخة تحمل Electron لا نحتاجه).
      const child = spawn(tar, ['-xf', zip, '-C', into, `${pinned.folder}/jre`, `${pinned.folder}/bin`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr?.on('data', (d) => { err = (err + d).slice(-2000); });
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(arabic(`تعذّر فك محرك الإضافات (${code}) ${err.trim().slice(0, 200)}`, 'ENGINE_EXTRACT'))));
    });
  }

  /** تنزيل ⇒ تحقق البصمة ⇒ فك ⇒ نقل ذري. نداء واحد في كل مرة؛ والمحاولة الفاشلة لا تترك نصف محرك. */
  function install() {
    if (!supported()) return Promise.reject(arabic('محرك إضافات المانجا متاح في ويندوز', 'ENGINE_PLATFORM'));
    if (installed()) return Promise.resolve({ installed: true, version: pinned.version });
    installing ??= (async () => {
      const work = path.join(root, 'downloads');
      const zip = path.join(work, `${pinned.folder}.zip.part`);
      const staging = path.join(work, 'staging');
      await fsp.rm(work, { recursive: true, force: true });
      await fsp.mkdir(staging, { recursive: true });
      try {
        onProgress({ stage: 'download', received: 0, total: null });
        await download(zip);
        onProgress({ stage: 'extract' });
        await extract(zip, staging);
        const unpacked = path.join(staging, pinned.folder);
        if (!fs.existsSync(path.join(unpacked, 'jre', 'bin', 'java.exe')) || !fs.existsSync(path.join(unpacked, 'bin', 'Suwayomi-Server.jar'))) throw arabic('محرك الإضافات ناقص بعد الفك', 'ENGINE_EXTRACT');
        await fsp.rm(engineDir, { recursive: true, force: true });
        await fsp.mkdir(path.dirname(engineDir), { recursive: true });
        await fsp.rename(unpacked, engineDir);
        await fsp.writeFile(marker, JSON.stringify({ version: pinned.version, sha256: pinned.sha256, at: now() }));
        // إصدارات أقدم من المحرك لا تبقى (البيانات في data/ لا تُمس)
        for (const name of await fsp.readdir(path.dirname(engineDir)).catch(() => [])) if (name !== pinned.version) await fsp.rm(path.join(path.dirname(engineDir), name), { recursive: true, force: true }).catch(() => {});
        onProgress({ stage: 'installed' });
        return { installed: true, version: pinned.version };
      } finally {
        downloading = null;
        await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
      }
    })().finally(() => { installing = null; });
    return installing;
  }

  const authHeader = (password) => `Basic ${Buffer.from(`${USER}:${password}`).toString('base64')}`;

  async function healthy(endpoint) {
    try {
      const r = await fetch(`${endpoint.base}/api/v1/settings/about`, { headers: { authorization: endpoint.auth }, signal: AbortSignal.timeout(4000) });
      return r.ok;
    } catch { return false; }
  }

  function scheduleIdle() {
    if (idleTimer || !idleStopMs) return;
    idleTimer = setInterval(() => {
      if (live && !starting && now() - lastUse > idleStopMs) void stop();
    }, Math.min(idleStopMs, 60_000));
    idleTimer.unref?.();
  }

  /** يشغّل المحرك (ويثبّته أولًا إن لزم) ويعيد `{ base, auth }`. نداء واحد في كل مرة. */
  function start({ quiet = false } = {}) {
    lastUse = now();
    if (live && live.child.exitCode == null && !live.child.killed) return Promise.resolve(live.endpoint);
    starting ??= (async () => {
      await install();
      // تسخين الخلفية لا يُظهر شيئًا؛ طلب ينتظره المستخدم يقول ما يحدث بدل انتظار صامت
      if (!quiet) onProgress({ stage: 'starting' });
      await fsp.mkdir(dataDir, { recursive: true });
      const port = await freePort();
      const password = `v${crypto.randomBytes(24).toString('hex')}`;
      const logFile = path.join(root, 'engine.log');
      const prior = await fsp.stat(logFile).catch(() => null);
      if (prior && prior.size > LOG_LIMIT) await fsp.rm(logFile, { force: true }).catch(() => {});
      const log = fs.createWriteStream(logFile, { flags: 'a' });
      const child = spawn(path.join(engineDir, 'jre', 'bin', 'java.exe'), launchArgs({ dataDir, port, password }), { cwd: engineDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let tail = '';
      const keep = (d) => { tail = (tail + d).slice(-4000); output = (output + String(d).replaceAll(password, '***')).slice(-16000); log.write(String(d).replaceAll(password, '***')); };
      child.stdout?.on('data', keep); child.stderr?.on('data', keep);
      let exited = null;
      const exit = new Promise((resolve) => child.once('exit', (code) => { exited = code ?? -1; log.end(); resolve(); }));
      child.once('error', (error) => { exited = -1; tail += String(error?.message ?? error); });
      const endpoint = { base: `http://127.0.0.1:${port}`, auth: authHeader(password) };
      const deadline = now() + startTimeoutMs;
      while (exited == null && now() < deadline) {
        if (await healthy(endpoint)) {
          live = { child, endpoint, exit };
          exit.then(() => { if (live?.child === child) live = null; });
          scheduleIdle();
          onProgress({ stage: 'running' });
          return endpoint;
        }
        await new Promise((r) => setTimeout(r, healthIntervalMs));
      }
      try { child.kill(); } catch { /* */ }
      const why = exited != null ? `توقف المحرك عند الإقلاع (${exited})` : 'المحرك لم يجهز في الوقت';
      throw arabic(`${why}. ${tail.replaceAll(password, '***').split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300)}`.trim(), 'ENGINE_START');
    })().finally(() => { starting = null; });
    return starting;
  }

  async function stop() {
    const current = live;
    live = null;
    if (!current) return;
    try { current.child.kill(); } catch { /* */ }
    const timeout = new Promise((r) => { const t = setTimeout(r, 5000); t.unref?.(); });
    await Promise.race([current.exit, timeout]);
    if (current.child.exitCode == null && platform === 'win32' && current.child.pid) {
      try { spawn('taskkill', ['/pid', String(current.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* */ }
    }
  }

  /**
   * كوكيز جلسة المحرك (لكل تشغيل): Suwayomi الجديد يطلب مع رفع الملفات (multipart) رمز CSRF من جلسته
   * (`suwayomi-basic-csrf` مع JSESSIONID) وإلا يرد 401 «CSRF mismatch» (ويندوز حقيقي، التشغيل 64). تبقى بين التطبيق
   * والمحرك على 127.0.0.1 ولا تُحفظ على القرص.
   */
  const jar = new Map();
  let jarFor = null;
  const remember = (response, base) => {
    if (jarFor !== base) { jar.clear(); jarFor = base; }
    const lines = typeof response?.headers?.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const line of lines) {
      const m = /^\s*([^=;\s]+)=([^;]*)/.exec(line);
      if (m && /^(JSESSIONID|suwayomi-basic-csrf)$/i.test(m[1])) jar.set(m[1], m[2]);
    }
  };
  const cookieHeader = (base) => (jarFor === base && jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : null);

  /** طلب للمحرك بمصادقته. `path` يبدأ بـ/ ولا يغادر 127.0.0.1. */
  async function request(pathname, { method = 'GET', headers = {}, body = undefined, timeout = 90_000 } = {}) {
    if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) throw arabic('مسار غير صالح', 'ENGINE_PATH');
    const endpoint = await start();
    lastUse = now();
    const send = async (target, init) => {
      const cookie = cookieHeader(endpoint.base);
      const response = await fetch(`${endpoint.base}${target}`, { ...init, headers: { ...init.headers, authorization: endpoint.auth, ...(cookie ? { cookie } : {}) }, signal: AbortSignal.timeout(timeout) });
      remember(response, endpoint.base);
      return response;
    };
    // رفع ملف بلا جلسة بعد: طلب خفيف أولًا يمنح المحرك فرصة إصدار رمز الجلسة
    if (typeof body?.append === 'function' && !cookieHeader(endpoint.base)?.includes('suwayomi-basic-csrf')) {
      const probe = await send('/api/v1/settings/about', { method: 'GET', headers: {} });
      await probe.arrayBuffer().catch(() => {});
    }
    return send(pathname, { method, headers, body });
  }

  return {
    pinned, supported, installed, install, start, stop, request, logFile: path.join(root, 'engine.log'),
    /** آخر ما كتبه المحرك (لتشخيص رفض إضافة؛ السر محجوب فيه). */
    recentOutput: () => output,
    state: () => ({ supported: supported(), installed: installed(), running: Boolean(live), starting: Boolean(starting), downloading, version: pinned.version }),
    close: async () => { if (idleTimer) clearInterval(idleTimer); idleTimer = null; await stop(); },
  };
}

module.exports = { createSuwayomiRuntime, launchArgs, PINNED };
