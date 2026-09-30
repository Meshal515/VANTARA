/** Shared by the profile and editor. Only validated colors become CSS. */
import { rgb01ToHex } from '../lib/silk-palette.js';
import { copyPalette, hexToRgb, rgbToHex } from './profile-color.js';

export const THEME_FIELDS = ['backgroundColor', 'backgroundGradient', 'backgroundAngle', 'cardColor'];
export const DEFAULT_BACKGROUND = '#08070c';
export const DEFAULT_CARD = '#121019';
export const normalizeColor = (value) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : null;

export function normalizeProfileTheme(theme = {}) {
  return {
    backgroundColor: normalizeColor(theme.backgroundColor),
    backgroundGradient: normalizeColor(theme.backgroundGradient),
    backgroundAngle: Number.isInteger(theme.backgroundAngle) && theme.backgroundAngle >= 0 && theme.backgroundAngle <= 360 ? theme.backgroundAngle : null,
    cardColor: normalizeColor(theme.cardColor),
  };
}

export function profileThemePatch(start, draft) {
  const before = normalizeProfileTheme(start);
  const after = normalizeProfileTheme(draft);
  return Object.fromEntries(THEME_FIELDS.filter((key) => before[key] !== after[key]).map((key) => [key, after[key]]));
}

export function reverseProfileGradient(input) {
  const theme = normalizeProfileTheme(input);
  if (!theme.backgroundGradient) return theme;
  return { ...theme, backgroundColor: theme.backgroundGradient, backgroundGradient: theme.backgroundColor || DEFAULT_BACKGROUND };
}

/** The dominant midtone retains the image hue without washing out the page. */
export function matchedProfileTheme(kind, banner, avatar) {
  const first = kind === 'avatar' ? avatar?.[2] : banner?.[2];
  const second = kind === 'both' ? avatar?.[2] : null;
  if (!first || (kind === 'both' && !second)) return null;
  const card = first.map((v, i) => ((v + (second?.[i] ?? v)) / 2) * 0.74 + [0.03, 0.027, 0.047][i] * 0.26);
  return {
    backgroundColor: rgb01ToHex(first),
    backgroundGradient: second ? rgb01ToHex(second) : null,
    backgroundAngle: second ? 135 : null,
    cardColor: rgb01ToHex(card),
  };
}

/** CSS gradient coordinates within the fixed profile gradient area. */
export function sampleProfileBackground(input, x, y, width, height = 840) {
  const theme = normalizeProfileTheme(input);
  const first = theme.backgroundColor || DEFAULT_BACKGROUND;
  if (!theme.backgroundGradient) return first;
  const end = theme.backgroundGradient;
  if (y >= height) return end;
  const radians = (theme.backgroundAngle ?? 135) * Math.PI / 180;
  const ux = Math.sin(radians), uy = -Math.cos(radians);
  const length = Math.abs(width * ux) + Math.abs(height * uy);
  const t = Math.min(1, Math.max(0, .5 + ((x - width / 2) * ux + (y - height / 2) * uy) / Math.max(1, length)));
  const a = hexToRgb(first), b = hexToRgb(end);
  const fade = Math.min(1, Math.max(0, (y / height - .8) / .2));
  return rgbToHex(a.map((n, i) => (n + (b[i] - n) * t) * (1 - fade) + b[i] * fade));
}

export function profileThemeStyle(input) {
  const theme = normalizeProfileTheme(input);
  const style = {};
  if (theme.backgroundColor || theme.backgroundGradient) {
    const first = theme.backgroundColor || DEFAULT_BACKGROUND;
    const last = theme.backgroundGradient || first;
    const colors = theme.backgroundGradient ? [first, last] : [first];
    const tone = copyPalette(colors);
    style['--pf-background'] = theme.backgroundGradient ? `linear-gradient(${theme.backgroundAngle ?? 135}deg, ${colors.join(', ')})` : first;
    style['--pf-background-end'] = last;
    style['--pf-gradient-image'] = theme.backgroundGradient ? `linear-gradient(180deg, transparent 80%, ${last} 100%), ${style['--pf-background']}` : 'none';
    style['--bg'] = first;
    style['--text-1'] = tone.text;
    style['--text-2'] = tone.secondary;
    style['--text-3'] = tone.muted;
    style['--text-4'] = tone.muted;
    style['--success'] = tone.success;
    style['--accent-text'] = tone.accent;
    style['--warning'] = tone.warning;
    const dark = tone.text === '#000000';
    style['--line'] = dark ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.14)';
    style['--line-strong'] = dark ? 'rgba(0, 0, 0, 0.22)' : 'rgba(255, 255, 255, 0.24)';
  }
  if (theme.cardColor || theme.backgroundColor || theme.backgroundGradient) {
    const card = theme.cardColor || DEFAULT_CARD;
    const tone = copyPalette([card]);
    style['--pf-card'] = card;
    style['--pf-card-text'] = tone.text;
    style['--pf-card-muted'] = tone.muted;
    style['--pf-card-success'] = tone.success;
    style['--pf-card-accent'] = tone.accent;
    style['--pf-card-line'] = tone.text === '#000000' ? 'rgba(0, 0, 0, 0.16)' : 'rgba(255, 255, 255, 0.16)';
    style['--pf-card-hover'] = `color-mix(in srgb, ${card} 90%, ${tone.text === '#000000' ? '#000000' : '#ffffff'})`;
  }
  return style;
}

const STYLE_KEYS = Object.keys(profileThemeStyle({ backgroundColor: '#000000', cardColor: '#000000' }));
export function applyProfileTheme(node, theme) {
  const style = profileThemeStyle(theme);
  for (const key of STYLE_KEYS) {
    if (style[key]) node.style.setProperty(key, style[key]);
    else node.style.removeProperty(key);
  }
  node.classList.toggle('pf-themed', Object.keys(style).length > 0);
}
