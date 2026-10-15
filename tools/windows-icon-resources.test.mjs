import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { iconFrames, verifyWindowsIcon, verifyElectronPayload } from './windows-icon-resources.mjs';

const ico = await readFile(new URL('../apps/desktop/assets/vantara.ico', import.meta.url));

// A small PE fixture stores resource entries at non-file RVAs, as Windows does.
// Exercise icon selection by group/language and the resource payload comparison.
function executable() {
  const frames = iconFrames(ico), group = Buffer.alloc(6 + frames.length * 14);
  ico.copy(group, 0, 0, 6);
  frames.forEach((frame, i) => { frame.directory.copy(group, 6 + i * 14); group.writeUInt16LE(i + 1, 18 + i * 14); });
  const bytes = Buffer.alloc(65536);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 0x3c); bytes.write('PE\0\0', 128);
  bytes.writeUInt16LE(0x8664, 132); bytes.writeUInt16LE(2, 134); bytes.writeUInt16LE(240, 148);
  bytes.writeUInt16LE(0x20b, 152); bytes.writeUInt32LE(0x1000, 168); bytes.writeUInt32LE(0x2000, 280);
  bytes.write('.text', 392); bytes.writeUInt32LE(512, 400); bytes.writeUInt32LE(0x1000, 404); bytes.writeUInt32LE(512, 408); bytes.writeUInt32LE(512, 412);
  bytes.write('.rsrc', 432); bytes.writeUInt32LE(60000, 440); bytes.writeUInt32LE(0x2000, 444); bytes.writeUInt32LE(60000, 448); bytes.writeUInt32LE(1024, 452);
  bytes.write('pinned Electron code', 512);
  const base = 1024;
  let tree = 32, data = 4096;
  const alloc = size => { const result = tree; tree += size; return result; };
  function directory(offset, entries) {
    bytes.writeUInt16LE(entries.length, base + offset + 14);
    entries.forEach(([id, pointer], i) => { bytes.writeUInt32LE(id, base + offset + 16 + i * 8); bytes.writeUInt32LE(pointer >>> 0, base + offset + 20 + i * 8); });
  }
  function type(resources) {
    const offset = alloc(16 + resources.length * 8);
    const entries = resources.map(([id, payload]) => {
      const language = alloc(24), value = alloc(16);
      directory(language, [[1033, value]]);
      bytes.writeUInt32LE(0x2000 + data, base + value); bytes.writeUInt32LE(payload.length, base + value + 4);
      payload.copy(bytes, base + data); data += payload.length;
      return [id, language | 0x80000000];
    });
    directory(offset, entries);
    return offset | 0x80000000;
  }
  directory(0, [[3, type(frames.map((frame, i) => [i + 1, frame.bytes]))], [14, type([[1, group]])]]);
  return bytes;
}

test('brand ICO contains every requested Windows size', () => {
  assert.deepEqual(iconFrames(ico).map(frame => frame.directory[0] || 256), [16, 24, 32, 48, 64, 128, 256]);
});

test('requires actual executable resources to match brand pixels', () => {
  const bytes = executable();
  assert.deepEqual(verifyWindowsIcon(bytes, ico), { groups: 1, sizes: [16, 24, 32, 48, 64, 128, 256] });
  bytes[1024 + 4096 + 30] ^= 1;
  assert.throws(() => verifyWindowsIcon(bytes, ico), /icon image differs/);
});

test('refuses an executable whose Electron code changed', () => {
  const upstream = executable(), branded = Buffer.from(upstream);
  branded[1024 + 4096 + 30] ^= 1;
  assert.equal(verifyElectronPayload(branded, upstream), true);
  branded[512] ^= 1;
  assert.throws(() => verifyElectronPayload(branded, upstream), /altered Electron section .text/);
});

test('rejects malformed icon offsets', () => {
  const damaged = Buffer.from(ico);
  damaged.writeUInt32LE(ico.length, 18);
  assert.throws(() => iconFrames(damaged), /Invalid ICO image/);
});


test('accepts a moved unchanged relocation table only when its PE loader directory follows it', () => {
  const upstream = executable();
  upstream.writeUInt16LE(3, 134);
  upstream.write('.reloc', 472);
  upstream.writeUInt32LE(512, 480); upstream.writeUInt32LE(0x12000, 484);
  upstream.writeUInt32LE(512, 488); upstream.writeUInt32LE(62000, 492);
  upstream.writeUInt32LE(0x12000, 304); upstream.writeUInt32LE(12, 308);
  upstream.writeUInt32LE(0x1000, 62000); upstream.writeUInt32LE(12, 62004);
  upstream.writeUInt16LE(0xa008, 62008);
  const branded = Buffer.from(upstream);
  branded.writeUInt32LE(0x13000, 484); branded.writeUInt32LE(0x13000, 304);
  assert.equal(verifyElectronPayload(branded, upstream), true);
  branded.writeUInt32LE(0x12000, 304);
  assert.throws(() => verifyElectronPayload(branded, upstream), /altered Electron section .reloc/);
  branded.writeUInt32LE(0x13000, 304); branded[62008] ^= 1;
  assert.throws(() => verifyElectronPayload(branded, upstream), /altered Electron section .reloc/);
});
