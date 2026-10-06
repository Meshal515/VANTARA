const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const validBox = box => Array.isArray(box) && box.length === 4 && box.every(value => Number.isFinite(value) && value >= 0) && box[2] > box[0] && box[3] > box[1];
const covers = (outer, inner) => outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
const words = source => source.normalize('NFKC').toLowerCase().match(/[a-z0-9]+/g) ?? [];
const validRegion = region => nonempty(region?.arabic) && nonempty(region.source) && validBox(region.box) &&
  ['pending', 'translated'].includes(region.status) && !['sfx', 'credit'].includes(region.kind);

/** Keep legacy count admission; a merged holder additionally needs exhaustive old-text coverage. */
export function canAcceptTranslationRepair(previous, next) {
  if (!next || next.error || next.incomplete) return false;
  const oldCount = previous?.translated ?? 0;
  if (next.translated >= oldCount) return true;
  if (!Number.isInteger(oldCount) || !Number.isInteger(next.translated) || next.translated <= 0 ||
      next.incomplete !== false || !nonempty(next.image) || !Array.isArray(previous?.regions) || !Array.isArray(next.regions)) return false;

  const oldRegions = previous.regions.filter(region => nonempty(region?.arabic));
  const newRegions = next.regions.filter(region => nonempty(region?.arabic));
  if (oldRegions.length < oldCount || newRegions.length !== next.translated ||
      !oldRegions.every(validRegion) || !newRegions.every(validRegion)) return false;

  const available = newRegions.map(region => ({ ...region, tokens: words(region.source), used: new Set() }));
  const required = oldRegions.map(region => ({ ...region, tokens: words(region.source) })).sort((a, b) => b.tokens.length - a.tokens.length);
  for (const old of required) {
    if (!old.tokens.length) return false;
    let matched = false;
    for (const candidate of available) {
      if (!covers(candidate.box, old.box)) continue;
      for (let start = 0; start <= candidate.tokens.length - old.tokens.length; start++) {
        if (!old.tokens.every((token, offset) => token === candidate.tokens[start + offset] && !candidate.used.has(start + offset))) continue;
        // One source occurrence cannot prove that two old bubbles survived.
        old.tokens.forEach((_, offset) => candidate.used.add(start + offset));
        matched = true;
        break;
      }
      if (matched) break;
    }
    if (!matched) return false;
  }
  return true;
}
