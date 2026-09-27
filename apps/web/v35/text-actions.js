/** النصوص العادية تُنسخ من قائمة VANTARA؛ حقول التحرير تحتفظ بتحديد Android. */
export function copyableText(target) {
  if (!(target instanceof Element)) return null;
  // رسائل المجلس لها قائمة عائمة خاصة بها؛ لا تُفتح قائمة النسخ العامة فوقها.
  if (target.closest('input, textarea, [contenteditable], button, a, [role="button"], .work-card, .mc-bubble')) return null;
  const node = target.closest('[data-copyable], .mc-text, .pf-bio, blockquote, p, h1, h2, h3');
  const value = node?.textContent?.trim();
  return value && value.length <= 4000 ? value : null;
}

export function editableText(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, [contenteditable]'));
}
