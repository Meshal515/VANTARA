#!/usr/bin/env node
/**
 * جدول اعتماد المصادر من سطور VANTARA_CERT (ملف أو مجلد ملفات cert.jsonl).
 * لكل مصدر: التغطية (مشهور/متوسط/نادر: وُجد ← اشتغل)، الاحتياط (أعمال فيها سيرفران جاهزان فأكثر)،
 * صدق «جاهز» (سيرفرات قيل إنها جاهزة ثم فشلت)، زمن أول إطار، والإطارات المفكوكة والساقطة.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(path) {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name))).filter((f) => f.endsWith('.jsonl'));
}

export function parse(text) {
  return text.split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const tierCell = (t) => (t ? `${t.playable}/${t.found}` : '—');

const STAGES = { setup: 'التهيئة', repository: 'المستودع', index: 'فهرس المستودع', install: 'التثبيت', route: 'ربط المصدر', catalogue: 'الكتالوج', works: 'الأعمال' };

/** حال الموقع خارج الإضافة: انتقل لمضيف آخر، أو يطلب تحقق Cloudflare، أو لا يرد. */
export function site(s) {
  if (s.siteMovedTo) return `الموقع انتقل إلى ${s.siteMovedTo}`;
  if (s.siteChallenge) return 'الموقع يطلب تحقق Cloudflare';
  if (s.site && s.site !== 'UNKNOWN_BASE') return `الموقع لا يرد (${s.site})`;
  if (s.siteStatus >= 400) return `الموقع ردّ ${s.siteStatus}`;
  return '';
}

// مالك كل فشل: فانتارا (يُصلَح، والهدف صفر)، الإضافة أو الموقع (يُبلَّغ)، أو غير مصنّف (يُحقَّق فيه، لا يُفترض)
const VANTARA = /^(BINDING_|WORKER_|PROCESS_DIED|IPC_CONTRACT|INVALID_DEADLINE|ABI_MISMATCH|UNSUPPORTED_HTTP_CLIENT_ABI|ORIGIN_NOT_ALLOWED|RUNTIME_|SOURCE_NOT_ROUTED|PIPE_CAPACITY|PROFILE_|PLAYER_|ISOLATION_REQUIRED|PLATFORM_UNSUPPORTED)/;
const SITE = /^(SITE_|VERIFICATION_REQUIRED|TRANSPORT_FAILED|RATE_LIMITED|HOST_COOLDOWN|CloudflareBypassException|SocketTimeoutException|UnknownHostException|SSLHandshakeException|ConnectException)|HTTP error (403|429|5\d\d)|HTTP (403|429|5\d\d)/;
const ADDON = /^(NO_[A-Z_]+_RESULT|NO_VIDEO_LINKS|EXTENSION_PARSE|PROVIDER_FAILED|PROVIDER_INITIALIZATION_FAILED|NO_REGISTERED_SOURCES|PACKAGE_NOT_IN_REPOSITORY|PLUGIN_NOT_IN_REPOSITORY|PACKAGE_HASH_MISMATCH|EMPTY_EPISODES|INVALID_[A-Z_]+_RESULT|INVALID_EPISODE_DATA|EMPTY_PAGE|NullPointerException|IndexOutOfBoundsException|IllegalStateException|NumberFormatException|UnsupportedOperationException)|HTTP error (404|410)|HTTP (404|410)/;

