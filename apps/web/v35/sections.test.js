import { describe, expect, it } from 'vitest';
import { SECTIONS, readSection, writeSection } from './sections.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

describe('sections', () => {
  it('starts on manga', () => expect(readSection(memory())).toBe('manga'));
  it('remembers a ready section', () => {
    const s = memory();
    expect(writeSection('anime', s)).toBe(true);
    expect(readSection(s)).toBe('anime');
  });
  it('never lands on a section that is not ready', () => {
    const s = memory();
    expect(writeSection('cinema', s)).toBe(false);
    s.setItem('vantara.section', 'cinema');
    expect(readSection(s)).toBe('manga');
  });
  it('survives a storage that throws', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readSection(bad)).toBe('manga');
    expect(writeSection('anime', bad)).toBe(true);
  });
  it('every section names its unit and verb', () => {
    for (const s of Object.values(SECTIONS)) expect(s.unit && s.verb && s.word).toBeTruthy();
  });
});
