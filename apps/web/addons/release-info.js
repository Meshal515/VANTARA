/**
 * ما تقوله نسخة الإضافة عن نفسها، مقروءًا للمستخدم.
 *
 * إضافات Stremio (Torrentio وأشباهه) تكتب في وصف كل نسخة سطرًا حاسمًا:
 *   «Fight.Club.1999.2160p.UHD.BluRay.x265.HDR.DTS-HD …
 *    👤 412 💾 21.4 GB ⚙️ ThePirateBay
 *    Multi Audio / 🇸🇦 / 🇫🇷»
 * والمشغّل كان يعرض النص خامًا: 73 بطاقة «Torrentio» متشابهة لا يُعرف أيها
 * يعمل. هنا نستخرج منه: المشاركين، الحجم، المصدر (BluRay/WEB/CAM)، الترميز،
 * HDR/Dolby Vision، الصوت، واللغات — والعربية أولها.
 *
 * عدد المشاركين **إعلان من الإضافة** وقت فهرستها، لا قياس حي: يُعرض كما هو
 * ويرتّب النسخ، ولا يُسمّى «متحقق». الفحص الحي للمشاركين شأن محرك التورنت.
 *
 * (صيغة Torrentio من مصدره المفتوح Apache-2.0: addon/lib/streamInfo.js و
 * languages.js؛ لم يُنسخ منه كود.)
 */

const FLAGS = {
  '🇸🇦': 'ar', '🇬🇧': 'en', '🇯🇵': 'ja', '🇷🇺': 'ru', '🇮🇹': 'it', '🇵🇹': 'pt', '🇪🇸': 'es', '🇲🇽': 'es-MX',
  '🇰🇷': 'ko', '🇨🇳': 'zh', '🇹🇼': 'zh-TW', '🇫🇷': 'fr', '🇩🇪': 'de', '🇳🇱': 'nl', '🇮🇳': 'hi', '🇵🇱': 'pl',
  '🇹🇷': 'tr', '🇮🇷': 'fa', '🇮🇱': 'he', '🇺🇦': 'uk', '🇬🇷': 'el', '🇸🇪': 'sv', '🇩🇰': 'da', '🇳🇴': 'no',
  '🇫🇮': 'fi', '🇨🇿': 'cs', '🇭🇺': 'hu', '🇷🇴': 'ro', '🇧🇬': 'bg', '🇻🇳': 'vi', '🇮🇩': 'id', '🇲🇾': 'ms', '🇹🇭': 'th',
};

const UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };

