import { diagnosticsUi } from '../lib/diagnostics-ui.js';
/**
 * ورقة السيرفرات المشتركة بين الأنمي والسينما.
 *
 * هادئة على طريقة Stremio لا نسخة منه: فوقها صورة الحلقة بشعار العمل، ثم سطر
 * معلومات واحد (التقييم · التاريخ · المدة) والعنوان والوصف، ثم المصادر قائمةً
 * نظيفة — كل صفّ: الجودة نصًا، المصدر، سطر مواصفات خافت، واللغة نصًا لا رقائق.
 * المقترح علامة صغيرة على صفّه، وزرّ واحد «شغّل الأفضل»؛ «شاهد مع أصدقائك» ثانوي.
 * لا توهّج ولا حدود نيون ولا ألوان متناثرة: لون القسم للفعل الأساسي والمختار وحدهما.
 *
 * الترتيب: السيرفرات المباشرة أولًا (تبدأ فورًا)، ثم التورنت (يبدأ أبطأ ويحتاج
 * مشاركين)، وما يُجهَّز بعد وما تعذّر مطويّان. الورقة لا تملك جلسة التشغيل:
 * من يفتحها (الأنمي/السينما) يمرّر السيرفرات وحالتها ويقرّر ماذا يحدث عند اللمس.
 */
import { parseRelease, swarmTier } from '../addons/release-info.js';
import { isCloudStreamRoute, isTorrentRoute, ROUTE_ENGINES, routeEngine } from '../lib/route-family.js';
import { engineMark } from '../lib/engine-marks.js';
import { glyph } from './icons.js';
import { flingHoldRisk } from './collapse-hero.js';
import { rememberStart, startFeatures } from '../lib/start-memory.js';
import { isChecking, isUnavailable, isValid, measuredSeeds, pieceScore, scoreRoute, validity, VALIDITY_AR } from '../lib/route-validity.js';

/** https أو صورة PNG مضمّنة صغيرة فقط: لا مخطط آخر يصل إلى CSS. */
const safeIconUrl = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (/^https:\/\/[^\s"'()\\]{1,2000}$/i.test(text)) return text;
  if (text.length <= 90 * 1024 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(text)) return text;
  return null;
};

export const isAddonRoute = (r) => String(r?.sourceId ?? '').startsWith('addon|');
export { isCloudStreamRoute, isTorrentRoute } from '../lib/route-family.js';

const ADDON_NAMES = { torrentio: 'Torrentio', comet: 'Comet', mediafusion: 'MediaFusion', knightcrawler: 'KnightCrawler', jackettio: 'Jackettio', peerflix: 'Peerflix', orion: 'Orion', annatar: 'Annatar', torbox: 'TorBox', debridio: 'Debridio' };
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * اسم إضافة من معرّفها الداخلي «addon|https://torrentio.strem.fun|com.stremio.torrentio.addon»:
 * «Torrentio». المضيف أصدق من المعرّف؛ comet.elfhosted.com ← Comet.
 */
export function addonName(sourceId) {
  const [, url = '', id = ''] = String(sourceId ?? '').split('|');
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = /^[a-z0-9.-]+$/i.test(url) ? url : ''; }
  for (const part of [...host.split('.'), ...id.split('.')]) {
    const known = ADDON_NAMES[part.toLowerCase()];
    if (known) return known;
  }
  const first = host.split('.')[0];
  if (first && !/^(?:addon|api|stremio|app)$/i.test(first)) return capital(first);
  const tail = id.split('.').filter((p) => !/^(?:com|org|net|io|stremio|addon|app)$/i.test(p))[0];
  return tail ? capital(tail) : 'إضافة';
}

/** اسم مصدر للعرض: الاسم المعروف، ثم عنوان نسخة الإضافة، ثم ما يُستخرج من معرّفها. */
export function sourceLabel(sourceId, { names = {}, title = null } = {}) {
  if (names[sourceId]) return names[sourceId];
  if (isAddonRoute({ sourceId })) return (title && !/^addon\|/.test(title) ? title : null) ?? addonName(sourceId);
  return sourceId;
}

const HOSTS = { streamwish: 'StreamWish', hgcloud: 'HG Cloud', mp4upload: 'Mp4Upload', 'ok.ru': 'OK.ru', okru: 'OK.ru', videa: 'Videa', megamax: 'Megamax', doodstream: 'DoodStream', dood: 'DoodStream', voe: 'VOE', filemoon: 'FileMoon', vidmoly: 'Vidmoly', uqload: 'Uqload', streamtape: 'Streamtape', mixdrop: 'Mixdrop', sendvid: 'SendVid', vidguard: 'VidGuard', lulustream: 'LuluStream', mega: 'MEGA', yourupload: 'YourUpload', 'vk.com': 'VK', vk: 'VK', drive: 'Google Drive', gdrive: 'Google Drive', dailymotion: 'Dailymotion', streamhg: 'StreamHG', earnvids: 'EarnVids', vidhide: 'VidHide' };
/** اسم استضافة مقروء: «streamwish» ← StreamWish. الأسماء العربية تبقى كما هي. */
export function hostName(server) {
  const s = String(server ?? '').trim();
  if (!s) return null;
  if (/[؀-ۿ]/.test(s)) return s;
  const key = s.toLowerCase().replace(/^www\./, '').replace(/\.(?:com|net|org|io|to|tv|cc|pro|co|xyz|sx)$/, '');
  return HOSTS[key] ?? HOSTS[s.toLowerCase()] ?? (/^[a-z0-9.-]+$/.test(s) ? capital(key) : s);
}

/** فرقة الإصدار من اسم الملف: «[SubsPlease] …» أو «…-VARYG». */
export function releaseGroup(filename) {
  const f = String(filename ?? '').replace(/\.(?:mkv|mp4|avi|webm)$/i, '');
  return /^\[([^\]]{2,24})\]/.exec(f)?.[1] ?? /-([A-Za-z][A-Za-z0-9]{1,15})$/.exec(f)?.[1] ?? null;
}

const bucket = (q) => (!Number.isFinite(q) || q <= 0 ? null : q >= 2000 ? 2160 : q >= 1400 ? 1440 : q >= 1000 ? 1080 : q >= 700 ? 720 : 480);
export const qualityLabel = (b) => (b == null ? 'تلقائي' : b === 2160 ? '4K' : b === 480 ? 'SD' : `${b}p`);
const QUALITY_PREF = { 1080: 5, 2160: 4, 1440: 4, 720: 3, 480: 1 };

/** ما يحتاجه الصف ليُرسم: الاسم والنوع والجودة واللغة والصحة. */
export function describe(r, ctx = {}) {
  const torrent = isTorrentRoute(r);
  // وصف التورنت (البذور والحجم والموقع) من وسمه، لأي تورنت: إضافة Stremio أو إضافة Aniyomi (Torrentio Anime)
  let info = (isAddonRoute(r) || torrent) && r.label ? parseRelease(r.sourceName ?? r.server ?? '', r.label) : null;
  if (torrent && Number.isFinite(r.seeders)) info = { ...info, seeders: r.seeders };
  const q = bucket(r.quality ?? info?.quality);
  const name = torrent
    ? (info?.provider || r.sourceName || ctx.sourceName?.(r) || 'إضافة')
    : isCloudStreamRoute(r)
      ? (r.sourceName || ctx.sourceName?.(r) || 'مصدر مباشر')
      : (ctx.sourceName?.(r) ?? r.sourceName ?? r.sourceId ?? 'سيرفر');
  const host = torrent ? ([...new Set([info?.site, releaseGroup(info?.filename)].filter(Boolean))].join(' · ') || info?.filename) : hostName(r.server) ?? (r.code && !/^[A-Z0-9]{2,5}$/.test(r.code) ? r.code : null);
  const langs = [];
  if (torrent) {
    if (info?.arabic) langs.push({ t: 'عربي', ar: true });
    if (info?.multiAudio) langs.push({ t: 'صوت متعدد' });
    else if (r.variant === 'DUB' || info?.dubbed) langs.push({ t: 'مدبلج' });
    if (info?.multiSubs && !info?.arabic) langs.push({ t: 'ترجمات متعددة' });
  } else if (r.variant === 'DUB') langs.push({ t: ctx.dubLabel ?? 'مدبلج', ar: true });
  else if (ctx.directLang) langs.push({ t: ctx.directLang, ar: true });
  const tier = info ? swarmTier(info.seeders) : null;
  return { torrent, info, q, name: String(name), host: host && host !== name ? host : null, group: torrent ? releaseGroup(info?.filename) : null, langs, tier, hdr: info?.hdr ?? [], prefer: Boolean(ctx.prefer && r.code === ctx.prefer) };
}

/** بدء التشغيل المتوقّع للسيرفر المباشر من زمن فحصه. */
export function speedHint(r) {
  const ms = Number(r.probeMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1500) return 'يبدأ فورًا';
  if (ms < 4000) return 'بدء سريع';
  return 'بدء أبطأ';
}

/**
 * «الأفضل لك»: الصالح وحده يدخل، ثم جدول معايير واحد معلن لكل الأنواع (lib/route-validity.js
 * RANK_CRITERIA): العربية بوزن كبير، ثم ليس CAM، ثم سرعة البدء (زمن الفحص أو المشاركون)، ثم
 * الجودة (1080 أولًا)، ثم الثبات على هذا الجهاز، ثم الترميز (H.264 ثم HEVC ثم AV1)، ثم الحجم.
 * غير الصالح درجته -Infinity فلا يُقترح أبدًا. ترشيح لا قفل: كل صف صالح ما زال يُلمس.
 */
export function rank(r, d) {
  return scoreRoute(r, d).score;
}

/**
 * ترتيب التسخين الخلفي (قرار المالك 26 نوفمبر): السرب 16 درجة، ثم حجم القطعة 12، ثم العربي 2.
 * السرب المقاس إن وصل المحرك إليه وإلا المعلن؛ حجم القطعة المجهول وسط (6).
 */
export function warmScore(d, measured) {
  const seeds = measuredSeeds({ ...d, measured }) ?? d.info?.seeders;
  const swarm = Number.isFinite(seeds) ? 16 * Math.min(1, Math.log10(1 + Math.max(0, seeds)) / 3) : 0;
  const piece = 12 * (pieceScore(measured?.pieceLength) ?? 0.5);
  const arabic = d.langs?.some((l) => l.ar) || d.info?.arabic ? 2 : 0;
  return swarm + piece + arabic;
}

/** أقل سرب يُسخَّن إن وُجد أعلى منه بين الظاهر؛ إن لم يوجد يُسخَّن الموجود. */
export const WARM_MIN_SEEDS = 20;

