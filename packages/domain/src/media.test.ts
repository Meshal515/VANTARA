import { describe, expect, it } from 'vitest';
import { MAX_MEDIA_BYTES, isMediaHash, sniffImageType } from './media.ts';

const bytes = (...xs: number[]) => new Uint8Array(xs);
const text = (s: string) => new TextEncoder().encode(s);

describe('sniffImageType', () => {
  it('يعرف الصور من بايتاتها', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d))).toBe('image/png');
    expect(sniffImageType(text('GIF89a...'))).toBe('image/gif');
    expect(sniffImageType(text('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
  });
  it('يرفض ما ليس صورة ولو ادّعى', () => {
    expect(sniffImageType(text('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffImageType(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
  });
  it('المعرّف بصمة SHA-256 فقط', () => {
    expect(isMediaHash('a'.repeat(64))).toBe(true);
    expect(isMediaHash('../etc/passwd')).toBe(false);
    expect(isMediaHash('A'.repeat(64))).toBe(false);
  });
});

describe('سقف الصورة وD1', () => {
  it('الصورة بأقصى حجمها تدخل صفًّا واحدًا في D1 بعد base64', () => {
    const base64 = Math.ceil(MAX_MEDIA_BYTES / 3) * 4;
    expect(base64 + 1_000).toBeLessThan(2_000_000);
  });
});
