/**
 * علامات محركات الإضافات ووسائل النقل (SVG داخلي بلون النص): مصدر واحد لإدارة الإضافات (addons-hub) ولعناوين أقسام
 * ورقة السيرفرات. شعار القسم يمثل المحرك أو المجموعة، وشعار السيرفر يمثل مصدره.
 */
export const ENGINE_MARKS = {
  stremio: '<rect x="4" y="5" width="24" height="22" rx="5" stroke="currentColor" stroke-width="2.5"/><path d="m13 11 8 5-8 5z" fill="currentColor" stroke="none"/>',
  mihon: '<path fill="currentColor" stroke="none" d="M3 6c5-1 9 0 12 3v18c-3-3-7-4-12-3zm26 0c-5-1-9 0-12 3v18c3-3 7-4 12-3z"/><path d="M7 11h4M7 15h4M21 11h4M21 15h4" stroke="var(--surface-2)" stroke-width="1.6"/>',
  cloudstream: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M9 26a7 7 0 0 1-1-14 9 9 0 0 1 17 2 6 6 0 0 1-1 12zm5-12v9l7-4.5z"/>',
  aniyomi: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M7 8 4 3l2-1 6 7h8l6-7 2 1-3 5a6 6 0 0 1 5 6v9a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6v-9a6 6 0 0 1 5-6zm4 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-10 7 5 4 5-4z"/>',
  // اختيار المالك (28 نوفمبر) بصورته: حلقة خضراء مفرغة وفيها µ أخضر عريض، كأيقونة Torrentio (µTorrent). رسم بسيط
  torrent: '<circle cx="16" cy="16" r="12.5" stroke="#1f9d45" stroke-width="2.4" fill="none"/><path d="M12.6 10.5v12.5M12.6 17.2a3.3 3.3 0 0 0 6.6 0v-6.7M19.2 17.6c0 1.8.8 2.6 2 2.6" stroke="#1f9d45" stroke-width="3.2" fill="none" stroke-linecap="round"/>',
};

/** SVG العلامة، أو '' لمحرك بلا علامة. */
export function engineMark(id, { size = '58%', stroke = 2.1 } = {}) {
  const body = ENGINE_MARKS[id];
  return body ? `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:${size};height:${size};stroke-width:${stroke}">${body}</svg>` : '';
}