/** «21.4 GB» ← بايتات، أو null. */
export function sizeBytes(text) {
  const m = /💾\s*([\d.,]+)\s*(B|kB|KB|MB|GB|TB)\b/.exec(text) ?? /\b([\d.]+)\s*(GB|MB|TB)\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  const unit = UNITS[m[2].toUpperCase()];
  return Number.isFinite(n) && unit ? Math.round(n * unit) : null;
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function pick(text, table) {
  for (const [label, re] of table) if (re.test(text)) return label;
  return null;
}

const SOURCES = [
  ['CAM', /\b(?:HD-?CAM|CAMRip|CAM|TS|TeleSync|HD-?TS|TC|TeleCine|SCR|Screener)\b/i],
  ['REMUX', /\bREMUX\b/i],
  ['BluRay', /\b(?:Blu-?Ray|BDRip|BRRip|BD(?:25|50)?|UHD\.?BluRay)\b/i],
  ['WEB-DL', /\bWEB-?DL\b/i],
  ['WEBRip', /\bWEB-?Rip\b/i],
  ['WEB', /\bWEB\b/i],
  ['HDTV', /\bHDTV\b/i],
  ['DVD', /\bDVD(?:Rip|5|9)?\b/i],
];
const CODECS = [
  ['AV1', /\bAV1\b/i],
  ['HEVC', /\b(?:x\.?265|h\.?265|HEVC)\b/i],
  ['H.264', /\b(?:x\.?264|h\.?264|AVC)\b/i],
];
const AUDIO = [
  ['Atmos', /\bAtmos\b/i],
  ['TrueHD', /\bTrueHD\b/i],
  ['DTS-HD', /\bDTS-?HD(?:\.?MA)?\b/i],
  ['DTS', /\bDTS\b/i],
  ['DD+', /\b(?:DDP|DD\+|E-?AC-?3)\s?(?:\d\.\d)?\b/i],
  ['AAC', /\bAAC\b/i],
];

/** HDR بأنواعه كما كتبته النسخة: Dolby Vision قبل HDR10+ قبل HDR. */
function hdrOf(text) {
  const out = [];
  if (/\b(?:DV|DoVi|Dolby[ .]?Vision)\b/i.test(text)) out.push('DV');
  if (/\bHDR10\+|\bHDR10Plus\b/i.test(text)) out.push('HDR10+');
  else if (/\bHDR(?:10)?\b/i.test(text)) out.push('HDR');
  return out;
}

function qualityOf(text) {
  const m = /\b(4320|2160|1440|1080|720|576|480|360)p\b/i.exec(text);
  if (m) return Number(m[1]);
  if (/\b(?:4k|UHD)\b/i.test(text)) return 2160;
  return null;
}

/**
 * {provider, quality, hdr[], source, codec, audio, seeders, size, sizeLabel, site,
 *  languages[], arabic, multiAudio, multiSubs, dubbed, filename} — كل حقل null إن لم يُذكر.
 */
export function parseRelease(name, title) {
  const n = String(name ?? '');
  const t = String(title ?? '');
  const all = `${n}\n${t}`;
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const seeds = /👤\s*(\d+)/.exec(all);
  const site = /⚙️\s*([^\n👤💾]+)/.exec(all)?.[1]?.trim() || null;
  const languages = [...new Set([...all].join('').match(/\p{Regional_Indicator}{2}/gu)?.map((f) => FLAGS[f]).filter(Boolean) ?? [])];
  // اسم الملف: أول سطر لا يحمل 👤/💾/⚙️ ولا أعلامًا
  const filename = lines.find((l) => !/[👤💾⚙️]/u.test(l) && !/\p{Regional_Indicator}/u.test(l) && !/^(?:Multi|Dual|Dubbed)\b/i.test(l)) ?? null;
  const size = sizeBytes(all);
  return {
    provider: n.split('\n')[0].trim() || null,
    quality: qualityOf(all),
    hdr: hdrOf(all),
    source: pick(all, SOURCES),
    codec: pick(all, CODECS),
    audio: pick(all, AUDIO),
    seeders: seeds ? Number(seeds[1]) : null,
    size,
    sizeLabel: formatSize(size),
    site,
    languages,
    arabic: languages.includes('ar') || /\b(?:Arabic|ARABIC|عربي|مدبلج عربي)\b/.test(all),
    multiAudio: /\b(?:Multi[ .-]?Audio|Dual[ .-]?Audio)\b/i.test(all),
    multiSubs: /\bMulti[ .-]?Subs?\b/i.test(all),
    dubbed: /\bDubbed\b/i.test(all),
    filename,
  };
}

/**
 * صحة السرب كما أعلنتها الإضافة: dead (0) · weak (1–4) · fair (5–19) · strong (20+)،
 * أو null إن لم تذكر العدد (ليس «ميتًا»).
 */
export function swarmTier(seeders) {
  if (!Number.isFinite(seeders)) return null;
  if (seeders <= 0) return 'dead';
  if (seeders < 5) return 'weak';
  if (seeders < 20) return 'fair';
  return 'strong';
}

const TIER_RANK = { strong: 4, fair: 3, weak: 1, dead: 0 };

/**
 * ترتيب النسخ داخل الجودة الواحدة (ترشيح، لا اختيار عن المستخدم):
 * CAM آخرًا، ثم قوة السرب، ثم العربية، ثم عدد المشاركين.
 * نسخة بلا عدد معلن تُعامل كمتوسطة لا كميتة.
 */
export function releaseScore(info) {
  if (!info) return 0;
  const tier = swarmTier(info.seeders);
  let score = (tier ? TIER_RANK[tier] : 2) * 1e6;
  if (info.source === 'CAM') score -= 5e6;
  if (info.arabic) score += 5e5;
  if (Number.isFinite(info.seeders)) score += Math.min(info.seeders, 99999);
  return score;
}

/** سطر المواصفات المختصر: «21 GB · HEVC · Atmos». */
export function specLine(info) {
  return [info.sizeLabel, info.codec, info.audio].filter(Boolean).join(' · ');
}

/** نص صحة السرب للمستخدم. */
export function swarmText(info) {
  const tier = swarmTier(info?.seeders);
  if (!tier) return null;
  if (tier === 'dead') return 'لا مشاركين';
  const label = { weak: 'ضعيف', fair: 'متوسط', strong: 'قوي' }[tier];
  return `${info.seeders.toLocaleString('en')} مشارك · ${label}`;
}