/** مالك رمز فشل واحد في مرحلته. مهلة التثبيت لا تلمس الشبكة (التسجيل ممنوع من الاتصال)، فهي من فانتارا. */
export function owner(code, stage = '') {
  const raw = String(code ?? '').replace(/^(popular|latest)#\d+:/, '');
  // «@library:…» مكتبة مشتركة: لا تحسم، فتُكمل قواعد الرمز على نصه دون الإطار
  const c = raw.replace(/ @library:[\w.$]*$/, '');
  if (!c) return 'unknown';
  // مكان الرمي يحسم ما لا يحسمه نوع الاستثناء: إطار فانتارا عطلها، وإطار الإضافة عطل الإضافة
  // الفحص يحسمه بمحمّل الفئات: فئة لا يحمّلها التطبيق من داخل الإضافة وحدها
  const at = c.match(/ @(vantara|extension|library):[\w.$]*$/)?.[1];
  if (at === 'vantara') return 'vantara';
  if (at === 'extension') return 'addon';
  if (VANTARA.test(c)) return 'vantara';
  if (c.startsWith('OPERATION_TIMEOUT')) return stage === 'install' ? 'vantara' : 'site';
  if (SITE.test(c)) return 'site';
  if (ADDON.test(c)) return 'addon';
  return 'unknown';
}

/** كل فشل في سطور مصدر واحد مع مالكه: المصدر، والكتالوج (مع حال الموقع)، والأعمال، و«جاهز» الذي لم يشتغل. */
export function failures(source, works = []) {
  const out = [];
  if (source.code) out.push({ code: source.code, owner: owner(source.code, source.stage) });
  else if (!source.worksTested) {
    // كتالوج فارغ: الموقع المنتقل أو المحجوب يحمل المسؤولية قبل الإضافة
    const moved = site(source);
    if (moved) out.push({ code: moved, owner: 'site' });
    else for (const e of source.catalogueErrors ?? []) out.push({ code: e, owner: owner(e, 'catalogue') });
    if (!out.length) out.push({ code: 'EMPTY_CATALOGUE', owner: 'addon' });
  }
  for (const w of works) {
    if (w.details) out.push({ code: w.details, owner: owner(w.details, 'details') });
    if (w.code) out.push({ code: w.code, owner: owner(w.code, w.stage) });
    // «جاهز» فشل في المشغّل الأصلي: وعد فانتارا للمستخدم، فهو عطل فانتارا مهما كان سببه
    // لا سيرفر أصلًا: جواب المصدر نفسه (NO_VIDEO_LINKS = الإضافة لم تُرجع روابط)
    if (!w.code && w.noRoute) out.push({ code: `NO_ROUTE:${w.noRoute}`, owner: w.noRoute === 'EMPTY_CANDIDATES' ? 'addon' : owner(w.noRoute, 'servers') });
    // عمل بلا سيرفر جاهز: سبب كل سيرفر من تتبّع التجهيز («لا رابط فيديو» = الإضافة لم تُرجع رابطًا)
    if (!w.code && w.ready === 0 && (w.routes ?? 0) > 0) {
      const why = w.unavailableReasons?.[0] ?? 'NO_READY_SERVER';
      // «لا رابط فيديو» و«الإضافة: …» الإضافة؛ «انتهت مهلة السيرفر» الموقع؛ «رابط غير قابل للتشغيل» رفضه فانتارا
      const who = /لا رابط فيديو|NO_VIDEO_LINKS|^الإضافة:/.test(why) ? 'addon' : /انتهت مهلة السيرفر/.test(why) ? 'site'
        : /رابط غير قابل للتشغيل/.test(why) ? 'vantara' : owner(why, 'servers');
      out.push({ code: `NO_READY_SERVER:${why}`, owner: who });
    }
    for (const p of w.played ?? []) {
      if (p.verdict !== 'FALSE_READY') continue;
      // أول إطار ظهر والوقت تقدّم بلا خطأ ولا انتقال، أبطأ من الحد: فك برمجي على المحاكي (1080p)، لا سيرفر يكذب
      if (p.code === 'CLOCK_STALLED' && p.ttffMs > 0 && p.decoded > 0 && p.advancedMs > 0) { out.push({ code: 'FALSE_READY:CLOCK_STALLED', owner: 'slow' }); continue; }
      // أول إطار ظهر ثم لم يُفك غيره في نافذة القياس، بلا خطأ ولا انتقال: الفك البرمجي على المحاكي (1080p) نفسه
      if (p.code === 'NO_FRAMES' && p.ttffMs > 0 && !p.playerError) { out.push({ code: 'FALSE_READY:NO_FRAMES', owner: 'slow' }); continue; }
      // انتقل المشغّل عند ميزانية البدء بلا خطأ تشغيل: أول مقطع بطيء (المحاكي يفك برمجيًا)، يُعرض منفصلًا لا عطلًا
      // سبب المشغّل نفسه يحسم: مهلة أول إطار/البدء بلا خطأ شبكة ولا رد HTTP مرفوض = بطء بداية (فك برمجي/خادم بطيء)
      const watchdog = /FIRST_VIDEO_FRAME_TIMEOUT|STARTUP_TIMEOUT|FIRST_AUDIO_OUTPUT_TIMEOUT/.test(p.playerReason ?? '') && !p.httpFailure && !p.playerError;
      const slow = watchdog || (p.code === 'SWITCHED_BEFORE_FRAME' && !p.playerReason && p.switchedAtMs >= (p.startupBudgetMs ?? 15000) - 1500);
      out.push({ code: `FALSE_READY:${p.code ?? ''}`, owner: slow ? 'slow' : 'vantara' });
    }
  }
  return out;
}

export function verdict(s) {
  if (s.code) return `لم يكتمل: ${s.code}${s.stage ? ` عند ${STAGES[s.stage] ?? s.stage}` : ''}`;
  if (!s.worksTested) {
    const why = [site(s), s.catalogueErrors?.[0]].filter(Boolean).join('؛ ');
    return `لا أعمال في الكتالوج${why ? ` (${why})` : ''}`;
  }
  if (s.falseReady > 0) return 'جاهز يكذب';
  const rate = s.worksPlayable / s.worksTested;
  if (rate >= 0.9 && s.worksWithBackup / s.worksTested >= 0.5) return 'معتمد';
  if (rate >= 0.6) return 'يعمل جزئيًا';
  return 'لا يعتمد';
}

export function table(records) {
  const sources = records.filter((r) => r.type === 'source');
  const worksOf = (name) => records.filter((r) => r.type === 'work' && r.name === name);
  const lines = [
    '### اعتماد المصادر: 30 عملًا لكل مصدر (مشهور/متوسط/نادر) حتى أول إطار في المشغّل الأصلي',
    '',
    '| المصدر | النوع | الحكم | أعطال فانتارا | الإضافة/الموقع | بطء بداية | غير مصنّف | مشهور | متوسط | نادر | فيها احتياط | سيرفرات فُتحت | جاهز فشل | أول إطار (وسيط) | إطارات مفكوكة/ساقطة |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  let engine = 0;
  let unknown = 0;
  for (const s of sources.sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
    const f = failures(s, worksOf(s.name));
    const of = (o) => f.filter((x) => x.owner === o);
    const cell = (list) => (list.length ? `${list.length} (${[...new Set(list.map((x) => x.code))].slice(0, 3).join('، ')})` : '0');
    engine += of('vantara').length; unknown += of('unknown').length;
    lines.push(`| ${s.name} | ${s.kind}/${s.content ?? '?'} | ${verdict(s)} | ${cell(of('vantara'))} | ${of('addon').length + of('site').length} | ${of('slow').length} | ${cell(of('unknown'))} | ${tierCell(s.tiers?.popular)} | ${tierCell(s.tiers?.mid)} | ${tierCell(s.tiers?.obscure)} | ${s.worksWithBackup ?? 0}/${s.worksTested ?? 0} | ${s.serversOpened ?? 0} | ${s.falseReady ?? 0}${s.falseReadyCodes?.length ? ` (${s.falseReadyCodes.join('، ')})` : ''} | ${s.ttffMedianMs > 0 ? `${(s.ttffMedianMs / 1000).toFixed(1)} ث` : '—'} | ${s.decodedFrames ?? 0}/${s.droppedFrames ?? 0} |`);
  }
  lines.push('', `**أعطال فانتارا: ${engine}** (الهدف صفر)، وغير المصنّف: ${unknown} (يُحقَّق فيه قبل نسبته لأحد).`);
  lines.push('', 'الخلية «اشتغل/وُجد». «جاهز فشل» = سيرفر عرضته ورقة السيرفرات جاهزًا ثم لم يصل لأول إطار أو توقف أو انتقل المشغّل لغيره. الإطارات الساقطة هنا من فك برمجي على المحاكي؛ السلاسة تُعتمد على جهاز فعلي.');
  return lines.join('\n');
}

const MANGA_STEPS = ['download', 'load', 'popular', 'latest', 'series', 'pages', 'image'];
// «غير مدعوم» نقص في محرك فانتارا نفسه، فيُعدّ عليه كعطله
const MANGA_OWNER = { site: 'site', extension: 'addon', vantara: 'vantara', unsupported: 'vantara' };

/** رحلة مصدر مانجا واحد: أين وقفت ومن يملك وقوفها. نجاحها = صورة صفحة حقيقية. */
export function mangaRows(records) {
  const rows = [];
  for (const r of records.filter((x) => x.extension)) {
    const fail = (o) => MANGA_STEPS.map((k) => [k, o?.[k]]).find(([, v]) => v?.result === 'FAIL');
    const top = fail(r);
    if (top || !r.sources?.length) {
      const [step, v] = top ?? ['load', { code: 'NO_SOURCES', owner: 'extension' }];
      rows.push({ name: r.extension, origin: r.origin, source: '—', ok: false, step, code: v.code, owner: MANGA_OWNER[v.owner] ?? 'unknown' });
      continue;
    }
    for (const s of r.sources) {
      const f = fail(s);
      // الرائج فشل والأحدث نجح: المصدر قرأ كتالوجه، فلا يُحسب الأول عطلًا
      const real = f && !(f[0] === 'popular' && s.latest?.result === 'PASS') ? f : (f?.[0] === 'popular' ? fail({ ...s, popular: undefined }) : f);
      const ok = s.image?.result === 'PASS';
      const why = real ?? (ok ? null : [s.chapters === 0 ? 'series' : 'pages', { code: s.chapters === 0 ? 'NO_CHAPTERS' : 'NO_PAGES', owner: 'extension' }]);
      rows.push({ name: r.extension, origin: r.origin, source: s.name, ok, step: why?.[0], code: why?.[1].code, owner: why ? MANGA_OWNER[why[1].owner] ?? 'unknown' : null });
    }
  }
  return rows;
}

export function mangaTable(records) {
  const rows = mangaRows(records);
  if (!rows.length) return '';
  const lines = ['### المانجا: من تحميل الحزمة حتى صورة صفحة حقيقية', '', '| الإضافة | المصدر | الأصل | النتيجة | وقف عند | الرمز | المالك |', '|---|---|---|---|---|---|---|'];
  const label = { vantara: '**فانتارا**', addon: 'الإضافة', site: 'الموقع', unknown: 'غير مصنّف' };
  for (const r of rows.sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name))) {
    lines.push(`| ${r.name} | ${r.source} | ${r.origin ?? ''} | ${r.ok ? 'يعمل' : 'لا يعمل'} | ${r.step ?? '—'} | ${r.code ?? '—'} | ${r.owner ? label[r.owner] : '—'} |`);
  }
  const engine = rows.filter((r) => r.owner === 'vantara').length;
  lines.push('', `**المانجا: ${rows.filter((r) => r.ok).length}/${rows.length} يعمل، أعطال فانتارا: ${engine}** (الهدف صفر).`);
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] ?? '.';
  const records = files(target).flatMap((f) => parse(readFileSync(f, 'utf8')));
  process.stdout.write(`${table(records)}\n`);
  const manga = mangaTable(records);
  if (manga) process.stdout.write(`\n${manga}\n`);
}
