/** Closed model contract. No font paths, arbitrary scales or substring shaping. */
export const LETTERING_ROLES = ['neutral','soft','whisper','thought','narration','formal','regal','ancient','comic','child','rough','threat','villain','shout','scream','impact','mechanical','sign','title','blood'] as const;
export const LETTERING_INKS = ['auto','black','white','crimson','blood','gold','blue','violet','gray'] as const;
export const LETTERING_INTENSITIES = ['quiet','normal','strong','extreme'] as const;
export interface LetteringStyle {
  role: (typeof LETTERING_ROLES)[number]; ink: (typeof LETTERING_INKS)[number]; intensity: (typeof LETTERING_INTENSITIES)[number]; emphasis: string[];
}
const choose = <T extends string>(values: readonly T[], value: unknown, fallback: T): T => values.includes(value as T) ? value as T : fallback;
const word = /[\p{L}\p{M}\p{N}_]/u;
export function normalizeLettering(raw: unknown, arabic: string | null): LetteringStyle {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const emphasis: string[] = [];
  for (const value of Array.isArray(input.emphasis) ? input.emphasis : []) {
    if (typeof value !== 'string' || !arabic || !value.trim() || value.length > 120 || emphasis.includes(value)) continue;
    let from = 0;
    while (from < arabic.length) {
      const index = arabic.indexOf(value, from);
      if (index < 0) break;
      if (!word.test(arabic[index - 1] ?? '') && !word.test(arabic[index + value.length] ?? '')) { emphasis.push(value); break; }
      from = index + 1;
    }
    if (emphasis.length === 3) break;
  }
  return { role: choose(LETTERING_ROLES,input.role,'neutral'), ink: choose(LETTERING_INKS,input.ink,'auto'), intensity: choose(LETTERING_INTENSITIES,input.intensity,'normal'), emphasis };
}
const strip = (s: string) => s.replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g,'ا');
const tokens = (s: string) => strip(s).match(/[\p{L}]+/gu) ?? [];
const banned = /^([وف]?)([بكل]?)(ال|ل)?(اله|رب|الهة|الهت)(ا|ي|نا|ك|كم|كما|كن|ه|ها|هم|هما|هن)?$/u;
const singular = /^(?:[وفبكل])?(?:ال)?(?:حاكم|ملك)(?:ا|ي|نا|ه|ها|هم|كم)?$/u;
const plural = /^(?:[وفبكل])?(?:ال)?(?:حكام|ملوك)(?:ا|ي|نا|ه|ها|هم|كم)?$/u;
const need = (source: string) => ({ single: /\bgod\b/i.test(source), many: /\bgods\b/i.test(source) });
export function validateGodTranslation(source: string, arabic: string | null): boolean {
  const { single, many } = need(source);
  if (!single && !many) return true;
  const words = tokens(arabic ?? '');
  return !words.some(w => banned.test(w)) && (!single || words.some(w => singular.test(w))) && (!many || words.some(w => plural.test(w)));
}
export function safeGodTranslation(source: string, arabic: string | null): string | null {
  const { single, many } = need(source);
  if (!single && !many || validateGodTranslation(source,arabic)) return arabic;
  const replaced = (arabic ?? '').replace(/[\p{L}\p{M}]+/gu, token => {
    const clean = strip(token);
    if (!banned.test(clean)) return token;
    const match = banned.exec(clean)!;
    const conjunction = match[1] ?? '', preposition = match[2] ?? '', definite = Boolean(match[3]);
    const prefix = conjunction + (preposition === 'ل' && definite ? 'لل' : preposition + (definite ? 'ال' : ''));
    const ruler = many && (!single || /اله[ةت]/u.test(match[4]!)) ? 'ملوك' : 'حاكم';
    const suffix = match[5] === 'ا' ? '' : match[5] ?? '';
    return prefix + ruler + suffix;
  });
  if (validateGodTranslation(source,replaced)) return replaced;
  // No valid translation to retain: a bounded safe term, never forbidden wording.
  return single && many ? 'حاكم وملوك' : many ? 'ملوك' : 'حاكم';
}
export const LETTERING_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['role','ink','intensity','emphasis'],
  properties: { role: { type: 'string', enum: [...LETTERING_ROLES] }, ink: { type: 'string', enum: [...LETTERING_INKS] }, intensity: { type: 'string', enum: [...LETTERING_INTENSITIES] }, emphasis: { type: 'array', maxItems: 3, items: { type: 'string' } } },
} as const;
