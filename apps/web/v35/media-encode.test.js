import { describe, expect, it } from 'vitest';
import { sniffAnimated } from './media-encode.js';

const bytes = (...parts) =>
  new Blob(parts.map((p) => (typeof p === 'string' ? new TextEncoder().encode(p) : new Uint8Array(p))));
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const GCE = [0x21, 0xf9, 0x04, 0, 10, 0, 0, 0];

describe('كشف الصور المتحركة من البايتات', () => {
  it('GIF بإطارين متحركة، وبإطار واحد ثابتة', async () => {
    const header = ['GIF89a', [1, 0, 1, 0, 0, 0, 0]];
    expect(await sniffAnimated(bytes(...header, GCE, [0x2c], GCE, [0x2c]))).toBe('image/gif');
    expect(await sniffAnimated(bytes(...header, GCE, [0x2c]))).toBeNull();
  });

  it('WebP بعلَم الحركة في VP8X', async () => {
    const webp = (flags) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0, flags, 0, 0, 0]);
    expect(await sniffAnimated(webp(0x02))).toBe('image/webp');
    expect(await sniffAnimated(webp(0x00))).toBeNull();
    expect(await sniffAnimated(bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 ', [0, 0, 0, 0]))).toBeNull();
  });

  it('APNG: acTL قبل IDAT', async () => {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const chunk = (type, len = 0) => [u32(len), type, new Array(len + 4).fill(0)];
    expect(await sniffAnimated(bytes(sig, ...chunk('IHDR', 13), ...chunk('acTL', 8), ...chunk('IDAT', 2)))).toBe('image/png');
    expect(await sniffAnimated(bytes(sig, ...chunk('IHDR', 13), ...chunk('IDAT', 2)))).toBeNull();
  });

  it('JPEG ليست متحركة', async () => {
    expect(await sniffAnimated(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
  });
});
