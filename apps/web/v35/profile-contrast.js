import { copyPalette } from './profile-color.js';
import { normalizeProfileTheme, sampleProfileBackground, DEFAULT_BACKGROUND } from './profile-theme.js';

const COPY = '.pf-name,.pf-bio,.pf-handle,.pf-live,.pf-bio-add,.section-head h2,.pf-meta,.pf-card-title,.pf-card-meta,.pf-log-more,.pf-arrange,.pe-label > span,.pe-label > em,.pe-name,.pe-bio,.pe-preview-name,.pe-preview-bio,.pe-preview-shelf';
const CARD = '.pf-first,.pf-stats,.pf-now,.pf-log,.rv-list,.pe-preview-card';
const KEYS = ['--text-1','--text-2','--text-3','--text-4','--success','--accent-text','--warning','--line','--line-strong'];

/** Text follows its own position; selected gradient colors remain untouched. */
export function observeProfileContrast(root, input, background = root) {
  let theme = normalizeProfileTheme(input);
  let frame = null;
  let destroyed = false;
  const painted = new Set();
  const belongsToRoot = (node) => !node.closest('.pe-preview') || node.closest('.pe-preview') === root;
  function refresh() {
    frame = null;
    if (destroyed || !root.isConnected) return;
    const enabled = Boolean(theme.backgroundColor || theme.backgroundGradient);
    for (const node of painted) {
      for (const key of KEYS) node.style.removeProperty(key);
      node.classList.remove('pf-copy-guard');
    }
    painted.clear();
    for (const node of root.querySelectorAll('.pf-face,.pf-dot,.pe-face,.pe-cam--face,.pe-preview-avatar')) { if (belongsToRoot(node)) node.style.removeProperty('--bg'); }
    if (!enabled) return;
    const rect = background.getBoundingClientRect();
    const height = parseFloat(getComputedStyle(background).getPropertyValue('--pf-gradient-height')) || 840;
    const point = (x, y) => sampleProfileBackground(theme, x - rect.left, y - rect.top + background.scrollTop, rect.width, height);
    for (const node of root.querySelectorAll(COPY)) {
      if (!belongsToRoot(node) || node.closest(CARD) || !node.getClientRects().length) continue;
      let box = node.getBoundingClientRect();
      // Sample the ink, not the unused width of right-aligned fields/headings.
      if (node.matches('input,textarea')) {
        const style = getComputedStyle(node);
        const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const lines = (node.value || node.placeholder || '').split('\n');
        const width = Math.min(box.width, Math.max(24, ...lines.map((line) => context.measureText(line).width)) + 16);
        box = { ...box.toJSON(), left: box.right - width, width };
      } else if (node.childNodes.length && [...node.childNodes].every((child) => child.nodeType === 3)) {
        const range = document.createRange(); range.selectNodeContents(node);
        const ink = range.getBoundingClientRect();
        if (ink.width && ink.height) box = ink;
      }
      const colors = [];
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) colors.push(point(box.left + box.width * i / 4, box.top + box.height * j / 2));
      const tone = copyPalette(colors);
      const values = [tone.text,tone.secondary,tone.muted,tone.muted,tone.success,tone.accent,tone.warning,tone.text === '#000000' ? 'rgba(0,0,0,.14)' : 'rgba(255,255,255,.16)',tone.text === '#000000' ? 'rgba(0,0,0,.24)' : 'rgba(255,255,255,.26)'];
      KEYS.forEach((key, i) => node.style.setProperty(key, values[i]));
      node.classList.toggle('pf-copy-guard', Boolean(tone.guard));
      painted.add(node);
    }
    for (const node of root.querySelectorAll('.pf-face,.pf-dot,.pe-face,.pe-cam--face,.pe-preview-avatar')) {
      if (!belongsToRoot(node)) continue;
      const box = node.getBoundingClientRect();
      node.style.setProperty('--bg', point(box.left + box.width / 2, box.top + box.height / 2));
    }
    const top = root.querySelector('.pe-top');
    if (top) {
      const tone = copyPalette([theme.backgroundColor || DEFAULT_BACKGROUND]);
      top.style.setProperty('--text-1', tone.text);
      top.style.setProperty('--text-3', tone.muted);
      painted.add(top);
    }
  }
  const schedule = () => { if (frame === null && !destroyed) frame = requestAnimationFrame(refresh); };
  const resize = new ResizeObserver(schedule);
  resize.observe(background);
  if (background !== root) resize.observe(root);
  const mutation = new MutationObserver(schedule);
  mutation.observe(root, { subtree: true, childList: true, characterData: true });
  window.addEventListener('resize', schedule);
  background.addEventListener('scroll', schedule, { passive: true });
  schedule();
  return {
    update(value) { theme = normalizeProfileTheme(value); schedule(); },
    refresh: schedule,
    destroy() {
      destroyed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      resize.disconnect(); mutation.disconnect();
      window.removeEventListener('resize', schedule);
      background.removeEventListener('scroll', schedule);
    },
  };
}
