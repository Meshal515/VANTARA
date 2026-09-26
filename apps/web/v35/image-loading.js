/** Loading art lives in the image host's own layout box, even if the host is static. */
export function imageLoadingNode(doc = document) {
  const node = doc.createElement('div');
  node.className = 'skeleton';
  // The shared .skeleton rule is absolute for poster placeholders. An image
  // host in social/profile may be static, so absolute inset:0 would cover .app.
  node.style.position = 'relative';
  node.style.inset = 'auto';
  node.style.width = '100%';
  node.style.height = '100%';
  return node;
}
