/**
 * تكوينات أعلى صفحة عمل الأنمي (معاينة Debug للمقارنة قبل اعتماد واحد).
 *
 * القطع نفسها في كل تكوين — الشعار، سطر المعلومات، الأنواع، الغلاف، زر المشاهدة،
 * وموعد الحلقة القادمة — والتكوين يقرر أين تقع كل قطعة فقط. لا تُبنى الصفحة خمس
 * مرات، ولا تُنسخ بيانات. التكوين «0» هو التصميم المعتمد ويبقى الافتراضي خارج المعاينة.
 *
 * العمق (3D) لكل تكوين يُضبط بمتغيرات CSS على `.aw[data-layout]` (anime.css):
 * سرعة الخلفية وتكبيرها، وميل الغلاف وصعوده، وميل الشعار.
 */

export const LAYOUTS = [
  { id: '0', name: 'الحالي', why: 'التصميم المعتمد اليوم.' },
  { id: '1', name: 'المركزي', why: 'الغلاف هوية العمل في الوسط عند حافة البنر، واللوقو تحته؛ عين واحدة تقرأ من الأعلى للأسفل ثم تصل للزر.' },
  { id: '2', name: 'المتوازن', why: 'الغلاف في الوسط، هوية العمل يمينه وما يخص المشاهدة يساره؛ قرار المشاهدة بجانب الصورة لا تحتها.' },
  { id: '3', name: 'الجانبي', why: 'الغلاف يمين البنر، واللوقو والمعلومات وشريط المشاهدة بجانبه؛ كل ما يلزم في نظرة أفقية واحدة وأقصر صفحة قبل الحلقات.' },
  { id: '4', name: 'السينمائي', why: 'البنر هو المشهد واللوقو في منطقته الهادئة والزر فوقه؛ الغلاف صغير يعرّف بالعمل حين تبدأ التفاصيل.' },
  { id: '5', name: 'الحلقة أولًا', why: 'ما جئت لأجله في الأعلى: لقطة الحلقة التي ستشاهدها هي الزر نفسه، وهوية العمل سطر مضغوط فوقها.' },
];

const KEY = 'vantara.anime.heroLayout';
const LAB_KEY = 'vantara.anime.heroLab';
const read = (k) => { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } };
const write = (k, v) => { try { globalThis.localStorage?.setItem(k, v); } catch { /* تخزين محجوب: يبقى للجلسة */ } };

let debugChannel = false;
/** المعاينة لنسخة Debug فقط (أو بتفعيل يدوي في المتصفح للتطوير). */
export const labEnabled = () => debugChannel || read(LAB_KEY) === '1';
export function detectDebugChannel(deviceInfo) {
  return Promise.resolve()
    .then(() => deviceInfo?.())
    .then((d) => { debugChannel = d?.channel === 'debug'; return debugChannel; })
    .catch(() => false);
}
export const currentLayout = () => {
  if (!labEnabled()) return '0';
  const saved = read(KEY);
  return LAYOUTS.some((l) => l.id === saved) ? saved : '0';
};

const box = (cls, ...kids) => {
  const d = document.createElement('div');
  d.className = cls;
  d.append(...kids.filter(Boolean));
  return d;
};

/**
 * يضع القطع في أماكنها حسب التكوين. `v` عناصر الصفحة من buildWork:
 * hero/head (داخل البنر)، stage (بين البنر والجسم)، body/cta، والقطع mark/meta/genres/cover/side.
 */
export function placePieces(v, id) {
  const { head, stage, mark, meta, genres, cover, side, cta, body, still } = v;
  // كل قطعة تعود لمكانها الأصلي أولًا ثم تُرتب؛ لا شيء يُنسخ
  head.replaceChildren();
  stage.replaceChildren();
  still?.remove();
  switch (id) {
    case '1':
      stage.append(cover, mark, meta, genres, side);
      body.prepend(cta);
      break;
    case '2':
      stage.append(box('aw-col aw-col--ident', mark, meta, genres), cover, box('aw-col aw-col--watch', side, cta));
      break;
    case '3':
      stage.append(cover, box('aw-col', mark, meta, genres, side));
      body.prepend(cta);
      break;
    case '4':
      head.append(mark, cta);
      stage.append(cover, box('aw-col', meta, genres, side));
      break;
    case '5':
      stage.append(box('aw-ident-row', cover, box('aw-col', mark, meta, genres)), still, side, cta);
      break;
    default:
      head.append(mark, meta, genres);
      body.prepend(cta);
  }
  v.wrap.dataset.layout = id;
  v.layout = id;
}

/** شريط التبديل بين التكوينات، داخل الصفحة نفسها حتى يختفي معها. */
export function mountSwitcher(v, onChange) {
  if (!labEnabled()) return null;
  const bar = box('aw-lab');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'تكوينات صفحة العمل');
  const label = box('aw-lab-why');
  const paint = () => {
    for (const b of bar.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.id === v.layout));
    const l = LAYOUTS.find((x) => x.id === v.layout);
    label.textContent = l ? `${l.name} — ${l.why}` : '';
  };
  const row = box('aw-lab-row');
  for (const l of LAYOUTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = l.id;
    b.setAttribute('role', 'tab');
    b.textContent = l.id === '0' ? 'الحالي' : l.id;
    b.title = l.name;
    b.onclick = () => {
      write(KEY, l.id);
      onChange(l.id);
      paint();
    };
    row.append(b);
  }
  bar.append(label, row);
  paint();
  v.wrap.append(bar);
  return bar;
}
