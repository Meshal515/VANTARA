/** Keep card/image nodes for the same work across sync and source refreshes. */
export function reconcileCardNodes(target, items, create, update) {
  const existing = new Map([...target.children].filter((node) => node.dataset.workId).map((node) => [node.dataset.workId, node]));
  const next = items.map((work) => {
    const node = existing.get(String(work.id)) ?? create(work);
    update(node, work);
    return node;
  });
  // Keep unchanged images attached even when one new source changes ordering.
  next.forEach((node, i) => {
    if (target.children[i] !== node) target.insertBefore(node, target.children[i] ?? null);
  });
  for (const node of [...target.children]) if (!next.includes(node)) node.remove();
}
