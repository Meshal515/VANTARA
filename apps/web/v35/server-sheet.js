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
import { parseRelease, releaseScore, swarmTier } from '../addons/release-info.js';
import { glyph } from './icons.js';
import { FAIL_MS, knownStart, rememberStart, startFeatures } from '../lib/start-memory.js';

export const isAddonRoute = (r) => String(r?.sourceId ?? '').startsWith('addon|');

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
  const torrent = isAddonRoute(r) || r.runtimeReady != null;
  const info = isAddonRoute(r) && r.label ? parseRelease(r.sourceName ?? r.server ?? '', r.label) : null;
  const q = bucket(r.quality ?? info?.quality);
  const name = torrent ? (info?.provider || r.sourceName || ctx.sourceName?.(r) || 'إضافة') : ctx.sourceName?.(r) ?? r.sourceName ?? r.sourceId ?? 'سيرفر';
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

const TORRENT_Q = { 1080: 4e7, 720: 2.5e7, 1440: 2e7, 2160: 1e7, 480: 0 };
const CODEC = { 'H.264': 3e7, HEVC: 1e7, AV1: -4e7 };

/**
 * «الأفضل لك» بين ما يمكن تشغيله الآن. المباشر يسبق التورنت (يبدأ فورًا)، وسيرفرك السابق يتقدّم.
 * التورنت بجاهزيته الحقيقية: المشاركون أولًا (لوغاريتميًا: 1000 مقابل 100 فرق واضح، 1100 مقابل
 * 1000 لا)، ثم العربية والصوت المتعدد، ثم الجودة (1080 قبل 4K: تبدأ أسرع)، والترميز (H.264 أسهل
 * فكًّا من HEVC، وAV1 بطيء على هواتف كثيرة)، والحجم الضخم يتأخر. وما جرّبه هذا الجهاز فعلًا
 * يقرر الباقي: صفة بدأت هنا ببطء أو تعذّرت (start-memory.js) تتأخر بقدر بطئها.
 * ترشيح لا قفل: كل صف ما زال يُلمس.
 */
export function rank(r, d) {
  if (!d.torrent) {
    const ms = Number(r.probeMs);
    return 3e9 + (d.prefer ? 5e8 : 0) + (QUALITY_PREF[d.q] ?? 2) * 1e7 + (r.variant === 'DUB' ? 0 : 1e6) - (Number.isFinite(ms) ? Math.min(ms, 9e5) : 5e5);
  }
  if (d.tier === 'dead' || d.info?.source === 'CAM') return releaseScore(d.info);
  const seeds = d.info?.seeders;
  const swarm = Number.isFinite(seeds) ? Math.log10(1 + Math.max(0, seeds)) * 1e8 : 0.8e8;
  const size = d.info?.size ?? 0;
  const heavy = size > 20 * 1024 ** 3 ? 8e7 : size > 8 * 1024 ** 3 ? 3e7 : 0;
  const known = knownStart(startFeatures(d));
  const slow = known == null ? 0 : (Math.min(known, FAIL_MS) / 1000) * 6e6;
  return 1e9 + (d.prefer ? 5e8 : 0) + swarm + (d.info?.arabic ? 5e7 : 0) + (d.info?.multiAudio ? 1e7 : 0)
    + (TORRENT_Q[d.q] ?? 1e7) + (CODEC[d.info?.codec] ?? 0) - heavy - slow;
}

/** آخر صف تورنت لُمس: يُنسب إليه زمن بدء المشغّل الأصلي حين يصل (playstat). */
let lastPick = null;
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

/** ترتيب صفوف التورنت: الأصح سربًا ثم الأعلى جودة ثم العربية ثم المشاركون. */
function torrentOrder(a, b) {
  const t = (d) => ({ strong: 4, fair: 3, weak: 1, dead: 0 }[d.tier] ?? 2) - (d.info?.source === 'CAM' ? 9 : 0);
  return t(b.d) - t(a.d) || (b.d.q ?? 0) - (a.d.q ?? 0) || Number(Boolean(b.d.info?.arabic)) - Number(Boolean(a.d.info?.arabic)) || (b.d.info?.seeders ?? 0) - (a.d.info?.seeders ?? 0);
}