/**
 * الصفوف الظاهرة غير «المقترح» مرتبة للتسخين الخلفي: `rows` = [{ r, d, m }]. يرجع المعرّفات.
 * ما سربه 20 فأقل يُترك إن وُجد أقوى منه، ويُسخَّن إن لم يوجد غيره.
 */
export function warmRows(rows) {
  const seedsOf = (x) => measuredSeeds({ ...x.d, measured: x.m }) ?? x.d.info?.seeders ?? 0;
  const strong = rows.filter((x) => seedsOf(x) > WARM_MIN_SEEDS);
  return (strong.length ? strong : rows)
    .map((x) => ({ id: x.r.id, s: warmScore(x.d, x.m) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.id);
}

/** آخر صف تورنت لُمس: يُنسب إليه زمن بدء المشغّل الأصلي حين يصل (playstat). */
let lastPick = null;
/** زمن الحدث بساعة Date.now (timeStamp نسبي لبداية الصفحة)، أو الآن إن لم يُعرف. */
export function tapTime(e, perf = globalThis.performance, now = Date.now()) {
  const origin = perf?.timeOrigin;
  const stamp = e?.timeStamp;
  if (Number.isFinite(origin) && Number.isFinite(stamp) && stamp > 0) {
    const at = Math.round(origin + stamp);
    // ساعة الحدث من مصدر آخر (بعض WebView تعطيه من الإقلاع): لا يُقبل ما يتجاوز الآن أو أقدم من دقيقة
    if (at <= now && now - at < 60_000) return at;
  }
  return now;
}
/**
 * زمن البدء الحقيقي من المشغّل الأصلي (`playstat` بمرحلة server): أول إطار، أو تعذّر/انقطاع.
 * يُنسب لصفات آخر تورنت لُمس في العشر دقائق الأخيرة فقط.
 */
export function learnStart(e) {
  if (!lastPick || e?.stage !== 'server' || Date.now() - lastPick.at > 10 * 60000) return;
  const ok = e.outcome === 'ok';
  if (!ok && e.outcome !== 'timeout' && e.outcome !== 'error') return;
  rememberStart(lastPick.features, Number(e.ms) || 0, ok);
  lastPick = null;
}

/**
 * عدد الزارعين بأيقونة أشخاص ولون السرب (أخضر قوي، برتقالي متوسط، أحمر ضعيف). كانت أعمدة تشبه إشارة الشبكة فقرأها
 * مستخدم «Ping بالميلي ثانية» واختار سيرفرًا بلا مشاركين. الرقم كما أعلنه المصدر، فالصفر لا يعني موت التورنت قطعًا.
 */
const SEEDS_HINT = 'عدد الزارعين (Seeders) كما أعلنه المصدر';
const compact = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));


/**
 * سطر الصف الثاني نصًا هادئًا لا رقائق ملوّنة: اللغة أولًا (أوضح قليلًا)، ثم
 * المواصفات بخفوت. سطر واحد لا يُقصّ في منتصف كلمة.
 */
function metaChips(r, d, pending) {
  const out = [];
  for (const l of d.langs) out.push({ t: l.t, cls: l.ar ? 'ar' : 'lang' });
  if (d.torrent) {
    // في الصف ما يقرر الاختيار فقط: اللغة والحجم (الجودة والمشاركون في طرفيه). الباقي في التفاصيل
    if (d.info?.source === 'CAM') out.push({ t: 'CAM', cls: 'cam' });
    if (d.info?.sizeLabel) out.push({ t: d.info.sizeLabel, cls: 'spec' });
    return out;
  }
  const sp = !pending && speedHint(r);
  if (sp) out.push({ t: sp, cls: 'speed' });
  if (d.prefer) out.push({ t: 'سيرفرك السابق', cls: 'prefer' });
  return out;
}

/** تفاصيل نسخة التورنت تحت صفّها: اسم الإصدار والمواصفات التقنية، لمن يريدها فقط. */
function detailLines(r, d) {
  const i = d.info ?? {};
  return [
    ['الإصدار', d.host],
    ['الملف', i.filename && i.filename !== d.host ? i.filename : null],
    ['المصدر', [i.source, i.site].filter(Boolean).join(' · ')],
    ['الترميز', [i.codec, ...(d.hdr ?? [])].filter(Boolean).join(' · ')],
    ['الصوت', i.audio],
    ['الزارعون (Seeders)', Number.isFinite(i.seeders) ? `${i.seeders.toLocaleString('en')} · ${SWARM_AR[d.tier] ?? ''}` : null],
  ].filter(([, v]) => v);
}

const SWARM_AR = { strong: 'سرب قوي', fair: 'سرب متوسط', weak: 'سرب ضعيف', dead: 'لم يعلن المصدر زارعين' };

/** لماذا هذا هو المقترح، بكلمات قليلة: يُقال تحت زر «شغّل الأفضل». */
export function bestReason(r, d) {
  const out = [qualityLabel(d.q), d.name];
  if (d.langs?.some((l) => l.ar) || d.info?.arabic) out.push('عربي');
  if (d.prefer) out.push('سيرفرك السابق');
  if (!d.torrent) out.push(speedHint(r) ?? 'يبدأ فورًا');
  else if (Number.isFinite(d.info?.seeders)) out.push(`${d.info.seeders.toLocaleString('en')} مشارك · ${SWARM_AR[d.tier]}`);
  if (d.torrent && d.info?.sizeLabel) out.push(d.info.sizeLabel);
  return out.filter(Boolean);
}

