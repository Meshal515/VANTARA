const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, Number(n) || 0));
export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');

export function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = d ? max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d : 0;
  h = ((h * 60) % 360 + 360) % 360;
  return [h, max ? d / max : 0, max];
}
export function hsvToHex(h, s, v) {
  h = ((Number(h) % 360) + 360) % 360 / 60; s = clamp(s); v = clamp(v);
  const c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c;
  const rgb = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return rgbToHex(rgb.map((n) => (n + m) * 255));
}
export function luminance(hex) {
  return hexToRgb(hex).map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
    .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
}
export function contrastRatio(a, b) {
  const [min, max] = [luminance(a), luminance(b)].sort((a, b) => a - b);
  return (max + .05) / (min + .05);
}
const leastContrast = (text, colors) => Math.min(...colors.map((bg) => contrastRatio(text, bg)));
export function readableColor(wanted, colors) {
  const primary = leastContrast('#000000', colors) > leastContrast('#ffffff', colors) ? '#000000' : '#ffffff';
  const from = hexToRgb(wanted), to = hexToRgb(primary);
  for (let i = 0; i <= 100; i++) {
    const hex = rgbToHex(from.map((v, c) => v + (to[c] - v) * i / 100));
    if (leastContrast(hex, colors) >= 4.5) return hex;
  }
  return primary;
}
/** A veil is limited to a copy block, only when neither text tone fits it. */
export function copyPalette(colors) {
  const white = leastContrast('#ffffff', colors), black = leastContrast('#000000', colors);
  const guard = Math.max(white, black) < 4.5 ? 'rgba(0, 0, 0, 0.6)' : '';
  const backgrounds = guard ? colors.map((hex) => rgbToHex(hexToRgb(hex).map((v) => v * .4))) : colors;
  const dark = !guard && black > white;
  return {
    text: dark ? '#000000' : '#ffffff',
    secondary: readableColor(dark ? '#292929' : '#dedede', backgrounds),
    muted: readableColor(dark ? '#3b3b3b' : '#cecece', backgrounds),
    success: readableColor('#5fd49a', backgrounds),
    accent: readableColor('#bba2ff', backgrounds),
    warning: readableColor('#f2b75b', backgrounds),
    guard,
  };
}
