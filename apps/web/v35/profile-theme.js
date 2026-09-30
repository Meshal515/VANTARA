/** Shared by the profile and editor. Only validated colors become CSS. */
import { rgb01ToHex } from '../lib/silk-palette.js';

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

const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
const luminance = (values) => values.map((v) => {
  const n = v / 255;
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

function textTone(colors) {
  const first = rgb(colors[0]);
  const last = rgb(colors.at(-1));
  const samples = Array.from({ length: 21 }, (_, i) => first.map((v, c) => v + (last[c] - v) * i / 20));
  const lights = samples.map(luminance);
  const white = 1.05 / (Math.max(...lights) + 0.05);
  const black = (Math.min(...lights) + 0.05) / 0.05;
  return { darkText: black > white, needsShade: Math.max(white, black) < 4.5, samples };
}

/** Bring secondary text toward the primary only as far as readability requires. */
function readableMuted(wanted, primary, backgrounds) {
  const start = rgb(wanted);
  const end = rgb(primary);
  const lights = backgrounds.map(luminance);
  for (let step = 0; step <= 10; step++) {
    const hex = rgb01ToHex(start.map((v, i) => (v + (end[i] - v) * step / 10) / 255));
    const light = luminance(rgb(hex));
    if (lights.every((l) => (Math.max(l, light) + 0.05) / (Math.min(l, light) + 0.05) >= 4.5)) return hex;
  }
  return primary;
}

export function profileThemeStyle(input) {
  const theme = normalizeProfileTheme(input);
  const style = {};
  if (theme.backgroundColor || theme.backgroundGradient) {
    const first = theme.backgroundColor || DEFAULT_BACKGROUND;
    const colors = theme.backgroundGradient ? [first, theme.backgroundGradient] : [first];
    const tone = textTone(colors);
    const dark = tone.darkText && !tone.needsShade;
    const background = theme.backgroundGradient ? `linear-gradient(${theme.backgroundAngle ?? 135}deg, ${colors.join(', ')})` : first;
    style['--pf-background'] = tone.needsShade ? `linear-gradient(rgba(0, 0, 0, 0.58), rgba(0, 0, 0, 0.58)), ${background}` : background;
    style['--bg'] = tone.needsShade ? '#08070c' : first;
    style['--text-1'] = dark ? '#000000' : '#ffffff';
    const samples = tone.needsShade ? tone.samples.map((color) => color.map((v) => v * 0.42)) : tone.samples;
    style['--text-2'] = readableMuted(dark ? '#171717' : '#f2f2f2', style['--text-1'], samples);
    style['--text-3'] = readableMuted(dark ? '#292929' : '#e0e0e0', style['--text-1'], samples);
    style['--text-4'] = readableMuted(dark ? '#333333' : '#cecece', style['--text-1'], samples);
    style['--line'] = dark ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.14)';
    style['--line-strong'] = dark ? 'rgba(0, 0, 0, 0.22)' : 'rgba(255, 255, 255, 0.24)';
  }
  // Cards stay readable independently of the page, including the default dark cards on a light page.
  if (theme.cardColor || theme.backgroundColor || theme.backgroundGradient) {
    const card = theme.cardColor || DEFAULT_CARD;
    const tone = textTone([card]);
    const dark = tone.darkText;
    style['--pf-card'] = card;
    style['--pf-card-text'] = dark ? '#000000' : '#ffffff';
    style['--pf-card-muted'] = readableMuted(dark ? '#333333' : '#dedede', style['--pf-card-text'], tone.samples);
    style['--pf-card-line'] = dark ? 'rgba(0, 0, 0, 0.16)' : 'rgba(255, 255, 255, 0.16)';
    style['--pf-card-hover'] = `color-mix(in srgb, ${card} 90%, ${dark ? '#000000' : '#ffffff'})`;
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
