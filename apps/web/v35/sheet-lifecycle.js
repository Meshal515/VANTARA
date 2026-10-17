/**
 * دورة حياة الأوراق: إزالة عنصر fullscreen من hit testing قبل تشغيل
 * التنظيف غير المتزامن. لا يكفي opacity:0 ولا pointer-events:none على الأب
 * لأن أزرار .ss-bar > * تستعيد pointer-events:auto في ورقة السيرفرات.
 */
export function createSheetController(backdrop, body) {
  let dispose = null;

  function resetBody() {
    body.replaceChildren();
    body.className = 'sheet';
    body.removeAttribute('aria-label');
  }

  function close() {
    if (!backdrop.classList.contains('show')) return false;
    // إخراج الورقة وأزرارها من hit testing فورًا، لا بعد انتقال CSS.
    if (body.contains(body.ownerDocument.activeElement)) {
      body.ownerDocument.activeElement?.blur?.();
    }
    backdrop.classList.remove('show', 'sheet-backdrop--full');
    backdrop.inert = true;
    backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');
    delete backdrop.dataset.tone;
    const cleanup = dispose;
    dispose = null;
    try {
      cleanup?.();
    } finally {
      // إن فتح callback ورقة أخرى، لا تمسح الورقة الجديدة.
      if (!backdrop.classList.contains('show')) resetBody();
    }
    return true;
  }

  function open(build, { tone = null, full = false } = {}) {
    close();
    resetBody();
    if (!full) {
      const handle = body.ownerDocument.createElement('div');
      handle.className = 'sheet-handle';
      body.append(handle);
    }
    if (tone) backdrop.dataset.tone = tone;
    else delete backdrop.dataset.tone;
    backdrop.classList.toggle('sheet-backdrop--full', Boolean(full));
    backdrop.inert = false;
    backdrop.hidden = false;
    backdrop.removeAttribute('aria-hidden');
    try {
      dispose = build(body) ?? null;
      backdrop.classList.add('show');
    } catch (error) {
      // حتى فشل رسم الورقة لا يترك fullscreen ghost layer.
      backdrop.classList.remove('show', 'sheet-backdrop--full');
      backdrop.inert = true;
      backdrop.hidden = true;
      backdrop.setAttribute('aria-hidden', 'true');
      delete backdrop.dataset.tone;
      resetBody();
      dispose = null;
      throw error;
    }
  }

  return { open, close };
}