const METER = { dead: 0, weak: 1, fair: 2, strong: 3 };
const meterBars = (d) => {
  const s = d.info?.seeders;
  if (!Number.isFinite(s)) return -1;
  return s >= 100 ? 4 : METER[d.tier] ?? 0;
};
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
    ['المشاركون', Number.isFinite(i.seeders) ? `${i.seeders.toLocaleString('en')} · ${SWARM_AR[d.tier] ?? ''}` : null],
  ].filter(([, v]) => v);
}

const SWARM_AR = { strong: 'سرب قوي', fair: 'سرب متوسط', weak: 'سرب ضعيف', dead: 'بلا مشاركين' };

/** لماذا هذا هو المقترح، بكلمات قليلة: يُقال تحت زر «شغّل الأفضل». */
export function bestReason(r, d) {
  const out = [qualityLabel(d.q), d.name];
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
 * o: { el, title, kicker, media, onBack, onPick(r), onBest(), onRetry(), onUnavailable(r),
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
export function createServerSheet(body, o) {
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
  const art = el('div', 'ss-art');
  const shot = el('img', 'ss-art-img');
  shot.alt = '';
  shot.decoding = 'async';
  const sources = [media.backdrop, media.backdropFallback].filter(Boolean);
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
    art.append(shot);
  } else art.classList.add('ss-art--none');
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
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
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
  const tools = el('div', 'ss-tools');
  const toolsHead = el('div', 'ss-tools-head');
  toolsHead.append(el('b', null, 'المصادر'));
  const status = el('div', 'an-srv-status');
  toolsHead.append(status);
  const filters = el('div', 'an-pick-filters');
  tools.append(toolsHead, filters);
  const list = el('div', 'an-srv-list');
  src.append(tools, list);

  const scroll = el('div', 'an-pick-scroll');
  scroll.append(info, src);

  const foot = el('footer', 'an-pick-foot');
  const best = btn('an-pick-best');
  foot.append(best, ...(o.extraFoot ?? []));
  body.append(bar, scroll, foot);

  // ── الانكماش مع التمرير (الهاتف فقط): تحويل وشفافية لا غير، عبر متغيّرين ──
  const mq = (q) => (typeof matchMedia === 'function' ? matchMedia(q) : null);
  const wide = mq('(min-width: 900px)');
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
    const span = Math.max(1, (art.offsetHeight || 0) - (bar.offsetHeight || 0));
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
  scroll.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(collapse);
    else collapse();
  }, { passive: true });
  wide?.addEventListener?.('change', collapse);
  collapse();
  // الصورة والشعار يتحركان بخط CSS مربوط بتمرير الورقة نفسها (كانت الكتابة بعد حدث scroll
  // متأخرة إطارًا فتهتز). WebView 153–156 يحبس الانزلاق بعد رفع الإصبع ما دامت حركة مربوطة
  // بالتمرير، فأثناء الانزلاق تُوقف حركة CSS وتعمل المتغيرات التي يكتبها collapse بنفس القيم.
  let handed = false;
  let moved = false;
  let settleTimer = null;
  const handBack = () => {
    clearTimeout(settleTimer);
    if (!handed) return;
    handed = false;
    body.classList.remove('ss-handed');
  };
  scroll.addEventListener('touchstart', () => { moved = false; handBack(); }, { passive: true });
  scroll.addEventListener('scroll', () => {
    moved = true;
    if (handed) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(handBack, 180);
    }
  }, { passive: true });
  const fling = () => {
    if (!moved) return;
    handed = true;
    collapse();
    body.classList.add('ss-handed');
    clearTimeout(settleTimer);
    settleTimer = setTimeout(handBack, 180);
  };
  scroll.addEventListener('touchend', fling, { passive: true });
  scroll.addEventListener('touchcancel', fling, { passive: true });
  scroll.addEventListener('scrollend', handBack, { passive: true });
  // لمسة خارج قائمة المصدر تغلقها
  body.addEventListener?.('click', () => {
    const w = body.querySelector('.ss-addon.open');
    body.querySelectorAll('.ss-addon-menu').forEach((m) => m.remove());
    if (!w) return;
    w.classList.remove('open');
    w.querySelector('.ss-addon-btn')?.setAttribute('aria-expanded', 'false');
  });

  const filter = { q: 'all', v: null, a: 'all' };
  // ما لمسه المستخدم: صفّه يقول «يبدأ…» حتى يفتح المشغّل
  let picked = null;
  const pick = (r) => {
    picked = r.id;
    const d = view(r);
    lastPick = d.torrent ? { features: startFeatures(d), at: Date.now() } : null;
    return o.onPick(r);
  };
  const rows = new Map();
  const views = new Map();
  const view = (r) => {
    // الوصف يتغيّر بتغيّر الحالة لا بغيرها: يُحسب مرة لكل نسخة من السيرفر
    const key = `${r.label ?? ''}|${r.quality}|${r.variant}|${r.server}`;
    const hit = views.get(r.id);
    if (hit?.key === key) return hit.d;
    const d = describe(r, { sourceName: o.sourceName, prefer: o.prefer, directLang: o.directLang });
    views.set(r.id, { key, d });
    return d;
  };

  const section = (cls, title, sub) => {
    const s = el('section', `an-srv-group ${cls}`);
    const h = el('h4', 'an-srv-q');
    const t = el('b', null, title);
    const count = el('span', 'ss-count');
    h.append(t, count);
    if (sub) h.append(el('span', 'ss-sub', sub));
    const grid = el('div', 'an-srv-grid');
    const more = el('details', 'cn-srv-dead an-srv-more');
    const summary = el('summary');
    const moreGrid = el('div', 'an-srv-grid');
    more.append(summary, moreGrid);
    s.append(h, grid, more);
    return { s, count, grid, more, summary, moreGrid };
  };
  const direct = section('ss-group--direct', 'سيرفرات مباشرة', 'تبدأ خلال ثوانٍ');
  const torrent = section('ss-group--torrent', 'تورنت', 'يبدأ أبطأ · جودة وحجم أعلى');
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

  const reconcile = (parent, nodes) => {
    nodes.forEach((node, i) => {
      if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] ?? null);
    });
    while (parent.children.length > nodes.length) parent.lastElementChild.remove();
  };

  const isPending = (r) => o.pending?.(r) ?? r.state === 'RESOLVING';
  const isDead = (r) => o.dead?.(r) ?? (r.state === 'UNAVAILABLE' || r.state === 'FAILED');
  const isSelectable = (r) => o.selectable?.(r) ?? r.state === 'READY';

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
  function row(r) {
    const d = view(r);
    const pending = isPending(r);
    const selectable = isSelectable(r);
    const gone = !pending && !selectable;
    let b = rows.get(r.id);
    if (!b) {
      b = el('button');
      b.type = 'button';
      b.innerHTML = '<span class="ss-q"><b dir="ltr"></b><small dir="ltr"></small></span><span class="ss-main"><span class="ss-line"><b class="ss-name" dir="auto"></b><span class="ss-host" dir="auto"></span><span class="ss-tag">مقترح</span></span><span class="ss-meta"></span></span><span class="ss-end"></span>';
      rows.set(r.id, b);
    }
    const stateCls = pending ? 'resolving' : selectable ? 'ready' : String(r.state ?? 'unavailable').toLowerCase();
    const top = r.id === topId;
    const open = b.classList.contains('ss-row--open');
    b.className = `an-srv ss-row${open ? ' ss-row--open' : ''} ss-row--${d.torrent ? 'torrent' : 'direct'} an-srv--${stateCls}${d.tier ? ` an-srv--swarm-${d.tier}` : ''}${d.prefer ? ' an-srv--prefer' : ''}${d.q === 2160 ? ' ss-row--uhd' : ''}${top ? ' ss-row--top' : ''}`;
    b.disabled = pending;
    const qb = b.querySelector('.ss-q');
    qb.firstElementChild.textContent = d.q == null ? 'HD' : qualityLabel(d.q);
    // HDR/DV وبقية المواصفات في التفاصيل تحت السهم، لا تحت الجودة
    qb.lastElementChild.textContent = '';
    b.querySelector('.ss-name').textContent = d.name;
    const host = b.querySelector('.ss-host');
    // اسم إصدار التورنت الطويل (بأعلامه) ليس مما يُختار به: مكانه التفاصيل
    host.textContent = d.torrent ? '' : d.host ?? '';
    host.hidden = d.torrent || !d.host;
    b.querySelector('.ss-tag').hidden = !top;
    b.querySelector('.ss-meta').replaceChildren(...metaChips(r, d, pending).map(chipNode));
    const end = b.querySelector('.ss-end');
    const starting = Boolean(last.busy && picked === r.id);
    b.classList.toggle('ss-row--busy', starting);
    if (starting) end.innerHTML = '<i class="ss-spin"></i><small>يبدأ…</small>';
    else if (pending) end.innerHTML = '<i class="ss-spin"></i><small>نفحص…</small>';
    else if (gone) end.innerHTML = `<small class="ss-bad">${r.state === 'FAILED' ? 'تعذّر' : 'غير متاح'}</small>`;
    else if (d.torrent) {
      const bars = meterBars(d);
      const meter = Array.from({ length: 4 }, (_, i) => `<i${i < bars ? ' class="on"' : ''}></i>`).join('');
      end.innerHTML = bars < 0
        ? '<small>غير معلن</small>'
        : `<span class="ss-meter ss-meter--${d.tier}" aria-hidden="true">${meter}</span><b class="an-srv-seeds" dir="ltr">${compact(d.info.seeders)}</b>`;
    } else end.innerHTML = `<span class="ss-play">${glyph('play', { size: 13, filled: true })}</span>`;
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
    const why = [top ? 'مقترح' : null, d.name, d.host, qualityLabel(d.q), ...d.langs.map((l) => l.t), d.torrent && Number.isFinite(d.info?.seeders) ? `${d.info.seeders} مشارك` : null, pending ? 'نفحص التشغيل' : gone ? 'غير متاح' : null].filter(Boolean).join('، ');
    b.setAttribute('aria-label', why);
    b.title = d.info?.filename ?? r.label ?? '';
    b.onclick = () => (selectable ? pick(r) : o.onUnavailable?.(r));
    return b;
  }

  function paintNote(model) {
    const msg = model.missing ? 'لم نجد هذه الحلقة في المصادر الآن' : model.error ? 'تعذّر الوصول إلى المصادر' : 'لم يجهز أي سيرفر الآن';
    const hint = model.missing ? 'جرّب لاحقًا، أو فعّل مصادر أخرى من الإعدادات.' : 'أعد المحاولة بعد لحظات — كثيرًا ما تعود السيرفرات سريعًا.';
    note.innerHTML = `${glyph('info', { size: 18 })}<div><b></b><p></p></div>`;
    note.querySelector('b').textContent = msg;
    note.querySelector('p').textContent = hint;
  }

  // مرشّحات نصّية في سطر واحد: الجودة، ثم مترجم/مدبلج، ثم قائمة المصدر
  const tabs = (items, active, onPick, label) => {
    const g = el('div', 'ss-tabs');
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', label);
    for (const [key, text] of items) {
      const b = btn(`ss-tab${key === active ? ' on' : ''}`);
      b.textContent = text;
      b.setAttribute('aria-pressed', String(key === active));
      b.onclick = () => onPick(key);
      g.append(b);
    }
    return g;
  };

  let last = { routes: [] };
  function paintFilters(routes) {
    const live = routes.filter((r) => !isDead(r));
    const qs = [...new Set(live.map((r) => view(r).q).filter((x) => x != null))].sort((a, b) => b - a);
    if (filter.q !== 'all' && !qs.includes(filter.q)) filter.q = 'all';
    const dub = live.some((r) => r.variant === 'DUB');
    const sub = live.some((r) => r.variant !== 'DUB');
    if (!(dub && sub)) filter.v = null;
    const names = [...new Set(live.map((r) => view(r).name))];
    if (filter.a !== 'all' && !names.includes(filter.a)) filter.a = 'all';
    const parts = [];
    if (qs.length > 1) parts.push(tabs([['all', 'الكل'], ...qs.map((x) => [x, qualityLabel(x)])], filter.q, (k) => { filter.q = k; update(last); }, 'الجودة'));
    // اللغة زرّان يُلغى المختار منهما بلمسة ثانية
    if (dub && sub) parts.push(tabs([['SUB', 'مترجم'], ['DUB', 'مدبلج']], filter.v, (k) => { filter.v = filter.v === k ? null : k; update(last); }, 'اللغة'));
    if (names.length > 1) {
      // قائمة المصدر بتصميم الورقة نفسها (كان <select> يفتح نافذة النظام البيضاء/السوداء)
      const wrap = el('div', 'ss-addon');
      const toggle = btn('ss-addon-btn', `<span>${filter.a === 'all' ? 'كل المصادر' : filter.a}</span>${glyph('chevron', { size: 14, cls: 'icon ss-addon-chev' })}`, 'المصدر');
      toggle.setAttribute('aria-haspopup', 'listbox');
      const menu = el('div', 'ss-addon-menu');
      menu.setAttribute('role', 'listbox');
      menu.hidden = true;
      for (const [value, text] of [['all', 'كل المصادر'], ...names.map((n) => [n, n])]) {
        const opt = btn('ss-addon-opt', '');
        opt.setAttribute('role', 'option');
        opt.dataset.value = value;
        opt.setAttribute('aria-selected', String(value === filter.a));
        const label = el('span', null, text);
        label.dir = 'auto';
        opt.append(el('i', 'ss-addon-dot'), label);
        opt.onclick = (e) => {
          e.stopPropagation();
          filter.a = value;
          update(last);
        };
        menu.append(opt);
      }
      // القائمة خارج صف المرشّحات (يُمرَّر أفقيًا فيقصّ ما ينزل منه)، تحت الزر مباشرة
      toggle.onclick = (e) => {
        e.stopPropagation();
        const open = menu.hidden;
        body.querySelectorAll('.ss-addon-menu').forEach((m) => { if (m !== menu) m.remove(); });
        if (open) {
          const a = toggle.getBoundingClientRect?.();
          const b = body.getBoundingClientRect?.();
          if (a && b) {
            menu.style.top = `${a.bottom - b.top + 4}px`;
            menu.style.left = `${Math.max(8, a.left - b.left)}px`;
          }
          body.append(menu);
        }
        menu.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        wrap.classList.toggle('open', open);
      };
      wrap.append(toggle);
      parts.push(wrap);
    }
    body.querySelectorAll('.ss-addon-menu').forEach((m) => m.remove());
    filters.replaceChildren(...parts);
    filters.hidden = !parts.length;
    // سطر أعرض من الشاشة: يذوب طرفه إشارةً إلى أنه يُمرَّر، بدل قصّ كلمة في منتصفها
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => filters.classList.toggle('ss-filters--more', filters.scrollWidth > filters.clientWidth + 1));
  }
  const passes = (r) => (filter.q === 'all' || view(r).q === filter.q)
    && (filter.v == null || (filter.v === 'DUB') === (r.variant === 'DUB'))
    && (filter.a === 'all' || view(r).name === filter.a);

  /**
   * model: { routes, busy, settled, missing, error, status: {text, spin}, retry: null | {wait} }
   */
  function update(model) {
    last = model;
    const routes = model.routes ?? [];
    paintFilters(routes);
    const shown = routes.filter(passes);
    const ready = shown.filter(isSelectable);
    const anyReady = routes.some(isSelectable);
    const scored = ready.map((r) => ({ r, s: rank(r, view(r)) })).sort((a, b) => b.s - a.s);
    const top = scored[0]?.r ?? null;
    topId = top?.id ?? null;

    // سطر الحالة: «55 جاهزة من 77 · البقية تصل»
    const st = model.status ?? {};
    status.replaceChildren();
    if (st.spin) status.append(el('i', 'ss-spin'));
    status.append(el('span', null, st.text ?? ''));
    status.classList.toggle('ss-status--warn', Boolean(model.error || model.missing));
    // الملاحظة تقول الحال حين لا جاهز ولا انتظار: لا سطر يكرّرها
    const empty = !top && Boolean(model.settled || model.missing || model.error);
    status.hidden = empty;

    // المباشر ثم التورنت؛ ما يُجهَّز بعد (حين يوجد جاهز) وما تعذّر مطويّان
    const pend = shown.filter(isPending);
    const gone = shown.filter((r) => !isPending(r) && !isSelectable(r));
    const live = shown.filter((r) => isSelectable(r) || (isPending(r) && !anyReady));
    const directLive = live.filter((r) => !view(r).torrent)
      .map((r) => ({ r, s: isSelectable(r) ? rank(r, view(r)) : 0 }))
      .sort((a, b) => b.s - a.s).map((x) => x.r);
    // التورنت بترتيب الترشيح نفسه: الأول هو المقترح، وما تحته أقرب إليه
    const torrentLive = live.filter((r) => view(r).torrent).map((r) => ({ r, d: view(r), s: isSelectable(r) ? rank(r, view(r)) : 0 })).sort((a, b) => b.s - a.s || torrentOrder(a, b)).map((x) => x.r);

    const fill = (g, items, cap, weak) => {
      const main = [];
      const extra = [];
      for (const r of items) ((r.id !== topId && (weak?.(r) || main.length >= cap)) ? extra : main).push(row(r));
      reconcile(g.grid, main);
      reconcile(g.moreGrid, extra);
      g.more.hidden = !extra.length;
      g.summary.textContent = `نسخ إضافية (${extra.length})`;
      g.count.textContent = String(items.length);
      g.s.hidden = !items.length;
    };
    fill(direct, directLive, 8);
    fill(torrent, torrentLive, 6, (r) => {
      const d = view(r);
      return d.tier === 'dead' || d.info?.source === 'CAM';
    });
    // ترتيب الأقسام ثابت: مباشر، تورنت، يُجهَّز، غير متاح
    const waiting = anyReady ? pend : [];
    reconcile(wait.grid, waiting.map(row));
    wait.summary.textContent = `تُجهَّز بالخلفية (${waiting.length})`;
    reconcile(dead.grid, gone.map(row));
    dead.summary.textContent = `غير متاح الآن (${gone.length})`;
    const loading = !routes.length && !model.settled && !model.missing && !model.error;
    if (empty) paintNote(model);
    const order = [
      empty ? note : null,
      loading ? skeleton : null,
      directLive.length ? direct.s : null,
      torrentLive.length ? torrent.s : null,
      waiting.length ? wait.d : null,
      gone.length ? dead.d : null,
    ].filter(Boolean);
    reconcile(list, order);
    if (!order.length && routes.length) list.replaceChildren(el('p', 'ss-none', 'لا سيرفر بهذا الاختيار — جرّب جودة أو لغة أو مصدرًا آخر'));

    // زرّ واحد هادئ: يشغّل المقترح نفسه، أو ينتظر أول جاهز
    best.classList.remove('waiting');
    if (model.retry) {
      const w = model.retry.wait;
      best.disabled = w > 0;
      best.innerHTML = `${glyph('refresh', { size: 18 })}<span class="ss-best-copy"><span>${w ? `أعد المحاولة بعد ${w} ث` : 'أعد المحاولة'}</span></span>`;
      best.onclick = () => o.onRetry?.();
      return;
    }
    const filtered = filter.q !== 'all' || filter.v != null || filter.a !== 'all';
    best.disabled = Boolean(model.busy || model.missing || (!top && (model.settled || filtered)));
    best.classList.toggle('waiting', !top && !model.settled && !model.missing);
    const td = top ? view(top) : null;
    const label = model.busy ? 'نجهّز التشغيل…' : top ? 'شغّل الأفضل' : model.settled ? 'لا سيرفر جاهز' : 'شغّل أول سيرفر يجهز';
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
    best.onclick = () => {
      if (best.disabled) return;
      if (top) pick(top);
      else o.onBest?.();
    };
  }

  return { update, best, status, body, scroll };
}
