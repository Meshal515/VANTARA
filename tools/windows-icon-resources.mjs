import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Read the real PE resource tree; checking an adjacent .ico does not prove the
// executable's Explorer/taskbar artwork was replaced.
export function iconFrames(ico) {
  if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error('Invalid ICO header');
  const count = ico.readUInt16LE(4);
  if (!count || ico.length < 6 + 16 * count) throw new Error('Invalid ICO directory');
  return Array.from({ length: count }, (_, i) => {
    const offset = 6 + i * 16;
    const size = ico.readUInt32LE(offset + 8), start = ico.readUInt32LE(offset + 12);
    if (!size || start < 6 + 16 * count || start + size > ico.length) throw new Error('Invalid ICO image');
    return { directory: ico.subarray(offset, offset + 12), bytes: ico.subarray(start, start + size) };
  });
}

export function peResources(bytes) {
  const pe = bytes.readUInt32LE(0x3c);
  if (bytes.toString('ascii', 0, 2) !== 'MZ' || bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw new Error('Invalid PE');
  const optional = pe + 24, magic = bytes.readUInt16LE(optional);
  if (![0x10b, 0x20b].includes(magic)) throw new Error('Invalid PE optional header');
  const sectionCount = bytes.readUInt16LE(pe + 6), optionalSize = bytes.readUInt16LE(pe + 20);
  const resourceRva = bytes.readUInt32LE(optional + (magic === 0x20b ? 112 : 96) + 16);
  const sections = Array.from({ length: sectionCount }, (_, i) => {
    const offset = optional + optionalSize + i * 40;
    return { rva: bytes.readUInt32LE(offset + 12), size: Math.max(bytes.readUInt32LE(offset + 8), bytes.readUInt32LE(offset + 16)), raw: bytes.readUInt32LE(offset + 20) };
  });
  const address = rva => {
    const section = sections.find(s => rva >= s.rva && rva < s.rva + s.size);
    if (!section) throw new Error('PE resource address outside sections');
    return section.raw + rva - section.rva;
  };
  if (!resourceRva) return [];
  const base = address(resourceRva), result = [];
  function walk(relative, ids = []) {
    if (ids.length > 3) throw new Error('Invalid PE resource depth');
    const offset = base + relative, count = bytes.readUInt16LE(offset + 12) + bytes.readUInt16LE(offset + 14);
    for (let i = 0; i < count; i++) {
      const entry = offset + 16 + i * 8, name = bytes.readUInt32LE(entry), value = bytes.readUInt32LE(entry + 4);
      let id = name;
      if (name & 0x80000000) { const start = base + (name & 0x7fffffff); id = bytes.toString('utf16le', start + 2, start + 2 + bytes.readUInt16LE(start) * 2); }
      const next = [...ids, id];
      if (value & 0x80000000) walk(value & 0x7fffffff, next);
      else {
        const data = base + value, start = address(bytes.readUInt32LE(data)), size = bytes.readUInt32LE(data + 4);
        if (start + size > bytes.length) throw new Error('Truncated PE resource');
        result.push({ ids: next, bytes: bytes.subarray(start, start + size) });
      }
    }
  }
  walk(0);
  return result;
}

export function verifyWindowsIcon(executable, ico) {
  const frames = iconFrames(ico), resources = peResources(executable);
  const groups = resources.filter(resource => resource.ids[0] === 14);
  if (!groups.length) throw new Error('Executable has no icon group');
  for (const group of groups) {
    if (group.bytes.readUInt16LE(2) !== 1 || group.bytes.readUInt16LE(4) !== frames.length) throw new Error('Executable icon frame count differs from VANTARA');
    frames.forEach((frame, i) => {
      const offset = 6 + i * 14, id = group.bytes.readUInt16LE(offset + 12);
      if (!group.bytes.subarray(offset, offset + 12).equals(frame.directory)) throw new Error('Executable icon directory differs from VANTARA');
      const image = resources.find(resource => resource.ids[0] === 3 && resource.ids[1] === id && resource.ids[2] === group.ids[2]);
      if (!image?.bytes.equals(frame.bytes)) throw new Error('Executable icon image differs from VANTARA');
    });
  }
  return { groups: groups.length, sizes: frames.map(frame => frame.directory[0] || 256) };
}

export function verifyElectronPayload(branded, upstream) {
  function payload(bytes) {
    const pe = bytes.readUInt32LE(0x3c), optional = pe + 24;
    const start = optional + bytes.readUInt16LE(pe + 20);
    const sections = new Map();
    for (let i = 0; i < bytes.readUInt16LE(pe + 6); i++) {
      const offset = start + i * 40;
      const name = bytes.toString('ascii', offset, offset + 8).replace(/\0.*$/, '');
      if (name === '.rsrc') continue;
      const raw = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 16);
      sections.set(name, { rva: bytes.readUInt32LE(offset + 12), bytes: bytes.subarray(raw, raw + size) });
    }
    return { machine: bytes.readUInt16LE(pe + 4), entryPoint: bytes.readUInt32LE(optional + 16), sections };
  }
  const original = payload(upstream), changed = payload(branded);
  if (original.machine !== 0x8664 || changed.machine !== original.machine || changed.entryPoint !== original.entryPoint || changed.sections.size !== original.sections.size) throw new Error('Branded executable differs from pinned Electron payload');
  for (const [name, originalSection] of original.sections) {
    const changedSection = changed.sections.get(name);
    if (!changedSection || originalSection.rva !== changedSection.rva || !originalSection.bytes.equals(changedSection.bytes)) throw new Error(`Branded executable altered Electron section ${name}`);
  }
  if (!original.sections.has('.text')) throw new Error('Electron code section missing');
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [exe, ico] = process.argv.slice(2);
  console.log(JSON.stringify(verifyWindowsIcon(await fs.readFile(exe), await fs.readFile(ico))));
}