/** «2009-03-23» ← «23 مارس 2009»، والسنة وحدها تبقى سنة. */
export function factDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 0 && v < 3000) return String(v);
  const t = typeof v === 'number' ? v : Date.parse(String(v));
  if (!Number.isFinite(t)) return /^\d{4}$/.test(String(v)) ? String(v) : null;
  try {
    return new Date(t).toLocaleDateString('ar', { day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn' });
  } catch {
    return new Date(t).toISOString().slice(0, 10);
  }
}

/**
 * يبني الورقة داخل `body` ويعيد {update, best, status, body, scroll}.
 *
 * o: { el, title, kicker, media, onBack, onPick(r), onBest(), onTop(r), onWarmRows(ids), onHover(r), onRetry(), onUnavailable(r),
 *      selectable(r), pending(r), dead(r), sourceName(r), prefer, directLang, extraFoot[] }
 * media: { title, logo, backdrop, backdropFallback, backdropPosition, code ('S01E02'),
 *          label ('الموسم 1 · الحلقة 2'), episodeTitle, description, rating: {value, label},
 *          date, duration, resume ('تكمل من 12:40') }
 *
 * على الهاتف: صفحة واحدة تُمرَّر — صورة الحلقة بالشعار، ثم سطر معلومات هادئ والوصف،
 * ثم المصادر. مع التمرير تنكمش الصورة ويصعد الشعار إلى شريط علوي مضغوط.
 * على الشاشة العريضة (≥ 900px): لوحتان — الصورة الكبيرة بالشعار والوصف في جهة،
 * وقائمة المصادر بمرشّحاتها وزرّ التشغيل في الجهة الأخرى تُمرَّر وحدها.
 */
/** لمسة على صف بعد تحرّك القائمة بأقل من هذا تُهمل (لا تشغيل بالخطأ). */
const TAP_GUARD_MS = 450;
/** الظاهر من كل قسم (المالك، 27 نوفمبر): 10، وما بعده «عرض N من النسخ/الروابط الإضافية». */
export const VISIBLE = 10;
/** حتى خمسة تورنتات من كل جودة، وعشرة إجمالًا في القائمة الأساسية. */
export const PER_QUALITY = 5;
const BOLT = '<svg class="icon ss-bolt" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M13.4 2.2 4.6 13.3a.7.7 0 0 0 .55 1.13h5.6l-1.1 7.2c-.1.66.74 1.02 1.15.5l8.8-11.1a.7.7 0 0 0-.55-1.13h-5.6l1.1-7.2c.1-.66-.74-1.02-1.15-.5Z"/></svg>';

/** الجودة أولًا، ثم عدد الزارعين المعلن، مع سقف لكل مجموعة وللقائمة كاملة. */
export function torrentPlan(items, { quality, seeds }) {
  const byQuality = new Map();
  for (const route of items) {
    const q = quality(route) ?? 0;
    if (!byQuality.has(q)) byQuality.set(q, []);
    byQuality.get(q).push(route);
  }
  return [...byQuality].sort(([a], [b]) => b - a)
    .flatMap(([, routes]) => routes.sort((a, b) => seeds(b) - seeds(a)).slice(0, PER_QUALITY))
    .slice(0, VISIBLE);
}

export function createServerSheet(body, o) {
  let destroyed = false;
  const frames = new Set();
  const subscriptions = [];
  const frame = callback => {
    if (destroyed) return;
    if (typeof requestAnimationFrame !== 'function') return callback();
    let id;
    id = requestAnimationFrame(() => { frames.delete(id); if (!destroyed) callback(); });
    if (id != null) frames.add(id);
  };
  const listen = (target, event, callback, options) => {
    if (!target?.addEventListener) return;
    const guarded = (...args) => { if (!destroyed) callback(...args); };
    target.addEventListener(event, guarded, options);
    subscriptions.push(() => target.removeEventListener?.(event, guarded, options));
  };
  const el = o.el;
  const media = { title: o.title, label: o.kicker, ...(o.media ?? {}) };
  const btn = (cls, html, label) => {
    const b = el('button', cls);
    b.type = 'button';
    if (html) b.innerHTML = html;
    if (label) b.setAttribute('aria-label', label);
    return b;
  };
  const auto = (tag, cls, text) => {
    const n = el(tag, cls, text);
    n.dir = 'auto';
    return n;
  };
  body.classList.add('an-pick', 'ss');
  body.setAttribute('aria-label', ['اختر السيرفر', media.title, media.label].filter(Boolean).join(' — '));

  // ── الشريط العلوي: رجوع، وشعار مضغوط يظهر حين تنكمش الصورة ──
  const bar = el('header', 'an-pick-bar ss-bar');
  const back = btn('an-pick-back', glyph('back', { size: 22 }), 'رجوع');
  back.onclick = () => o.onBack?.();
  const mark = el('div', 'ss-bar-mark');
  mark.setAttribute('aria-hidden', 'true');
  const markTitle = auto('b', 'ss-bar-title', media.title ?? '');
  mark.append(markTitle);
  if (media.label || media.code) mark.append(el('span', 'ss-bar-sub', media.code ?? media.label));
  bar.append(back, mark);

  // ── معلومات الحلقة: الصورة والشعار، ثم سطر الحقائق والعنوان والوصف ──
  const info = el('section', 'ss-info');
  // أعلى الورقة بلغة صفحة العمل: لقطة الحلقة بطاقة في المنتصف فوق جوّ مأخوذ من الصورة نفسها
  // (لا بانر من الحافة للحافة)، والشعار فوقها، وزر «شغّل الأفضل» على البطاقة نفسها
  const art = el('div', 'ss-art');
  const amb = el('img', 'ss-amb');
  amb.alt = '';
  amb.decoding = 'async';
  amb.setAttribute('aria-hidden', 'true');
  const card = el('div', 'ss-card');
  const shot = el('img', 'ss-art-img');
  shot.alt = '';
  shot.decoding = 'async';
  // لقطة الحلقة بأعلى دقة ثم بدائلها (780 ← TVDB) ثم البانر/الغلاف
  const sources = [...new Set([media.backdrop, ...(media.backdropFallbacks ?? []), media.backdropFallback].filter(Boolean))];
  if (sources.length) {
    let i = 0;
    shot.onload = () => shot.classList.add('loaded');
    shot.onerror = () => {
      i += 1;
      if (sources[i]) shot.src = sources[i];
      else art.classList.add('ss-art--none');
    };
    if (media.backdropPosition) shot.style.objectPosition = media.backdropPosition;
    shot.src = sources[0];
    amb.onload = () => amb.classList.add('loaded');
    amb.onerror = () => amb.remove();
    amb.src = sources[0];
    card.append(shot);
    art.append(amb, card);
  } else {
    art.classList.add('ss-art--none');
    art.append(card);
  }
  const brand = el('div', 'ss-brand');
  const name = auto('h2', 'ss-title', media.title ?? '');
  brand.append(name);
  if (media.logo) {
    // الشعار بدل الاسم؛ إن تعذّر يبقى الاسم نصًا — لا تخمين
    brand.classList.add('ss-brand--logo');
    const logo = el('img', 'ss-logo');
    logo.alt = media.title ?? '';
    logo.decoding = 'async';
    logo.onload = () => logo.classList.add('loaded');
    logo.onerror = () => {
      logo.remove();
      brand.classList.remove('ss-brand--logo');
      bar.classList.remove('ss-bar--logo');
    };
    logo.src = media.logo;
    brand.prepend(logo);
    const small = el('img', 'ss-bar-logo');
    small.alt = '';
    small.onerror = () => small.remove();
    small.src = media.logo;
    mark.prepend(small);
    bar.classList.add('ss-bar--logo');
  }
  const about = el('div', 'ss-about');
  const facts = el('div', 'ss-facts');
  const fact = (node) => facts.append(node);
  const rating = Number(media.rating?.value ?? media.rating);
  if (Number.isFinite(rating) && rating > 0) {
    const f = el('span', 'ss-fact ss-fact--rate');
    if (media.rating?.label) f.append(el('small', 'ss-rate-src', media.rating.label));
    else f.insertAdjacentHTML('beforeend', glyph('star', { size: 13, filled: true }));
    const v = el('bdi', null, rating.toFixed(1));
    v.dir = 'ltr';
    f.append(v);
    fact(f);
  }
  const when = factDate(media.date);
  if (when) fact(el('span', 'ss-fact', when));
  if (media.duration) fact(el('span', 'ss-fact', media.duration));
  if (facts.children.length) about.append(facts);
  if (media.code || (media.label && media.episodeTitle)) {
    const ep = el('div', 'ss-ep');
    if (media.code) {
      const code = el('bdi', 'ss-ep-code', media.code);
      code.dir = 'ltr';
      ep.append(code);
    }
    if (media.label) ep.append(el('span', 'ss-ep-no', media.label));
    about.append(ep);
  } else if (media.label && media.label !== 'فيلم') about.append(el('div', 'ss-ep', media.label));
  if (media.episodeTitle && media.episodeTitle !== media.title) about.append(auto('h3', 'ss-ep-title', media.episodeTitle));
  if (media.description) {
    // dir=auto: الوصف الإنجليزي يُقرأ من اليسار بنقطته في آخره، والعربي من اليمين
    const desc = auto('p', 'ss-desc clamped', media.description);
    const more = btn('ss-more', 'المزيد');
    more.hidden = true;
    more.onclick = () => {
      const closed = desc.classList.toggle('clamped');
      more.textContent = closed ? 'المزيد' : 'أقل';
    };
    about.append(desc, more);
    // «المزيد» فقط إن كان الوصف أطول من ثلاثة أسطر فعلًا
    const measure = () => {
      if (desc.scrollHeight - desc.clientHeight > 2) more.hidden = false;
    };
    frame(measure);
  }
  if (media.resume) {
    const r = el('div', 'ss-resume');
    r.innerHTML = glyph('history', { size: 15 });
    r.append(el('span', null, media.resume));
    about.append(r);
  }
  // الشعار شقيق الصورة لا ابنها: على الهاتف يعلوها، وعلى الشاشة العريضة يجلس فوق الوصف
  info.append(art, brand, about);

  // ── المصادر: المرشّحات وسطر الحالة ثم القائمة ──
  const src = el('section', 'ss-src');
  // عنوان الورقة كما في الجوال («السيرفرات» ورقم الحلقة): يظهر في الورقة الجانبية للغرفة حيث لا لوحة معلومات
  const roomHead = el('div', 'ss-room-head');
  roomHead.append(el('h2', null, 'السيرفرات'));
  if (media.label) roomHead.append(el('small', null, media.label));
  src.append(roomHead);
  const tools = el('div', 'ss-tools');
  const toolsHead = el('div', 'ss-tools-head');
  // لا عنوان «المصادر»: المرشّحات أول ما تحت الحلقة، وسطر الحالة يظهر وقت التجهيز فقط
  const status = el('div', 'an-srv-status');
  const statusSpinner = el('i', 'ss-spin'), statusText = el('span');
  status.append(statusText);
  toolsHead.append(status);
  const filters = el('div', 'an-pick-filters');
  tools.append(toolsHead, filters);
  const list = el('div', 'an-srv-list');
  // حجز ارتفاع القائمة (holdHeight): عنصر بعدها لا أصل للصفوف، فتغيّره لا يوقف تثبيت التمرير في المتصفح
  const hold = el('div', 'ss-hold');
  hold.setAttribute('aria-hidden', 'true');
  src.append(tools, list, hold);

  const scroll = el('div', 'an-pick-scroll');
  scroll.append(info, src);

  const best = btn('an-pick-best');
  // على الهاتف: «شغّل الأفضل» على البطاقة، و«شاهد مع أصدقائك» رمز في أعلى الورقة. على الشاشة
  // العريضة يبقيان في تذييل لوحة المصادر كما صُمّمت
  const extras = el('div', 'ss-bar-extras');
  const foot = el('footer', 'an-pick-foot');
  bar.append(extras);
  body.append(bar, scroll, foot);

  // Debug actions live below source content; header geometry belongs to navigation/friends.
  const diagnostics = el('div', 'ss-diagnostics');
  // مسجّل القفزات (يظهر مع التشخيص فقط): سطر يُنسخ، يُملأ أدناه
  const jumpLine = el('button', 'ss-jumps');
  jumpLine.type = 'button';
  jumpLine.hidden = true;
  const paintDiagnostics = () => {
    const shown = o.jumpProbe ?? diagnosticsUi.visible();
    diagnostics.replaceChildren();
    diagnostics.hidden = !shown;
    if (shown) {
      const action = o.diagnosticAction?.();
      if (action) diagnostics.append(action);
      diagnostics.append(jumpLine);
      diagnostics.hidden = !action && jumpLine.hidden;
    }
  };
  scroll.append(diagnostics);
  subscriptions.push(diagnosticsUi.subscribe(paintDiagnostics));
  paintDiagnostics();

  // ── الانكماش مع التمرير (الهاتف فقط): تحويل وشفافية لا غير، عبر متغيّرين ──
  const mq = (q) => (typeof matchMedia === 'function' ? matchMedia(q) : null);
  const wide = mq('(min-width: 900px)');
  const scrollSurface = () => wide?.matches ? src : scroll;
  const placeActions = () => {
    if (wide?.matches) foot.append(best, ...(o.extraFoot ?? []));
    else {
      // تحت البطاقة لا عليها: الصورة تبقى واضحة كاملة
      art.append(best);
      extras.append(...(o.extraFoot ?? []));
    }
    foot.hidden = !wide?.matches;
  };
  placeActions();
  listen(wide, 'change', placeActions);
  const still = mq('(prefers-reduced-motion: reduce)');
  let ticking = false;
  let lastSpan = -1;
  const collapse = () => {
    ticking = false;
    if (wide?.matches) {
      body.style.setProperty('--ss-y', '0px');
      body.style.setProperty('--ss-p', '0');
      body.style.setProperty('--ss-bar', '0');
      return;
    }
    const y = Math.max(0, scroll.scrollTop || 0);
    // المدى حتى نهاية بطاقة اللقطة تحت الترويسة (البطاقة لم تعد بارتفاع البانر كله)
    const span = Math.max(1, (art.offsetTop || 0) + (art.offsetHeight || 0) - (bar.offsetHeight || 0));
    const p = Math.min(1, y / span);
    // الشريط يمتلئ في آخر ثلث الانكماش، والشعار المضغوط يظهر معه
    const solid = Math.min(1, Math.max(0, (p - 0.62) / 0.38));
    if (still?.matches) {
      body.style.setProperty('--ss-y', '0px');
      body.style.setProperty('--ss-p', '0');
      body.style.setProperty('--ss-bar', p >= 0.8 ? '1' : '0');
      return;
    }
    // مدى الخط الزمني في CSS هو مدى هذا المسار نفسه: لا قفزة عند تسليم الانزلاق
    if (span !== lastSpan) {
      lastSpan = span;
      body.style.setProperty('--ss-span', `${span}px`);
    }
    body.style.setProperty('--ss-y', `${Math.min(y, span).toFixed(1)}px`);
    body.style.setProperty('--ss-p', p.toFixed(3));
    body.style.setProperty('--ss-bar', solid.toFixed(3));
  };
  listen(scroll, 'scroll', () => {
    if (ticking) return;
    ticking = true;
    frame(collapse);
  }, { passive: true });
  listen(wide, 'change', collapse);
  collapse();
  // الصورة والشعار يتحركان بخط CSS مربوط بتمرير الورقة نفسها (كانت الكتابة بعد حدث scroll
  // متأخرة إطارًا فتهتز). WebView 153–156 يحبس الانزلاق بعد رفع الإصبع ما دامت حركة مربوطة
  // بالتمرير، فأثناء الانزلاق تُوقف حركة CSS وتعمل المتغيرات التي يكتبها collapse بنفس القيم.
  // نفس قواعد collapse-hero.js (CLAUDE.md): في WebView وحده (flingHoldRisk)، والحكم بحركة الإصبع نفسها، والتسلّم عند حد
  // الإطار التالي لا في حدث الرفع. كانت هذه النسخة تتسلّم في touchend وموضع التمرير فيه متأخر عن الشاشة بآخر حركة للإصبع،
  // فتُكتب قيمة أقدم مما يرسمه CSS وترتد الصورة بقدرها مع كل رفعة؛ وتحكم بالحركة من حدث scroll وحده، والزحلقة السريعة
  // يصل تمريرها بعد الرفع فتفوت التسليم فيُحبس الانزلاق ثم يُلقى دفعة واحدة (crbug 572898003).
  let handed = false;
  let moved = false;
  let touching = false;
  let startY = 0;
  let settleTimer = null;
  let takeover = null;
  const holdRisk = flingHoldRisk();
  const handBack = () => {
    clearTimeout(settleTimer);
    if (!handed) return;
    handed = false;
    body.classList.remove('ss-handed');
  };
  listen(scroll, 'touchstart', (e) => {
    if (takeover != null) globalThis.cancelAnimationFrame?.(takeover);
    takeover = null;
    touching = true;
    moved = false;
    startY = e?.touches?.[0]?.clientY ?? 0;
    handBack();
  }, { passive: true });
  listen(scroll, 'scroll', () => {
    if (touching) moved = true;
    if (handed) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(handBack, 180);
    }
  }, { passive: true });
  const fling = (e) => {
    touching = false;
    const endY = e?.changedTouches?.[0]?.clientY;
    if (endY != null && Math.abs(endY - startY) > 6) moved = true;
    if (!holdRisk || !moved || typeof requestAnimationFrame !== 'function') return;
    takeover = requestAnimationFrame(() => {
      takeover = null;
      if (destroyed || touching) return;
      handed = true;
      collapse();
      body.classList.add('ss-handed');
      clearTimeout(settleTimer);
      settleTimer = setTimeout(handBack, 180);
    });
  };
  listen(scroll, 'touchend', fling, { passive: true });
  listen(scroll, 'touchcancel', fling, { passive: true });
  listen(scroll, 'scrollend', handBack, { passive: true });
  // لمسة خارج القائمة تغلقها
  listen(body, 'click', () => closeDrops());

  const filter = { q: 'all', v: null, a: 'all' };
  // اختيار المستخدم نفسه (UX13): إن اختفى خياره مؤقتًا (سيرفره الوحيد مات أو لم يصل بعد) تُعرض الكل، ثم يعود
  // اختياره حين يظهر خيار بالقيمة نفسها. لا يُمسح بصمت.
  const wanted = { q: 'all', v: null, a: 'all' };
  // ما لمسه المستخدم: صفّه يقول «يبدأ…» حتى يفتح المشغّل
  let picked = null;
  // tapAt: ضغطة المستخدم الحقيقية (ساعة الحدث لا لحظة فتح المصدر): تقرير الذهب يقيس منها ما قبل المشغّل
  const pick = (r, e) => {
    if (destroyed) return;
    picked = r.id;
    const d = view(r);
    lastPick = d.torrent ? { features: startFeatures(d), at: Date.now() } : null;
    return o.onPick(r, { tapAt: tapTime(e) });
  };
  const rows = new Map();
  const views = new Map();
  const placed = new Map();
  let placedSeq = 0;
  let lastFilterKey = '';
  const view = (r) => {
    // الوصف يتغيّر بتغيّر الحالة لا بغيرها: يُحسب مرة لكل نسخة من السيرفر
    const key = `${r.sourceId}|${r.sourceName ?? ''}|${r.label ?? ''}|${r.quality}|${r.variant}|${r.server}|${r.state}|${r.probed}|${r.runtimeReady}|${r.seeders}`;
    const hit = views.get(r.id);
    if (hit?.key === key) return hit.d;
    const d = describe(r, { sourceName: o.sourceName, prefer: o.prefer, directLang: o.directLang });
    views.set(r.id, { key, d });
    return d;
  };
  // حقائق المحرك للمُسخَّن (حجم القطعة والسرب المقاس) تدخل درجة «المقترح» ومكان الصف الجديد فقط؛
  // الصف الظاهر لا يتحرك بها
  let measured = {};
  const scoreOf = (r) => {
    const m = measured[r.id];
    return rank(r, m ? { ...view(r), measured: m } : view(r));
  };

  const section = (cls, title, sub, noun) => {
    const s = el('section', `an-srv-group ${cls}`);
    const h = el('h4', 'an-srv-q');
    const ico = el('i', 'ss-group-ico');
    ico.setAttribute('aria-hidden', 'true');
    ico.hidden = true;
    const t = el('b', null, title);
    const count = el('span', 'ss-count');
    h.append(ico, t, count);
    if (sub) h.append(el('span', 'ss-sub', sub));
    const grid = el('div', 'an-srv-grid');
    // «عرض N»: زر بارتفاع ثابت (كان details يتغير محتواه وهو مفتوح مع كل سيرفر يصل فتكبر الورقة وتصغر)
    const more = btn('ss-more-btn');
    more.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    const moreGrid = el('div', 'ss-more-grid');
    moreGrid.hidden = true;
    s.append(h, grid, more, moreGrid);
    const g = { s, ico, count, grid, more, moreGrid, noun, open: false, shown: [] };
    more.onclick = (e) => { e.stopPropagation(); g.open = !g.open; update(last, { immediate: true }); };
    return g;
  };
  // نفس أسماء أقسام مشغّل الجوال (تصميم واحد للمنصتين، قرار المالك 15 نوفمبر)
  const direct = section('ss-group--direct', 'مباشر', 'يبدأ أسرع', 'الروابط الإضافية');
  const torrent = section('ss-group--torrent ss-group--engine', 'تورنت', 'جودة أعلى · يبدأ أبطأ', 'النسخ الإضافية');
  torrent.engine = 'torrent';
  // كل محرك له قسم خاص (ROUTE_ENGINES.own) غير التورنت: قسم بعنوانه وعلامته، بترتيب الجدول بعد «مباشر» (CloudStream أولها)
  const engineSections = new Map(ROUTE_ENGINES.filter((e) => e.own && e.id !== 'torrent').map((e) => {
    const g = section(`ss-group--direct ss-group--engine ss-group--${e.id}`, e.title, null, 'الروابط الإضافية');
    g.engine = e.id;
    return [e.id, g];
  }));
  const allSections = () => [torrent, direct, ...engineSections.values()];
  let queued = null, gesture = false, interactionUntil = 0, interactionTimer = null, adjustedTop = null, anchorEvent = null;
  const settle = () => {
    clearTimeout(interactionTimer);
    if (gesture || !queued || destroyed) return;
    const remaining = interactionUntil - Date.now();
    if (remaining > 0) { interactionTimer = setTimeout(settle, remaining); return; }
    const model = queued;
    queued = null;
    update(model);
  };
  const moving = () => { interactionUntil = Date.now() + 180; settle(); };
  for (const surface of [scroll, src]) {
    listen(surface, 'touchstart', () => { gesture = true; }, { passive: true });
    const endGesture = () => { gesture = false; moving(); };
    listen(surface, 'touchend', endGesture, { passive: true });
    listen(surface, 'touchcancel', endGesture, { passive: true });
    listen(surface, 'wheel', moving, { passive: true });
    listen(surface, 'scroll', (event) => {
      if (surface !== scrollSurface()) return;
      if (adjustedTop != null && Math.abs(surface.scrollTop - adjustedTop) < 1) { adjustedTop = null; anchorEvent = event; return; }
      adjustedTop = null;
      moving();
    }, { passive: true });
  }
  const fold = (cls) => {
    const d = el('details', `cn-srv-dead ${cls}`);
    const summary = el('summary');
    const grid = el('div', 'an-srv-grid');
    d.append(summary, grid);
    return { d, summary, grid };
  };
  const wait = fold('cn-srv-wait');
  const dead = fold('ss-dead');
  const skeleton = el('div', 'ss-skel-list');
  for (let i = 0; i < 5; i++) {
    const sk = el('div', 'ss-skel');
    sk.innerHTML = '<i class="ss-shim ss-shim--q"></i><span><i class="ss-shim ss-shim--a"></i><i class="ss-shim ss-shim--b"></i></span>';
    skeleton.append(sk);
  }
  // لا جاهز ولا انتظار: جملة هادئة مكان القائمة، لا بطاقة
  const note = el('div', 'ss-note');
  note.setAttribute('aria-live', 'polite');

  // لحظة تحرّك فيها صف موجود: لمسة بعدها مباشرة كانت تشغّل سيرفرًا غير الذي قصده الإصبع
  let shiftedAt = 0;
  // احجز قاع المحتوى خلال تغيير البنية كي لا يقص المتصفح موضع التمرير قبل تثبيت الصف المرئي.
  let heldKey = '';
  function render(model, { preserve = true } = {}) {
    const surface = scrollSurface(), y = surface.scrollTop || 0;
    const anchors = preserve && y > 0 ? visibleRows(surface) : [];
    const reserve = preserve && y > 0 && lastFilterKeyNow() === heldKey;
    if (reserve) hold.style.height = `${surface.scrollHeight}px`;
    else hold.style.height = '';
    paint(model);
    const sameFilter = heldKey === lastFilterKeyNow();
    heldKey = lastFilterKeyNow();
    const anchor = sameFilter && anchors.find(({ b }) => list.contains(b) && !b.closest('[hidden],details:not([open])'));
    const shift = anchor ? anchor.b.getBoundingClientRect().top - surface.getBoundingClientRect().top - anchor.top : 0;
    const target = Math.max(0, (surface.scrollTop || 0) + shift);
    if (reserve) {
      const natural = surface.scrollHeight - hold.offsetHeight;
      hold.style.height = sameFilter ? `${Math.max(0, Math.ceil(target + surface.clientHeight - natural))}px` : '';
    }
    if (anchor && Math.abs(shift) >= 1) {
      adjustedTop = Math.min(surface.scrollHeight - surface.clientHeight, target);
      surface.scrollTop = adjustedTop;
    }
  }
  const lastFilterKeyNow = () => `${filter.q}|${filter.v}|${filter.a}`;
  const reconcile = (parent, nodes) => {
    const before = new Map([...parent.children].map((node, i) => [node, i]));
    const keep = new Set(nodes);
    for (const node of before.keys()) if (!keep.has(node)) node.remove();
    nodes.forEach((node, i) => {
      if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] ?? null);
    });
    if (nodes.some((node, i) => before.has(node) && before.get(node) !== i)) shiftedAt = Date.now();
  };

  // ثلاث حالات لا تختلط (lib/route-validity.js): صالح / قيد الفحص / غير متاح
  const isPending = (r) => o.pending?.(r) ?? isChecking(r);
  const isDead = (r) => o.dead?.(r) ?? isUnavailable(r);
  const isSelectable = (r) => o.selectable?.(r) ?? isValid(r);
  // «قيد الفحص» وله رابط جاهز: لا يقترحه «شغّل الأفضل»، لكن لمسه اختيار صريح يجرّبه فعلًا
  const isTryable = (r) => isPending(r) && r.state === 'READY' && (r.candidates?.length ?? 1) > 0;

  function chipNode(c) {
    const i = el('span', `ss-chip ss-chip--${c.cls}`);
    // «2.1 GB» يبقى بترتيبه داخل سطر عربي، والفاصل بين العناصر في جهته الصحيحة
    if (/[A-Za-z0-9]/.test(c.t) && !/[؀-ۿ]/.test(c.t)) {
      const b = el('bdi', null, c.t);
      b.dir = 'ltr';
      i.append(b);
    } else i.textContent = c.t;
    if (c.cls === 'ar') i.classList.add('an-srv-lang--ar');
    return i;
  }

  let topId = null;
  // onTop: «المقترح» تورنت ثبت 400ms (لا مع كل تحديث للصفوف): المحرك يسخّنه قبل غيره. مرة لكل مقترح.
  // المؤقت يُعدّ من ظهور المقترح لا من آخر تحديث: الورقة تُحدَّث مع كل حدث من المحرك (أسرع من 400ms ما دامت
  // المصادر تتوالى)، وكان كل update يلغيه ويعيده، فلا يبدأ التسخين حتى تهدأ الورقة. كذلك الصفوف الخلفية.
  let topTimer = 0, warmedTop = null, topPending = null;
  // الصفوف الظاهرة غير «المقترح»: تسخين خلفي بترتيب warmRows، بعد أن تثبت 400ms، وحين تتغير فقط
  let rowsTimer = null, rowsKey = '', rowsPending = null;
  // الفأرة على صف تورنت 120ms: يُسخَّن هو (الضغط غالبًا بعد نصف ثانية)، والخروج من الصفوف يعيد «المقترح».
  // الفأرة وحدها (pointerType mouse): اللمس لا يمر فوق الصفوف، وتطبيق الجوال يبقى كما هو
  let hoverTimer = null, hovered = null;
  const routeById = (id) => (last?.routes ?? []).find((x) => x.id === id) ?? null;
  const hoverRow = (id) => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (destroyed || !o.onHover) return;
      const cur = routeById(id);
      if (!cur || !view(cur).torrent || !isSelectable(cur) || hovered === id) return;
      hovered = id; o.onHover(cur);
    }, 120);
  };
  const leaveRows = () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (destroyed || !o.onHover || hovered == null) return;
      hovered = null;
      const top = topId != null ? routeById(topId) : null;
      if (top && view(top).torrent) o.onHover(top);
    }, 800);
  };
  const announceRows = (ids) => {
    if (!o.onWarmRows) return;
    const key = ids.join('|');
    if (key === rowsPending) return;
    clearTimeout(rowsTimer);
    rowsPending = key === rowsKey ? null : key;
    if (rowsPending == null) return;
    rowsTimer = setTimeout(() => { rowsPending = null; if (destroyed) return; rowsKey = key; o.onWarmRows(ids); }, 400);
  };
  const announceTop = (top) => {
    const id = o.onTop && top && view(top).torrent && top.id !== warmedTop ? top.id : null;
    if (id === topPending) return;
    clearTimeout(topTimer);
    topPending = id;
    if (id == null) return;
    topTimer = setTimeout(() => {
      topPending = null;
      if (destroyed || topId !== id) return;
      warmedTop = id;
      o.onTop(routeById(id) ?? top);
    }, 400);
  };
  function row(r) {
    const d = view(r);
    const pending = isPending(r);
    const selectable = isSelectable(r);
    const gone = !pending && !selectable;
    let b = rows.get(r.id);
    if (!b) {
      b = el('button');
      b.type = 'button';
      b.dataset.routeId = r.id;
      b.innerHTML = '<span class="ss-q"><b dir="ltr"></b><small class="ss-kind" aria-hidden="true"></small></span><span class="ss-main"><span class="ss-line"><i class="ss-ico" aria-hidden="true"></i><b class="ss-name" dir="auto"></b><span class="ss-host" dir="auto"></span><span class="ss-tag">مقترح</span></span><span class="ss-meta"></span></span><span class="ss-end"></span>';
      rows.set(r.id, b);
      const id = r.id;
      b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hoverRow(id); });
      b.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') leaveRows(); });
    }
    const id = r.id;
    const top = r.id === topId;
    const starting = Boolean(last.busy && picked === r.id);
    const icon = d.torrent ? null : safeIconUrl(o.sourceIcon?.(r));
    // CLAUDE.md: الإضاءة بإشارة المحرك أن بيانات أول إطار على القرص (ready)، لا بمؤقت ولا بالمشاركين ولا بالبيانات
    const warm = Boolean(d.torrent && measured[r.id]?.ready === true);
    // يسخن الآن: في المحرك (له حقائق) ولم تصل إشارة الجاهزية بعد. البنفسجي له وحده (المالك، 27 نوفمبر)
    const warming = Boolean(d.torrent && measured[r.id]?.ready === false);
    // الصف لا يُعاد بناؤه إن لم يتغير ما يُرسم منه (كان كل update يعيد DOM كل صف، ومنها مئات المطوية في «نسخ إضافية»:
    // خُمس كلفة التحديث). البصمة: وصف السيرفر (مفتاح view نفسه) وحالته وما يغيّر سطره وطرفه. اللمس يُربط دائمًا بالحالة الحالية
    const sig = `${views.get(r.id)?.key}|${pending}|${selectable}|${top}|${starting}|${icon ?? ''}|${isTryable(r)}|${r.reason ?? ''}|${r.probeMs ?? ''}|${warm}|${warming}`;
    b.onclick = (e) => {
      if (Date.now() - shiftedAt < TAP_GUARD_MS) return;
      const target = routeById(id);
      if (!target) return;
      return isSelectable(target) || isTryable(target) ? pick(target, e) : o.onUnavailable?.(target);
    };
    if (b.dataset.sig === sig) return b;
    b.dataset.sig = sig;
    const stateCls = pending ? 'resolving' : selectable ? 'ready' : String(r.state ?? 'unavailable').toLowerCase();
    const open = b.classList.contains('ss-row--open');
    b.className = `an-srv ss-row${open ? ' ss-row--open' : ''} ss-row--${d.torrent ? 'torrent' : 'direct'} an-srv--${stateCls}${d.tier ? ` an-srv--swarm-${d.tier}` : ''}${d.prefer ? ' an-srv--prefer' : ''}${d.q === 2160 ? ' ss-row--uhd' : ''}${top ? ' ss-row--top' : ''}${warm ? ' ss-row--warm' : ''}${warming ? ' ss-row--warming' : ''}`;
    b.disabled = pending && !isTryable(r);
    const qb = b.querySelector('.ss-q');
    // جودة غير معروفة (HLS متكيّف أو مصدر لم يعلنها) لا تُكتب «HD»: هذا ادعاء لم يتحقق، والوصف المقروء «تلقائي»
    qb.firstElementChild.textContent = qualityLabel(d.q);
    qb.classList.toggle('ss-q--auto', d.q == null);
    // HDR/DV وبقية المواصفات في التفاصيل تحت السهم؛ تحت الجودة رمز نوعه فقط: ⚡ مباشر، مغناطيس تورنت
    const wasWarm = b.dataset.warm === '1';
    b.dataset.warm = warm ? '1' : '';
    const kind = qb.lastElementChild;
    if (!kind.firstElementChild || kind.dataset.kind !== String(d.torrent)) {
      kind.dataset.kind = String(d.torrent);
      kind.innerHTML = d.torrent
        ? `${glyph('magnet', { size: 12 })}<span class="ss-bolt-slot"></span>`
        : glyph('bolt', { size: 12 });
    }
    const boltSlot = kind.querySelector('.ss-bolt-slot');
    if (boltSlot && Boolean(boltSlot.firstElementChild) !== (warm || warming)) boltSlot.innerHTML = warm || warming ? BOLT : '';
    if (warm && !wasWarm && !still?.matches) boltSlot?.firstElementChild?.animate?.(
      [{ transform: 'scale(.9)', opacity: .55 }, { transform: 'scale(1.2)', opacity: 1, offset: .32 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 240, easing: 'ease-out' },
    );
    b.querySelector('.ss-name').textContent = d.name;
    // صورة المصدر (إضافته: CloudStream أو Aniyomi) بجانب اسمه، في خانة محجوزة من البداية فلا يتحرك الاسم حين تصل
    const ico = b.querySelector('.ss-ico');
    if (ico.dataset.src !== (icon ?? '')) {
      ico.dataset.src = icon ?? '';
      ico.style.backgroundImage = icon ? `url("${icon.replace(/["\\\n]/g, '')}")` : '';
    }
    ico.hidden = d.torrent;
    const host = b.querySelector('.ss-host');
    // اسم إصدار التورنت الطويل (بأعلامه) ليس مما يُختار به: مكانه التفاصيل
    host.textContent = d.torrent ? '' : d.host ?? '';
    host.hidden = d.torrent || !d.host;
    b.querySelector('.ss-tag').hidden = !top;
    const chips = metaChips(r, d, pending);
    const size = d.torrent && chips.find((chip) => chip.cls === 'spec');
    const meta = b.querySelector('.ss-meta');
    if (size) {
      const labels = el('span', 'ss-meta-labels');
      labels.append(...chips.filter((chip) => chip !== size).map(chipNode));
      meta.replaceChildren(labels, chipNode(size));
    } else meta.replaceChildren(...chips.map(chipNode));
    const end = b.querySelector('.ss-end');
    b.classList.toggle('ss-row--busy', starting);
    if (starting) end.innerHTML = '<i class="ss-spin"></i><small>يبدأ…</small>';
    else if (pending) end.innerHTML = `<i class="ss-spin"></i><small>${VALIDITY_AR.CHECKING}</small>`;
    else if (gone) {
      // السبب في السطر نفسه («Cloudflare»، «لا رابط فيديو»…) لا بعد لمسة
      const why = validity(r).reason;
      const small = el('small', 'ss-bad', why || VALIDITY_AR.UNAVAILABLE);
      small.title = why || VALIDITY_AR.UNAVAILABLE;
      end.replaceChildren(small);
    }
    else if (d.torrent) {
      end.innerHTML = !Number.isFinite(d.info?.seeders)
        ? '<small>غير معلن</small>'
        : `<span class="ss-seeds ss-seeds--${d.tier}" dir="ltr" title="${SEEDS_HINT}">${glyph('users', { size: 14 })}<b class="an-srv-seeds">${compact(d.info.seeders)}</b></span>`;
    } else end.innerHTML = `<small class="ss-ok">${VALIDITY_AR.VALID}</small><span class="ss-play">${glyph('play', { size: 13, filled: true })}</span>`;
    // سهم صغير يفتح التفاصيل تحت الصف؛ لمسه لا يشغّل
    const lines = d.torrent && !pending && !gone ? detailLines(r, d) : [];
    let chev = b.querySelector('.ss-chev');
    let box = b.querySelector('.ss-details');
    if (lines.length) {
      if (!chev) {
        chev = el('span', 'ss-chev');
        chev.setAttribute('role', 'button');
        chev.setAttribute('aria-label', 'التفاصيل');
        chev.innerHTML = glyph('chevron', { size: 16 });
        box = el('span', 'ss-details');
        b.append(chev, box);
      }
      chev.setAttribute('aria-expanded', String(b.classList.contains('ss-row--open')));
      chev.onclick = (e) => {
        e.stopPropagation();
        const open = !b.classList.contains('ss-row--open');
        b.classList.toggle('ss-row--open', open);
        chev.setAttribute('aria-expanded', String(open));
      };
      box.onclick = (e) => e.stopPropagation();
      box.replaceChildren(...lines.map(([k, v]) => {
        const line = el('span', 'ss-detail');
        const val = el('bdi', null, v);
        val.dir = 'auto';
        line.append(el('b', null, k), val);
        return line;
      }));
    } else {
      chev?.remove();
      box?.remove();
      b.classList.remove('ss-row--open');
    }
    const why = [top ? 'مقترح' : null, warm ? 'جاهز للتشغيل الفوري' : warming ? 'جارٍ التسخين' : null, d.name, d.host, qualityLabel(d.q), ...d.langs.map((l) => l.t), d.torrent && Number.isFinite(d.info?.seeders) ? `${d.info.seeders} زارع` : null, pending ? VALIDITY_AR.CHECKING : gone ? VALIDITY_AR.UNAVAILABLE : VALIDITY_AR.VALID].filter(Boolean).join('، ');
    b.setAttribute('aria-label', why);
    b.title = d.info?.filename ?? r.label ?? '';
    return b;
  }

  function paintNote(model) {
    // لا مصدر مشاهدة في الحساب أصلًا: ليس «غير متوفر»، بل خطوة واحدة واضحة تفتح صفحة الإضافات
    if (model.noSources) {
      note.innerHTML = `${glyph('info', { size: 18 })}<div><b></b><p></p></div>`;
      note.querySelector('b').textContent = o.noSourcesTitle ?? 'أضف مصدرًا لتشاهد';
      note.querySelector('p').textContent = 'الأعمال تظهر من الكتالوج، والمشاهدة من مصادر تضيفها أنت.';
      if (o.onAddSource) {
        const add = btn('ss-add-source');
        add.textContent = 'أضف مصدرًا';
        add.onclick = () => o.onAddSource();
        note.querySelector('div').append(add);
      }
      return;
    }
    // عمل فُتح من داخل مصدر: السيرفرات من هذا المصدر وحده، وحين لا يجهز منه شيء نقول ذلك ونعرض البدائل
    if (o.pinnedSource) {
      note.innerHTML = `${glyph('info', { size: 18 })}<div><b></b><p></p></div>`;
      note.querySelector('b').textContent = model.error ? `تعذّر الوصول إلى ${o.pinnedSource.name}` : `لا سيرفر جاهز من ${o.pinnedSource.name} لهذه الحلقة`;
      note.querySelector('p').textContent = o.pinnedSource.onAlternatives ? 'جرّب البدائل: نبحث عن العمل نفسه في كل مصادرك.' : 'أعد المحاولة بعد لحظات، أو افتح العمل من البحث العام لتجربة مصادر أخرى.';
      if (o.pinnedSource.onAlternatives) {
        const alt = btn('ss-add-source');
        alt.textContent = 'جرّب البدائل';
        alt.onclick = () => o.pinnedSource.onAlternatives();
        note.querySelector('div').append(alt);
      }
      return;
    }
    const msg = model.missing ? 'لم نجد هذه الحلقة في المصادر الآن' : model.error ? 'تعذّر الوصول إلى المصادر' : 'لم يجهز أي سيرفر الآن';
    const hint = model.missing ? 'جرّب لاحقًا، أو فعّل مصادر أخرى من الإعدادات.' : 'أعد المحاولة بعد لحظات — كثيرًا ما تعود السيرفرات سريعًا.';
    note.innerHTML = `${glyph('info', { size: 18 })}<div><b></b><p></p></div>`;
    note.querySelector('b').textContent = msg;
    note.querySelector('p').textContent = hint;
  }

  // مرشّحات نصّية في سطر واحد: الجودة، ثم مترجم/مدبلج، ثم قائمة المصدر
  let last = { routes: [] };
  // شريط المرشّحات يُبنى مرة واحدة ويبقى بمكانه وارتفاعه من أول لحظة (لا قفزة حين يظهر): الجودة والمصدر
  // قائمتان متجاورتان تفتحان تحت الزر نفسه، واللغة زرّان (مترجم/مدبلج). وصول سيرفر جديد يحدّث خيارات القائمة
  // في مكانها؛ القائمة المفتوحة لا تُغلق ولا تُعاد (كانت تُحذف وتُبنى مع كل سيرفر فتومض).
  const drops = [];
  const closeDrops = (except = null) => { for (const d of drops) if (d !== except) d.setOpen(false); };
  const dropdown = (label) => {
    const wrap = el('div', 'ss-addon ss-drop');
    const toggle = btn('ss-addon-btn', '', label);
    // اسم المرشّح صغيرًا فوق قيمته داخل المربع (مثل الجوال)؛ يظهر حيث تُصمَّم المرشّحات مربعات
    toggle.append(el('small', 'ss-drop-cap', label));
    const caption = el('span');
    caption.dir = 'auto';
    toggle.append(caption);
    toggle.insertAdjacentHTML('beforeend', glyph('chevron', { size: 14, cls: 'icon ss-addon-chev' }));
    toggle.setAttribute('aria-haspopup', 'listbox');
    toggle.setAttribute('aria-expanded', 'false');
    const menu = el('div', 'ss-addon-menu');
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', label);
    menu.hidden = true;
    menu.onclick = (e) => e.stopPropagation();
    wrap.append(toggle);
    let signature = '';
    const d = { wrap, open: false };
    d.setOpen = (open) => {
      if (open === d.open) return;
      if (open) {
        closeDrops(d);
        // القائمة في قسم المصادر الذي يُمرَّر، لا في إطار الورقة الثابت: تبقى تحت زرها إذا مرّرت
        // (كانت تثبت على الشاشة وزرها يتحرك تحتها فتبدو «تنزل معك»). خارج صف المرشّحات لأنه يقصّ ما ينزل منه.
        const a = toggle.getBoundingClientRect?.();
        const b = src.getBoundingClientRect?.();
        if (a && b) {
          menu.style.top = `${a.bottom - b.top + (src.scrollTop || 0) + 4}px`;
          menu.style.left = `${Math.max(8, Math.min(a.left - b.left, b.width - 198))}px`;
        }
        if (menu.parentNode !== src) src.append(menu);
      }
      d.open = open;
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      wrap.classList.toggle('open', open);
    };
    toggle.onclick = (e) => { e.stopPropagation(); d.setOpen(!d.open); };
    d.set = (options, value, text, onPick) => {
      caption.textContent = text;
      toggle.disabled = options.length < 3; // «الكل» وخيار واحد: لا اختيار
      const next = JSON.stringify([options, value]);
      if (next === signature) return;
      signature = next;
      menu.replaceChildren(...options.map(([key, label]) => {
        const opt = btn('ss-addon-opt', '');
        opt.setAttribute('role', 'option');
        opt.dataset.value = String(key);
        opt.setAttribute('aria-selected', String(key === value));
        const t = el('span', null, label);
        t.dir = 'auto';
        opt.append(el('i', 'ss-addon-dot'), t);
        opt.onclick = (e) => { e.stopPropagation(); d.setOpen(false); onPick(key); };
        return opt;
      }));
    };
    drops.push(d);
    return d;
  };
  const quality = dropdown('الجودة');
  const source = dropdown('المصدر');
  const drop = el('div', 'ss-drops');
  drop.append(quality.wrap, source.wrap);
  const lang = el('div', 'ss-tabs');
  lang.setAttribute('role', 'group');
  lang.setAttribute('aria-label', 'اللغة');
  const langTabs = [['SUB', 'مترجم'], ['DUB', 'مدبلج']].map(([key, text]) => {
    const b = btn('ss-tab');
    b.textContent = text;
    b.onclick = () => { filter.v = wanted.v = filter.v === key ? null : key; update(last, { immediate: true }); };
    lang.append(b);
    return [key, b];
  });
  filters.append(drop, lang);
  function paintFilters(routes) {
    const live = routes.filter((r) => !isDead(r));
    const qs = [...new Set(live.map((r) => view(r).q).filter((x) => x != null))].sort((a, b) => b - a);
    filter.q = wanted.q !== 'all' && qs.includes(wanted.q) ? wanted.q : 'all';
    const dub = live.some((r) => r.variant === 'DUB');
    const sub = live.some((r) => r.variant !== 'DUB');
    filter.v = dub && sub ? wanted.v : null;
    const names = [...new Set(live.map((r) => view(r).name))];
    filter.a = wanted.a !== 'all' && names.includes(wanted.a) ? wanted.a : 'all';
    quality.set([['all', 'كل الجودات'], ...qs.map((x) => [x, qualityLabel(x)])], filter.q,
      filter.q === 'all' ? (qs.length === 1 ? qualityLabel(qs[0]) : 'كل الجودات') : qualityLabel(filter.q),
      (k) => { filter.q = wanted.q = k; update(last, { immediate: true }); });
    source.set([['all', 'كل المصادر'], ...names.map((n) => [n, n])], filter.a,
      filter.a === 'all' ? (names.length === 1 ? names[0] : 'كل المصادر') : filter.a,
      (k) => { filter.a = wanted.a = k; update(last, { immediate: true }); });
    lang.hidden = !(dub && sub);
    for (const [key, b] of langTabs) {
      b.classList.toggle('on', filter.v === key);
      b.setAttribute('aria-pressed', String(filter.v === key));
    }
  }
  const passes = (r) => (filter.q === 'all' || view(r).q === filter.q)
    && (filter.v == null || (filter.v === 'DUB') === (r.variant === 'DUB'))
    && (filter.a === 'all' || view(r).name === filter.a);

  /**
   * model: { routes, busy, settled, missing, error, noSources, status: {text, spin}, retry: null | {wait} }
   * `noSources`: لا مصدر مشاهدة في الحساب: «أضف مصدرًا لتشاهد» مكان القائمة والزر يفتح الإضافات.
   */
  // التورنت الواحد صف واحد: Torrentio نفسه يصل من إضافة Stremio ومن إضافتي Aniyomi (Torrentio وTorrentio Anime)،
  // فكان الإصدار نفسه يظهر ثلاث مرات ويتضاعف «غير متاح». الهوية: اسم الملف والحجم. الصف الظاهر يبقى (لا قفزة)
  // ما لم يمت وتصل نسخة صالحة منه.
  // UX14: البصمة (infoHash) هي هوية التورنت الدقيقة: نفس البصمة صف واحد ولو اختلف اسم الملف، وبصمتان معروفتان
  // مختلفتان صفّان ولو تطابق الاسم والحجم. إن غابت البصمة عند أحدهما يبقى الاسم والحجم (Aniyomi قد لا يعطيها).
  // مشتق من الوصف وحده (اسم الملف والحجم)، فيُحفظ معه: يتغير بتغيّره فقط
  const torrentKey = (r) => {
    const d = view(r);
    const hit = views.get(r.id);
    if (hit && hit.d === d && 'tk' in hit) return hit.tk;
    const file = d.torrent ? d.info?.filename : null;
    const tk = file ? `${String(file).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')}|${d.info?.size ?? ''}` : null;
    if (hit && hit.d === d) hit.tk = tk;
    return tk;
  };
  const hashOf = (r) => {
    if (!view(r).torrent) return null;
    const direct = typeof r.infoHash === 'string' && /^[a-f\d]{40}$/i.test(r.infoHash) ? r.infoHash : null;
    const magnet = direct ? null : String(r.magnet ?? r.url ?? '').match(/btih:([a-f\d]{40})/i)?.[1];
    const hash = (direct ?? magnet)?.toLowerCase();
    return hash ? `${hash}|${r.fileIdx ?? ''}` : null;
  };
  const seedersOf = (r) => Number(view(r).info?.seeders) || 0;
  // كلفة التحديث (قياس 27 نوفمبر، معالج بسرعة الجوال): 161ms لكل update بـ171 سيرفرًا، نصفها هنا: كل سيرفر يقارَن بكل
  // عضو في كل مجموعة سابقة (sameTorrent تعيد التعبيرات النمطية في كل مقارنة). المجموعة تحفظ بصماتها ومفاتيحها، فالشرط
  // نفسه بالضبط (sameTorrent وقيد البصمتين) يصير بحثًا في مجموعة، والبصمة والمفتاح يُحسبان مرة لكل سيرفر
  const oneTorrent = (routes) => {
    const groups = [];
    for (const r of routes) {
      if (!view(r).torrent) continue;
      const h = hashOf(r), k = torrentKey(r);
      if (!h && !k) continue;
      // sameTorrent(m, r): بصمتان معروفتان تتطابقان، وإلا المفتاح (اسم الملف والحجم). ولا تجمع المجموعة بصمتين معروفتين
      // مختلفتين، ولو ربط بينهما مسار بلا بصمة
      const g = groups.find((x) => (h ? x.hashes.has(h) || (k != null && x.bareKeys.has(k)) : k != null && x.keys.has(k))
        && (!h || x.hashes.size === 0 || (x.hashes.size === 1 && x.hashes.has(h))));
      const join = (x) => { if (h) x.hashes.add(h); else if (k != null) x.bareKeys.add(k); if (k != null) x.keys.add(k); };
      if (!g) { const x = { best: r, members: [r], hashes: new Set(), bareKeys: new Set(), keys: new Set() }; join(x); groups.push(x); continue; }
      g.members.push(r);
      join(g);
      const cur = g.best;
      const take = placed.has(cur.id) ? isDead(cur) && isSelectable(r)
        : !placed.has(r.id) ? (isSelectable(r) && !isSelectable(cur)) || (isSelectable(r) === isSelectable(cur) && seedersOf(r) > seedersOf(cur))
        : true;
      if (take) g.best = r;
    }
    const hidden = new Set(groups.flatMap((g) => g.members.filter((m) => m !== g.best)));
    return routes.filter((r) => !hidden.has(r));
  };
  // ── مسجّل القفزات (التشخيص ظاهر فقط؛ لا كلفة بدونه) ──
  // المالك (27 نوفمبر): «يوم انزل تطلعني لفوق» على الجهاز، ولا تتكرر في Playwright بلمس حقيقي ووكيل WebView وحقائق كل ثانية.
  // يُسجَّل كل تحرك لما على الشاشة بلا إصبع: بعد تحديث (صف ظاهر تغيّر موضعه، وأي قسم تغيّر ارتفاعه) أو في التمرير (نزل موضعه
  // والإصبع يسحب للأسفل أو انزلاقه). السطر في أسفل الورقة يُنسخ كما هو للمحادثة
  const jumps = [];
  let fingerY = null, fingerDir = '', fingerAt = 0, lastY = 0;
  const probing = () => o.jumpProbe ?? diagnosticsUi.visible();
  const nameOf = (n) => n.querySelector?.('summary, .ss-group-title, h3')?.textContent?.trim().slice(0, 32) || String(n.className || n.tagName).split(' ')[0];
  // كل الصفوف الظاهرة بمواضعها: بعد التحديث يُقارن أول صف بقي منها (الصف الأول قد يكون هو ما أُزيل)
  const visibleRows = (surface) => {
    const viewport = surface.getBoundingClientRect?.();
    if (!viewport) return [];
    const visible = [];
    for (const b of list.querySelectorAll('.ss-row')) {
      const bounds = b.getBoundingClientRect();
      if (bounds.height && bounds.bottom > viewport.top && bounds.top < viewport.bottom) {
        visible.push({ b, top: bounds.top - viewport.top, key: b.dataset.routeId });
        if (visible.length === 6) break;
      }
    }
    return visible;
  };
  const noteJump = (j) => {
    jumps.push({ ...j, at: Math.round(globalThis.performance?.now?.() ?? Date.now()) });
    if (jumps.length > 12) jumps.shift();
    const lastJ = jumps.at(-1);
    jumpLine.hidden = false;
    jumpLine.textContent = `قفزات الورقة: ${jumps.length} · آخرها ${lastJ.dy}px (${lastJ.kind === 'update' ? 'بعد تحديث' : 'في التمرير'}) · اضغط للنسخ`;
    paintDiagnostics();
  };
  jumpLine.onclick = (e) => {
    e.stopPropagation();
    const text = 'قفزات ورقة السيرفرات (VANTARA)\n' + jumps.map((j) => JSON.stringify(j)).join('\n');
    globalThis.navigator?.clipboard?.writeText?.(text).then(() => { jumpLine.textContent = 'نُسخت القفزات'; }, () => {});
  };
  listen(scroll, 'touchstart', (e) => { fingerY = e?.touches?.[0]?.clientY ?? null; }, { passive: true });
  listen(scroll, 'touchmove', (e) => {
    const y = e?.touches?.[0]?.clientY;
    if (y == null) return;
    // الإصبع يصعد = المحتوى ينزل (تمرير للأسفل)
    if (fingerY != null && Math.abs(y - fingerY) > 1) { fingerDir = y < fingerY ? 'down' : 'up'; fingerAt = Date.now(); }
    fingerY = y;
  }, { passive: true });
  listen(scroll, 'scroll', (event) => {
    const y = scroll.scrollTop || 0;
    if (event !== anchorEvent && probing() && y < lastY - 24 && fingerDir === 'down' && Date.now() - fingerAt < 1200) {
      noteJump({ kind: 'scroll', dy: Math.round(y - lastY), scrollTop: [Math.round(lastY), Math.round(y)], max: Math.round((scroll.scrollHeight || 0) - (scroll.clientHeight || 0)), handed });
    }
    lastY = y;
  }, { passive: true });

  let hasPainted = false;
  function update(model, { immediate = false } = {}) {
    if (destroyed) return;
    last = model;
    if (hasPainted && !immediate && (gesture || Date.now() < interactionUntil)) {
      // Results still arrive. Retain the DOM order and refresh attached, fixed-height rows
      // until the latest snapshot can be laid out after the gesture.
      queued = model;
      measured = model.facts ?? {};
      const present = new Map((model.routes ?? []).map((r) => [r.id, r]));
      for (const node of list.querySelectorAll('.ss-row')) {
        const route = present.get(node.dataset.routeId);
        if (!route) node.onclick = null;
        else if (!node.classList.contains('ss-row--open') && !node.closest('details:not([open]),[hidden]')) row(route);
      }
      settle();
      return;
    }
    hasPainted = true;
    queued = null;
    const surface = scrollSurface();
    if (!probing()) return render(model, { preserve: !immediate });
    const seen = visibleRows(surface);
    const heights = new Map([...list.children].map((n) => [n, n.offsetHeight]));
    const y0 = surface.scrollTop || 0, max0 = (surface.scrollHeight || 0) - (surface.clientHeight || 0);
    render(model, { preserve: !immediate });
    const a = seen.find((x) => x.b.isConnected);
    if (!a) return;
    const viewport = surface.getBoundingClientRect();
    const dy = Math.round(a.b.getBoundingClientRect().top - viewport.top - a.top);
    if (Math.abs(dy) < 8) return;
    const nodes = [...new Set([...heights.keys(), ...list.children])];
    const changed = nodes.map((n) => [nameOf(n), heights.get(n) ?? 0, n.isConnected ? n.offsetHeight : 0]).filter(([, x, z]) => x !== z);
    noteJump({ kind: 'update', dy, row: a.key, gone: seen.indexOf(a), scrollTop: [Math.round(y0), Math.round(surface.scrollTop || 0)], max: [Math.round(max0), Math.round((surface.scrollHeight || 0) - (surface.clientHeight || 0))], changed, routes: model.routes?.length ?? 0 });
  }

  function paint(model) {
    last = model;
    measured = model.facts ?? {};
    const routes = oneTorrent(model.routes ?? []);
    paintFilters(routes);
    const shown = routes.filter(passes);
    const ready = shown.filter(isSelectable);
    const anyReady = routes.some(isSelectable);
    const scored = ready.map((r) => ({ r, s: scoreOf(r) })).filter((x) => Number.isFinite(x.s)).sort((a, b) => b.s - a.s);
    let top = scored[0]?.r ?? null;
    // المالك: المقترح أسرع ما يبدأ وأثبته؛ إن كان تورنت فهو الأكبر سربًا من التورنتات الصالحة (المقاس إن وصل المحرك إليه)،
    // لا تورنت ضعيف تقدّمته أوزان أخرى. المباشر العربي السريع يبقى مقترحًا حيث يتقدّم (الأنمي)
    if (top && view(top).torrent) {
      const swarm = (r) => measuredSeeds({ ...view(r), measured: measured[r.id] }) ?? seedersOf(r);
      // من الظاهرة (خطة التورنت: الجودة أولًا) لا من كل التورنت: 720p بسرب أكبر ليس المقترح فوق 4K و1080p، ولا يُقترح مطويّ
      const strong = torrentPlan(ready.filter((r) => view(r).torrent && view(r).tier !== 'dead' && view(r).info?.source !== 'CAM'), { quality: (r) => view(r).q, seeds: seedersOf });
      // المتقاربة سربًا (ضمن 15% من الأكبر) تفاضلها الدرجة (حجم القطعة المقاس، العربية): القطعة الأصغر تبدأ أسرع
      // والثبات: فوق 20 GB (حد «حجم معقول» في lib/route-validity.js) يحتاج سرعة عالية طوال المشاهدة، فلا يُقترح ما دام
      // بين الظاهرة ما هو أخف (ريمكس 61 GB بـ412 زارعًا يبدأ سريعًا ثم يتقطع)
      const light = strong.filter((r) => !(view(r).info?.size > 20 * 1024 ** 3));
      const pool = light.length ? light : strong;
      const most = Math.max(0, ...pool.map(swarm));
      const near = pool.filter((r) => swarm(r) >= most * 0.85);
      top = near.sort((a, b) => scoreOf(b) - scoreOf(a) || swarm(b) - swarm(a))[0] ?? top;
    }
    topId = top?.id ?? null;
    announceTop(top);

    // سطر الحالة: «55 جاهزة من 77 · البقية تصل»
    const st = model.status ?? {};
    if (st.spin && !statusSpinner.parentNode) status.prepend(statusSpinner);
    else if (!st.spin && statusSpinner.parentNode) statusSpinner.remove();
    if (statusText.textContent !== (st.text ?? '')) statusText.textContent = st.text ?? '';
    status.classList.toggle('ss-status--warn', Boolean(model.error || model.missing));
    // الملاحظة تقول الحال حين لا جاهز ولا انتظار: لا سطر يكرّرها
    const empty = !top && Boolean(model.settled || model.missing || model.error || model.noSources);
    status.hidden = empty;

    // رتّب أحدث دفعة بعد استقرار التمرير. اختيار المرشّح إجراء صريح يُرسم فورًا.
    const filterKey = `${filter.q}|${filter.v}|${filter.a}`;
    const refilter = filterKey !== lastFilterKey;
    if (refilter) { lastFilterKey = filterKey; for (const g of allSections()) g.shown = []; }
    const gone = shown.filter((r) => !isPending(r) && !isSelectable(r));
    for (const r of shown) if (!placed.has(r.id)) placed.set(r.id, ++placedSeq);
    const shownBefore = new Set(allSections().flatMap((g) => g.shown));
    // ما يُعرض في قسمه: الصالح، وما ظهر قبلًا ثم تعذّر (يبقى في مكانه بحالته)
    const live = shown.filter((r) => isSelectable(r) || shownBefore.has(r.id));
    const waiting = shown.filter((r) => isPending(r) && !shownBefore.has(r.id));
    const byId = new Map(live.map((r) => [r.id, r]));
    const quality = (r) => view(r).q;
    const weakTorrent = (r) => { const d = view(r); return d.tier === 'dead' || d.info?.source === 'CAM'; };
    const directOrder = (a, b) => {
      const qa = quality(a) ?? 600, qb = quality(b) ?? 600;
      const ar = (r) => Number(Boolean(view(r).langs?.some((l) => l.ar)));
      return qb - qa || ar(b) - ar(a) || scoreOf(b) - scoreOf(a) || placed.get(a.id) - placed.get(b.id);
    };
    const paintSection = (g, items, plan, order) => {
      const ids = plan.slice(0, VISIBLE).map((r) => r.id);
      // An expired transport is demoted immediately when a valid replacement exists.
      // A temporarily failed direct option can retain an otherwise empty place.
      if (g !== torrent) for (const id of g.shown) {
        if (ids.length >= VISIBLE) break;
        if (byId.has(id) && !ids.includes(id)) ids.push(id);
      }
      g.shown = ids;
      const visible = ids.map((id) => byId.get(id));
      const visibleIds = new Set(ids);
      const rest = items.filter((r) => !visibleIds.has(r.id)).sort(order);
      reconcile(g.grid, visible.map(row));
      g.more.hidden = !rest.length;
      if (!rest.length) g.open = false;
      g.more.textContent = g.open ? `إخفاء ${g.noun}` : `عرض ${rest.length} من ${g.noun}`;
      g.more.setAttribute('aria-expanded', String(g.open));
      g.moreGrid.hidden = !g.open;
      // المطويّة لا تُبنى صفوفها حتى تُفتح (كانت مئات الصفوف تُحدَّث مع كل سيرفر يصل)
      reconcile(g.moreGrid, g.open ? rest.map(row) : []);
      g.count.textContent = String(items.length);
      g.s.hidden = !items.length;
      // شعار القسم يمثل المحرك لا أول مصدر فيه (كان قسم CloudStream يأخذ شعار AnimeRift). «مباشر» بلا محرك واحد
      // معروف لكل صفوفه يبقى بلا علامة: لا تصنيف بلا دليل
      const engines = new Set(items.map(routeEngine));
      const mark = g.engine ?? (engines.size === 1 && !engines.has(null) ? [...engines][0] : null);
      const svg = mark ? engineMark(mark, { size: '100%', stroke: 2.1 }) : '';
      if (g.ico.dataset.mark !== (mark ?? '')) { g.ico.dataset.mark = mark ?? ''; g.ico.innerHTML = svg; }
      g.ico.hidden = !svg;
    };
    const torrentLive = live.filter((r) => view(r).torrent);
    // القسم من هوية المحرك: التورنت بنقله، والمحركات ذات القسم الخاص بمعرّفها، والباقي «مباشر»
    const engineOf = (r) => { const e = routeEngine(r); return engineSections.has(e) ? e : null; };
    const directLive = live.filter((r) => !view(r).torrent && !engineOf(r));
    const torrentOrder = (a, b) => (quality(b) ?? 0) - (quality(a) ?? 0) || seedersOf(b) - seedersOf(a) || placed.get(a.id) - placed.get(b.id);
    paintSection(torrent, torrentLive, torrentPlan(torrentLive.filter((r) => isSelectable(r) && !weakTorrent(r)), { quality, seeds: seedersOf }), torrentOrder);
    paintSection(direct, directLive, directLive.filter(isSelectable).sort(directOrder), directOrder);
    for (const [id, g] of engineSections) {
      const items = live.filter((r) => !view(r).torrent && engineOf(r) === id);
      paintSection(g, items, items.filter(isSelectable).sort(directOrder), directOrder);
    }
    announceRows(warmRows(torrentLive
      .filter((r) => r.id !== topId && torrent.shown.includes(r.id) && isSelectable(r))
      .map((r) => ({ r, d: view(r), m: measured[r.id] }))));
    const groups = allSections().filter((g) => !g.s.hidden);
    // ما تعذّر قبل أن يظهر أصلًا: مطويّ في الأسفل
    const neverShown = gone.filter((r) => !live.includes(r));
    reconcile(wait.grid, waiting.map(row));
    wait.summary.textContent = `قيد الفحص (${waiting.length})`;
    reconcile(dead.grid, neverShown.map(row));
    dead.summary.textContent = `غير متاح الآن (${neverShown.length})`;
    const loading = !routes.length && !model.settled && !model.missing && !model.error && !model.noSources;
    if (empty) paintNote(model);
    const order = [
      empty ? note : null,
      loading ? skeleton : null,
      ...groups.map((g) => g.s),
      waiting.length ? wait.d : null,
      neverShown.length ? dead.d : null,
    ].filter(Boolean);
    reconcile(list, order);
    if (!order.length && routes.length) list.replaceChildren(el('p', 'ss-none', 'لا سيرفر بهذا الاختيار — جرّب جودة أو لغة أو مصدرًا آخر'));

    // زرّ واحد هادئ: يشغّل المقترح نفسه، أو ينتظر أول جاهز
    best.classList.remove('waiting');
    if (model.noSources && !top) {
      best.disabled = !o.onAddSource;
      best.innerHTML = `${glyph('plus', { size: 18 })}<span class="ss-best-copy"><span>أضف مصدرًا</span></span>`;
      best.onclick = () => o.onAddSource?.();
      return;
    }
    if (model.retry) {
      const w = model.retry.wait;
      best.disabled = w > 0;
      best.innerHTML = `${glyph('refresh', { size: 18 })}<span class="ss-best-copy"><span>${w ? `أعد المحاولة بعد ${w} ث` : 'أعد المحاولة'}</span></span>`;
      best.onclick = () => o.onRetry?.();
      return;
    }
    // «شغّل الأفضل» من الصالح وحده: بلا رابط صالح بعد لا يشغّل «أول ما يجهز» بل ينتظر الفحص
    best.disabled = Boolean(model.busy || model.missing || !top);
    best.classList.toggle('waiting', !top && !model.settled && !model.missing);
    const td = top ? view(top) : null;
    const label = model.busy ? 'نجهّز التشغيل…' : top ? 'شغّل الأفضل' : model.settled ? 'لا رابط صالح الآن' : 'ننتظر رابطًا صالحًا…';
    best.innerHTML = `${glyph('play', { size: 18, filled: true })}<span class="ss-best-copy"><span>${label}</span>${td && !model.busy ? '<small></small>' : ''}</span>`;
    const small = best.querySelector('small');
    if (small) {
      // كل جزء معزول: «1080p · Torrentio» يُقرأ بترتيبه من اليمين لا مقلوبًا
      small.dir = 'rtl';
      bestReason(top, td).forEach((part, i) => {
        if (i) small.append(' · ');
        small.append(el('bdi', null, part));
      });
    }
    best.onclick = (e) => {
      const target = top && routeById(top.id);
      if (!best.disabled && target && isSelectable(target)) pick(target, e);
    };
  }

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(settleTimer);
    clearTimeout(interactionTimer);
    clearTimeout(topTimer);
    clearTimeout(rowsTimer);
    clearTimeout(hoverTimer);
    for (const id of frames) globalThis.cancelAnimationFrame?.(id);
    frames.clear();
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions.length = 0;
    body.classList.remove('ss-handed');
    for (const element of [...body.querySelectorAll('button, img'), ...rows.values()]) {
      element.onclick = null; element.onload = null; element.onerror = null;
    }
    rows.clear(); views.clear();
  };
  return { update, best, status, body, scroll, destroy };
}
