/**
 * عارض الفريم — الصفحات التي أرسلها صديقك وحدها، بترتيبه.
 *
 * نفس لغة القارئ: أسود كامل والصفحات بعرض الشاشة. فوقها سطر واحد يقول من
 * أرسل ومن أي عمل، ورسالته فقاعة قبل أول صفحة. وفي النهاية «اقرأ الفصل كامل»
 * يفتح القارئ الذكي على نفس الفصل ومن أول صفحة أرسلها.
 *
 * الصور تُجلب من المصدر بمحرّك هذا الجهاز لا من خادمنا، وقائمة الفصل تُطلب
 * من جديد لأن روابط الصور الموقّعة تنتهي؛ المحفوظ بديلٌ لا أصل.
 */

import { refForTitle } from './work-ref.js';
import { glyph, iconButton } from './icons.js';
import { countLabel } from './plural.js';
import { resolveFramePages } from '../lib/frame.js';
import { chapterNumberOf } from '../lib/catalog.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const parse = (text, fallback) => {
  try {
    return JSON.parse(text ?? '') ?? fallback;
  } catch {
    return fallback;
  }
};

/**
 * @param {{ engine: any, mount: (n: Element) => void, exit: () => void,
 *           readChapter: (target: object) => void, immersive?: (on: boolean) => void }} deps
 * @param {{ frame: any, fromName: string, fromAvatar?: string|null, toLabel: string }} ctx
 */
export function openFrameViewer(deps, ctx) {
  const { frame } = ctx;
  const work = parse(frame.work_json, {});
  const chapter = parse(frame.chapter_json, {});
  const stored = parse(frame.pages_json, []);

  const root = el('div', 'v35 rd rd--chrome fv');
  root.innerHTML = `
    <div class="rd-scroll" id="fvScroll"></div>
    <header class="rd-top">
      ${iconButton('back', 'رجوع', { act: 'exit' })}
      <div class="rd-titles"><strong id="fvTitle"></strong><span id="fvSub" dir="auto"></span></div>
    </header>`;
  deps.mount(root);
  const scroll = root.querySelector('#fvScroll');
  root.querySelector('#fvTitle').textContent = `فريم من ${ctx.fromName}`;
  root.querySelector('#fvSub').textContent = [frame.series_title || work.title, frame.chapter_label || chapter.name].filter(Boolean).join(' · ');

  const intro = el('section', 'fv-intro');
  const face = ctx.fromAvatar ? Object.assign(el('img', 'fv-face'), { src: ctx.fromAvatar, alt: '' }) : el('span', 'fv-face avatar-letter', [...ctx.fromName][0] ?? '؟');
  const who = el('div', 'fv-who');
  const line = el('p');
  line.append(el('bdi', 'mj-name', ctx.fromName), document.createTextNode(` أرسل ${ctx.toLabel} ${countLabel(stored.length, 'page')}`));
  who.append(face, line);
  intro.append(who);
  if (frame.message) {
    const bubble = el('p', 'mj-quote fv-quote', frame.message);
    bubble.dir = 'auto';
    intro.append(bubble);
  }
  scroll.append(intro);

  const slots = stored.map((page, i) => {
    const slot = el('div', 'rd-page');
    slot.append(el('div', 'skeleton'));
    slot.setAttribute('aria-label', `صفحة ${i + 1} من ${stored.length}`);
    scroll.append(slot);
    return { page, slot };
  });

  const end = el('section', 'rd-end fv-end');
  if (deps.engine?.isAvailable?.()) {
    const full = el('button', 'btn btn-primary');
    full.type = 'button';
    full.innerHTML = `${glyph('book')}<span>اقرأ الفصل كامل</span>`;
    full.onclick = () =>
      deps.readChapter({
        seriesRef: refForTitle(work.title ?? frame.series_title) ?? 'ext:عمل',
        title: frame.series_title || work.title || 'عمل',
        work: null,
        rows: null,
        row: {
          number: chapterNumberOf(chapter) ?? -1,
          chapter,
          sourceId: frame.source_id,
          label: null,
          manga: work,
        },
      });
    end.append(full);
  }
  scroll.append(end);

  let alive = true;
  async function load() {
    if (!deps.engine?.isAvailable?.()) {
      intro.append(el('p', 'fv-note', 'الفريم يفتح داخل تطبيق أندرويد — الصفحات تُجلب من المصدر بمحرّكه.'));
      for (const s of slots) s.slot.remove();
      return;
    }
    let fresh = null;
    try {
      fresh = await deps.engine.pages(frame.source_id, chapter);
    } catch {
      // القائمة تعذّرت: الروابط المحفوظة قد تكفي، وإلا تظهر كل صفحة بسببها
    }
    const pages = resolveFramePages(stored, fresh);
    // بالتتابع: فريمٌ من عشر صفحات لا يستحق ضغط المصدر بطلبات متوازية
    for (let i = 0; i < slots.length && alive; i++) await draw(slots[i], pages[i]);
  }
  async function draw(s, page) {
    try {
      const image = await deps.engine.pageImage(frame.source_id, page);
      const img = new Image();
      img.alt = '';
      img.src = image.src;
      await img.decode().catch(() => {});
      if (img.naturalWidth) s.slot.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      s.slot.replaceChildren(img);
    } catch {
      const box = el('div', 'rd-page-error');
      box.innerHTML = glyph('image');
      box.append(el('span', null, 'الصفحة ما تحمّلت'));
      const retry = el('button', 'btn btn-secondary');
      retry.type = 'button';
      retry.innerHTML = `${glyph('refresh')}<span>أعد</span>`;
      retry.onclick = () => {
        s.slot.replaceChildren(el('div', 'skeleton'));
        void draw(s, page);
      };
      box.append(retry);
      s.slot.classList.add('rd-page--error');
      s.slot.replaceChildren(box);
    }
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="exit"]')) exit();
  });
  function exit() {
    alive = false;
    deps.immersive?.(false);
    deps.exit();
  }
  deps.immersive?.(true);
  void load();
  return {
    handleBack() {
      exit();
      return true;
    },
    destroy() {
      alive = false;
      deps.immersive?.(false);
    },
  };
}
