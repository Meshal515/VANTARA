import { parseHTML } from 'linkedom';
import { expect, it, vi } from 'vitest';
import { createServerSheet } from './server-sheet.js';

const { document } = parseHTML('<html><body></body></html>');
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

it('لا مصدر في الحساب: «أضف مصدرًا لتشاهد» مكان القائمة، والزر يفتح الإضافات ولا يشغّل شيئًا', () => {
  const body = el('div');
  const onAddSource = vi.fn();
  const onBest = vi.fn();
  const ui = createServerSheet(body, { el, title: 'عمل', onAddSource, onBest });
  ui.update({ routes: [], noSources: true, status: { text: '' } });
  expect(body.textContent).toContain('أضف مصدرًا لتشاهد');
  expect(body.querySelector('.ss-skel-list')).toBeNull();
  body.querySelector('.ss-add-source').click();
  ui.best.click();
  expect(onAddSource).toHaveBeenCalledTimes(2);
  expect(onBest).not.toHaveBeenCalled();
});

it('سيرفر صالح وصل رغم ذلك: لا رسالة «أضف مصدرًا»', () => {
  const body = el('div');
  const ui = createServerSheet(body, { el, title: 'عمل', onAddSource: () => {} });
  ui.update({ routes: [{ id: 'a', state: 'READY', server: 'https://ok.example/v.mp4', quality: 1080 }], noSources: true, status: { text: '' } });
  expect(body.textContent).not.toContain('أضف مصدرًا لتشاهد');
});
