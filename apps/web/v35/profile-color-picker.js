import { hexToHsv, hsvToHex } from './profile-color.js';
import { normalizeColor } from './profile-theme.js';

/** A native-app looking picker, entirely within the profile editor. */
export function createProfileColorPicker(host, { label, value, onChange, onValidity }) {
  const root = document.createElement('div');
  root.className = 'pc-picker';
  root.innerHTML = `
    <div class="pc-sv" role="slider" tabindex="0" aria-label="${label}: التشبع والإضاءة" aria-valuemin="0" aria-valuemax="100"><i class="pc-thumb"></i></div>
    <label class="pc-hue-label"><span>درجة اللون</span><input class="pc-hue" type="range" min="0" max="359" step="1" aria-label="درجة ${label}"></label>
    <div class="pc-chosen"><span class="pc-chip"></span><span class="pc-value" dir="ltr"></span><span>اللون المختار</span></div>
    <div class="pc-swatches" role="group" aria-label="ألوان مقترحة لـ${label}"></div>
    <details class="pc-code"><summary>كود اللون <span dir="ltr">HEX</span></summary><label><span class="sr-only">كود ${label}</span><input class="pc-hex" type="text" dir="ltr" maxlength="7" autocomplete="off" spellcheck="false" aria-label="كود ${label}"></label><p class="pc-error" role="status" hidden>اكتب 6 خانات، مثل #8F5CFF</p></details>`;
  host.append(root);
  const panel = root.querySelector('.pc-sv'), hue = root.querySelector('.pc-hue'), hex = root.querySelector('.pc-hex');
  const error = root.querySelector('.pc-error');
  let current = normalizeColor(value) || '#08070c';
  let [h, s, v] = hexToHsv(current);
  let invalid = false;
  let disabled = false;
  let pointer = null;
  function paint() {
    root.style.setProperty('--pc-hue', hsvToHex(h, 1, 1));
    root.style.setProperty('--pc-color', current);
    panel.querySelector('.pc-thumb').style.cssText = `left:${s * 100}%;top:${(1 - v) * 100}%`;
    panel.setAttribute('aria-valuenow', String(Math.round(s * 100)));
    panel.setAttribute('aria-valuetext', `تشبع ${Math.round(s * 100)}٪، إضاءة ${Math.round(v * 100)}٪، ${current}`);
    hue.value = String(Math.round(h));
    if (!invalid) hex.value = current.toUpperCase();
    root.querySelector('.pc-value').textContent = current.toUpperCase();
    for (const button of root.querySelectorAll('.pc-swatch')) button.setAttribute('aria-pressed', String(button.dataset.color === current));
  }
  function clearError() {
    invalid = false; error.hidden = true; hex.setAttribute('aria-invalid', 'false'); paint();
  }
  function commit(next) {
    if (disabled) return;
    current = next;
    clearError();
    onChange(current);
  }
  const choosePoint = (event) => {
    const rect = panel.getBoundingClientRect();
    s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    v = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    commit(hsvToHex(h, s, v));
  };
  panel.onpointerdown = (event) => {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); panel.focus({ preventScroll: true });
    pointer = event.pointerId; panel.setPointerCapture(pointer); choosePoint(event);
  };
  panel.onpointermove = (event) => { if (event.pointerId === pointer && !disabled) choosePoint(event); };
  panel.onpointerup = panel.onpointercancel = () => { pointer = null; };
  panel.onkeydown = (event) => {
    if (disabled || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? .1 : .01;
    if (event.key === 'ArrowLeft') s -= step;
    if (event.key === 'ArrowRight') s += step;
    if (event.key === 'ArrowUp') v += step;
    if (event.key === 'ArrowDown') v -= step;
    if (event.key === 'Home') s = 0;
    if (event.key === 'End') s = 1;
    s = Math.min(1, Math.max(0, s)); v = Math.min(1, Math.max(0, v));
    commit(hsvToHex(h, s, v));
  };
  hue.oninput = () => { h = Number(hue.value); commit(hsvToHex(h, s, v)); };
  hex.oninput = () => {
    const text = hex.value.trim();
    const color = normalizeColor(text.startsWith('#') ? text : `#${text}`);
    invalid = !color; error.hidden = !invalid; hex.setAttribute('aria-invalid', String(invalid));
    if (color) { [h, s, v] = hexToHsv(color); commit(color); }
    else onValidity();
  };
  root.querySelector('.pc-code').ontoggle = (event) => { if (!event.target.open && invalid) { clearError(); onValidity(); } };
  for (const color of ['#08070c','#201234','#0c1830','#14332d','#7d1f12','#f2e5d4','#ffffff']) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'pc-swatch'; button.dataset.color = color;
    button.style.setProperty('--swatch', color); button.setAttribute('aria-label', `اختر ${color}`);
    button.onclick = () => { [h, s, v] = hexToHsv(color); commit(color); };
    root.querySelector('.pc-swatches').append(button);
  }
  paint();
  return {
    element: root,
    invalid: () => invalid,
    clearError,
    setValue(color) {
      if (color !== current) { current = color; [h, s, v] = hexToHsv(color); }
      paint();
    },
    setDisabled(value) {
      disabled = value; panel.tabIndex = value ? -1 : 0; panel.setAttribute('aria-disabled', String(value));
      root.querySelectorAll('input,button').forEach((node) => { node.disabled = value; });
    },
    destroy() { panel.onpointerdown = panel.onpointermove = panel.onpointerup = panel.onpointercancel = panel.onkeydown = null; hue.oninput = hex.oninput = null; root.querySelector('.pc-code').ontoggle = null; pointer = null; },
  };
}
