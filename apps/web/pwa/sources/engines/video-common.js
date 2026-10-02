/**
 * مشترك بين محركات الأنمي والسينما: بطاقات المواقع العربية (حلقات الموسم في
 * عمل واحد)، أرقام الحلقات، الجودة والنسخة (مترجم/مدبلج).
 * نفس قواعد `SiteCards.kt` و`StreamClassifier` في الـAPK.
 */

import { firstNumber, pathOf } from '../dom.js';

const EPISODE = /\s*(?:الحلقة|حلقة)\s*(\d+(?:\.\d+)?).*$/;
const SERIES = /(^|\s)(مسلسل|برنامج|انمي|أنمي|الموسم|الحلقة)(\s|$)/;

export const kindOf = (title) => (SERIES.test(String(title ?? '')) ? 'series' : 'movie');
export const episodeNumber = (title) => {
  const m = String(title ?? '').match(EPISODE);
  return m ? Number(m[1]) : null;
};

/** بطاقات بحث ← أعمال: حلقات الموسم الواحد تُجمع، والفيلم كما هو. */
export function foldCards(cards, sourceId) {
  const seen = new Map();
  for (const c of cards) {
    const raw = String(c.title ?? '').trim();
    const path = pathOf(c.href);
    if (!raw || !path) continue;
    const series = kindOf(raw) === 'series';
    const title = series ? raw.replace(EPISODE, '').trim() || raw : raw;
    const key = series ? title : path;
    if (!seen.has(key)) seen.set(key, { sourceId, url: path, title, thumbnail: c.thumb || null });
  }
  return [...seen.values()];
}

export const episodeName = (n) => `الحلقة ${Number.isInteger(n) ? n : n}`;

export function variantOf(text) {
  const t = String(text ?? '');
  if (/(مدبلج|دبلجة|dub(bed)?\b|arabic\s*dub)/i.test(t)) return 'DUB';
  if (/(مترجم|ترجمة|\bsub(bed|s)?\b|softsub|hardsub)/i.test(t)) return 'SUB';
  return 'SUB';
}

export function qualityOf(text) {
  const t = String(text ?? '').toUpperCase();
  if (t === '4K') return 2160;
  if (t === 'FHD') return 1080;
  if (t === 'HD') return 720;
  if (t === 'SD') return 480;
  const m = t.match(/(2160|1440|1080|720|576|480|360|240)\s*P?/);
  return m ? Number(m[1]) : null;
}

/** رقم من نص بالأرقام العربية أو اللاتينية، أو null. */
export const numberIn = (s) => {
  const n = firstNumber(s);
  return n >= 0 ? n : null;
};
