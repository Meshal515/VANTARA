/**
 * Lifecycle of the single shared sheet overlay (server selection, episode tools, etc).
 *
 * An invisible full-screen sheet must never remain hit-testable after closing.
 * CSS pointer-events:none on the backdrop alone is insufficient: descendants
 * (notably the server sheet's header buttons) explicitly restore pointer-events:auto.
 * The inert state removes the entire subtree from hit testing and focus at once.
 */
const EXIT_MS = 260;

export function createSheetController(overlay, body, { exitMs = EXIT_MS } = {}) {
  let onClose = null;
  let exitTimer = 0;

  const cancelExit = () => {
    if (exitTimer) clearTimeout(exitTimer);
    exitTimer = 0;
  };

  const finishExit = () => {
    if (overlay.classList.contains('show')) return;
    overlay.setAttribute('hidden', '');
    overlay.classList.remove('sheet-backdrop--full');
    body.replaceChildren();
    body.className = 'sheet';
    body.removeAttribute('aria-label');
  };

  function close() {
    if (!overlay.classList.contains('show')) return false;
    // Disable ALL descendants immediately, even if their own CSS re-enables taps.
    overlay.classList.remove('show');
    overlay.setAttribute('inert', '');
    overlay.setAttribute('aria-hidden', 'true');
    delete overlay.dataset.tone;
    if (body.contains(body.ownerDocument.activeElement)) {
      body.ownerDocument.activeElement?.blur?.();
    }
    const cleanup = onClose;
    onClose = null;
    cancelExit();
    try {
      cleanup?.();
    } finally {
      // Keep the exit fade; then remove the old fullscreen layout and DOM.
      exitTimer = setTimeout(() => {
        exitTimer = 0;
        finishExit();
      }, exitMs);
    }
    return true;
  }

  function open(build, { tone = null, full = false } = {}) {
    close();
    // Reopening before the fade ends must not allow the old timer to hide us.
    cancelExit();
    overlay.removeAttribute('hidden');
    overlay.removeAttribute('inert');
    overlay.removeAttribute('aria-hidden');
    body.className = 'sheet';
    body.innerHTML = full ? '' : '<div class="sheet-handle"></div>';
    body.removeAttribute('aria-label');
    if (tone) overlay.dataset.tone = tone;
    else delete overlay.dataset.tone;
    overlay.classList.toggle('sheet-backdrop--full', Boolean(full));
    try {
      onClose = build(body) ?? null;
      overlay.classList.add('show');
    } catch (error) {
      overlay.setAttribute('inert', '');
      overlay.setAttribute('aria-hidden', 'true');
      finishExit();
      throw error;
    }
  }

  function destroy() {
    cancelExit();
    if (overlay.classList.contains('show')) close();
    cancelExit();
    overlay.classList.remove('show');
    overlay.setAttribute('inert', '');
    overlay.setAttribute('aria-hidden', 'true');
    finishExit();
  }

  return { open, close, destroy };
}
