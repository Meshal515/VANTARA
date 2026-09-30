/** Keep explicit places before assigning legacy entries to free places. */
export function profileTopSlots(items, resolve = (item) => item) {
  const slots = Array(5).fill(null);
  const loose = [];
  for (const item of items) {
    const position = Number(item.position);
    if (Number.isInteger(position) && position >= 1 && position <= 5 && !slots[position - 1]) slots[position - 1] = resolve(item);
    else loose.push(item);
  }
  for (const item of loose) {
    const free = slots.indexOf(null);
    if (free < 0) break;
    slots[free] = resolve(item);
  }
  return slots;
}
