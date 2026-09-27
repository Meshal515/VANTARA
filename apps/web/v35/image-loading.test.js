import { describe, expect, it } from 'vitest';
import { imageLoadingNode, imageFallbackNode } from './image-loading.js';

describe('uncached cover inside a static image host', () => {
  it('keeps the loading skeleton in the host box rather than .app', () => {
    const host = { position: 'static', width: 34, height: 48 };
    const node = imageLoadingNode({ createElement: () => ({ style: {} }) });
    expect(host.position).toBe('static'); // The caller need not opt into positioning.
    expect(node.className).toBe('skeleton');
    expect(node.style).toMatchObject({
      position: 'relative', inset: 'auto', width: '100%', height: '100%',
    });
  });
});

describe('failed cover inside a static image host', () => {
  it('keeps the fallback in the host box rather than covering .app', () => {
    const doc = { createElement: () => ({ style: {}, append(child) { this.child = child; } }) };
    const node = imageFallbackNode('—', doc);
    expect(node.className).toBe('image-fallback');
    expect(node.style).toMatchObject({ position: 'relative', inset: 'auto', width: '100%', height: '100%' });
    expect(node.child.textContent).toBe('—');
  });
});
