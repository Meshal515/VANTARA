/** The participant's source adjustment belongs in the existing room sheet. */
export function createVideoOffsetControls({ getOffset, setOffset }) {
  const section = document.createElement('section');
  section.className = 'tg-video-offset'; section.dir = 'rtl';
  section.setAttribute('aria-label', 'مطابقة توقيت مصدر الفيديو');
  const title = document.createElement('h3'); title.textContent = 'إزاحة مصدر الفيديو';
  const value = document.createElement('p'); value.setAttribute('role', 'status'); value.setAttribute('aria-live', 'polite');
  const hint = document.createElement('p'); hint.textContent = 'فرق نسختك فقط · الموجب يقدّم فيديوك · حتى دقيقتين';
  const buttons = document.createElement('div'); buttons.className = 'tg-actions';
  const steps = [-10000, -1000, 1000, 10000];
  for (const step of [...steps, null]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'tg-action';
    button.textContent = step == null ? 'تصفير' : `${step > 0 ? '+' : '−'}${Math.abs(step) / 1000}ث`;
    button.setAttribute('aria-label', step == null ? 'إعادة فرق المصدر إلى الصفر' : `${step > 0 ? 'تقديم' : 'تأخير'} فيديوك ${Math.abs(step) / 1000} ثانية`);
    button.onclick = () => { setOffset(step == null ? 0 : getOffset() + step); section.refresh(); };
    buttons.append(button);
  }
  section.refresh = () => {
    const offset = getOffset();
    value.textContent = `فرق المصدر: ${offset > 0 ? '+' : ''}${offset / 1000} ثانية`;
    [...buttons.children].forEach((button, index) => { button.disabled = index < 4 && Math.abs(offset + steps[index]) > 120000; });
  };
  section.append(title, value, hint, buttons); section.refresh(); return section;
}
