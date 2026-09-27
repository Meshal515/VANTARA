import { afterEach, expect, it, vi } from 'vitest';
import { copyableText, editableText } from './text-actions.js';

class FakeElement {
  constructor({ blocked = false, editable = false, text = null } = {}) {
    this.blocked = blocked;
    this.editable = editable;
    this.text = text;
  }
  closest(selector) {
    if (selector.includes('input')) return this.blocked || this.editable ? this : null;
    return this.text == null ? null : { textContent: this.text };
  }
}
afterEach(() => vi.unstubAllGlobals());

it('offers copy for ordinary text and leaves native selection in edit fields', () => {
  vi.stubGlobal('Element', FakeElement);
  expect(copyableText(new FakeElement({ text: '  نص قابل للنسخ  ' }))).toBe('نص قابل للنسخ');
  expect(copyableText(new FakeElement({ blocked: true, text: 'عنوان بطاقة' }))).toBeNull();
  expect(editableText(new FakeElement({ editable: true }))).toBe(true);
});
