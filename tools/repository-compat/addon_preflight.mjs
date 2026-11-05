#!/usr/bin/env node
/**
 * فحص سريع (ثوانٍ، بلا محاكي) لمواقع إضافات الفيديو قبل الاعتماد: هل يرد الموقع، أم انتقل، أم يطلب تحقق
 * Cloudflare، أم متوقف. العناوين من المستودعات نفسها (فهرس Aniyomi، وكود مصادر CloudStream)، لا قائمة يدوية.
 * الهدف: لا تُصرف ساعة محاكي على إضافة موقعها متوقف، ويُختار للموقع نفسه الإضافة التي تعمل (Aniyomi أو CloudStream).
 *
 *   node tools/repository-compat/addon_preflight.mjs [--json out.json]
 *
 * تقرير فقط: لا يثبّت شيئًا ولا يمس بيانات مستخدم. نتيجة مركز البيانات في Cloudflare أشد من شبكة المنزل.
 */
import { writeFileSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const ANIYOMI_INDEX = 'https://raw.githubusercontent.com/yuzono/anime-repo/repo/index.min.json';
const CS3_REPO = 'https://github.com/Abodabodd/re-3arabi.git';

/** «الموقع» = آخر جزأين، أو ثلاثة تحت لاحقة دولة عامة (x.co.uk)، كما في محرك فانتارا. */
export function siteOf(host) {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const keep = parts.at(-1).length === 2 && ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac'].includes(parts.at(-2)) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** حكم صفحة واحدة: حالتها ورؤوسها وبداية نصها. */
export function judge({ status, headers = {}, body = '', from, to, error }) {
  if (error) return { state: 'down', why: error };
  const challenge = headers['cf-mitigated'] === 'challenge' || /cf[-_]chl|challenge-platform|just a moment/i.test(body);
  if (challenge) return { state: 'cloudflare', why: `${status}` };
  if (status >= 500) return { state: 'down', why: `${status}` };
  if (status >= 400) return { state: 'blocked', why: `${status}` };
  if (to && to !== from) return { state: siteOf(to) === siteOf(from) ? 'moved-same-site' : 'moved', why: `${from} → ${to}` };
  return { state: 'ok', why: `${status}` };
}

async function visit(url) {
  let current = url;
  const from = new URL(url).host;
  for (let hop = 0; hop < 8; hop++) {
    let res;
    try {
      res = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      return judge({ from, error: e.cause?.code ?? e.name });
    }
    const location = res.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(res.status) && location) { current = new URL(location, current).toString(); continue; }
    const body = (await res.text().catch(() => '')).slice(0, 65536);
    const title = body.match(/<title[^>]*>([^<]{1,100})/i)?.[1]?.trim();
    return { ...judge({ status: res.status, headers: Object.fromEntries(res.headers), body, from, to: new URL(current).host }), title };
  }
  return { state: 'down', why: 'REDIRECT_LOOP' };
}

async function aniyomi() {
  const index = await (await fetch(ANIYOMI_INDEX)).json();
  return index.filter((e) => e.pkg.includes('.ar.')).flatMap((e) => e.sources.map((s) => ({
    kind: 'aniyomi', name: e.pkg.split('.').pop(), label: s.name, version: e.version, base: s.baseUrl,
  })));
}

async function cloudstream() {
  // كود المصادر نفسه: استنساخ سطحي (واجهة GitHub قد تُحدّ)، ثم mainUrl من كل ملف Kotlin
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, readdirSync, readFileSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'cs3-src-'));
  execFileSync('git', ['clone', '-q', '--depth', '1', CS3_REPO, dir], { stdio: 'ignore', timeout: 120000 });
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === '.git' ? [] : walk(p)) : [p]; });
  const rows = new Map();
  // ملف المصدر (: MainAPI) قبل ملفات المستخرجات، فلا يُقرأ عنوان سيرفر فيديو على أنه موقع الإضافة
  const files = walk(dir).filter((p) => p.endsWith('.kt') && p.includes('/src/main/'))
    .map((p) => [p, readFileSync(p, 'utf8')]).sort(([, a], [, b]) => Number(/:\s*MainAPI\s*\(/.test(b)) - Number(/:\s*MainAPI\s*\(/.test(a)));
  for (const [file, text] of files) {
    const plugin = file.slice(dir.length + 1).split('/')[0];
    const fixed = text.match(/mainUrl\s*=\s*"(https?:\/\/[^"$]+)"/)?.[1];
    // نطاق يُحسب وقت التشغيل ("https://$host"): الإضافة تتبع انتقال الموقع بنفسها
    const dynamic = !fixed && /mainUrl\s*=\s*"https?:\/\/\$/.test(text);
    if (!rows.has(plugin) && (fixed || dynamic)) rows.set(plugin, { kind: 'cs3', name: plugin, label: plugin, base: fixed ?? null, dynamic });
  }
  return [...rows.values()];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
  const addons = [...(await aniyomi()), ...(await cloudstream())];
  const results = [];
  for (let i = 0; i < addons.length; i += 8) {
    results.push(...await Promise.all(addons.slice(i, i + 8).map(async (a) =>
      ({ ...a, ...(a.base ? await visit(a.base) : { state: 'dynamic', why: 'الدومين يُحسب وقت التشغيل' }) }))));
  }
  // الموقع نفسه بإضافتين: أيهما يصل لموقع يعمل
  const bySite = new Map();
  for (const r of results.filter((x) => x.base)) { const k = siteOf(new URL(r.base).host).split('.')[0].replace(/\d+$/, ''); (bySite.get(k) ?? bySite.set(k, []).get(k)).push(r); }
  const lines = ['| النوع | الإضافة | الموقع في الإضافة | الحال | التفصيل | عنوان الصفحة |', '|---|---|---|---|---|---|'];
  const order = { ok: 0, 'moved-same-site': 1, dynamic: 2, moved: 3, cloudflare: 4, blocked: 5, down: 6 };
  for (const r of results.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name))) {
    lines.push(`| ${r.kind} | ${r.name} | ${r.base ? new URL(r.base).host : '—'} | ${r.state} | ${r.why} | ${(r.title ?? '').replace(/\|/g, '/')} |`);
  }
  const twins = [...bySite.entries()].filter(([, v]) => new Set(v.map((x) => x.kind)).size > 1)
    .map(([k, v]) => `- ${k}: ${v.map((x) => `${x.kind}/${x.name}=${x.state}`).join('، ')}`);
  const count = (s) => results.filter((r) => r.state === s).length;
  process.stdout.write(`${lines.join('\n')}\n\n**${results.length} إضافة:** يعمل ${count('ok') + count('moved-same-site')}، دومين ديناميكي ${count('dynamic')}، انتقل ${count('moved')}، Cloudflare ${count('cloudflare')}، محجوب ${count('blocked')}، متوقف ${count('down')}\n\n### مواقع لها إضافتان\n${twins.join('\n')}\n`);
  if (out) writeFileSync(out, JSON.stringify(results, null, 2));
}
