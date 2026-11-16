/**
 * إدارة المساحة: كم يأخذ VANTARA من الجوال، مقسومًا بفئات بأسمائها وأحجامها وما يحدث لو حُذفت كل واحدة.
 * لا يُحذف شيء إلا ما تختاره بعد أن ترى اسمه وحجمه وأثره، والكاش وحده محدد مسبقًا. التحميلات والإضافات تُعرض
 * بحجمها وتُدار من أماكنها (لا تُحذف من هنا بالخطأ).
 *
 * الأرقام من المحرك الأصلي (`VantaraStorage.report`)، وفصول المانجا المحمّلة من مخزن التنزيلات نفسه.
 */

import { glyph } from './icons.js';
import { formatBytes } from '../lib/downloads/units.js';

/** الجسر الأصلي، أو null (الويب وويندوز: المتصفح يقدّر المساحة وحده). */
export function storagePlugin(g = globalThis) {
  return g?.Capacitor?.Plugins?.VantaraStorage ?? null;
}

/** ما يُحدَّد مسبقًا: الكاش وحده، غير الفارغ، وغير المشغول بمشغّل مفتوح. */
export function preselected(kinds) {
  return new Set((kinds ?? []).filter((k) => k.cache && k.deletable && !k.busy && k.bytes > 0).map((k) => k.id));
}

/** مجموع ما سيُحذف من المحدد. */
export function selectedBytes(kinds, ids) {
  return (kinds ?? []).filter((k) => ids.has(k.id) && k.deletable).reduce((n, k) => n + (Number(k.bytes) || 0), 0);
}

/**
 * @param {{ el: Function, openSheet: Function, closeSheet: Function, toast: Function,
 *   mangaBytes?: () => Promise<number>, openDownloads?: () => void }} deps
 */
export function createStorageView(deps) {
  const { el, openSheet, closeSheet, toast } = deps;
  const ltr = (text, cls) => {
    const s = el('span', cls ?? null, text);
    s.dir = 'ltr';
    return s;
  };

  async function load() {
    const plugin = storagePlugin();
    const manga = await Promise.resolve(deps.mangaBytes?.()).catch(() => 0) ?? 0;
    if (!plugin) {
      let usage = null;
      let quota = null;
      try {
        const est = await navigator.storage?.estimate?.();
        usage = est?.usage ?? null;
        quota = est?.quota ?? null;
      } catch { /* تقدير اختياري */ }
      return { native: false, deviceTotal: quota, deviceFree: quota != null && usage != null ? quota - usage : null, appTotal: usage, kinds: [], manga };
    }
    const r = await plugin.report();
    return { native: true, ...r, kinds: r.kinds ?? [], manga };
  }

  async function open() {
    let data;
    try {
      data = await load();
    } catch (e) {
      return toast(`تعذّر قراءة المساحة: ${e?.message ?? e}`);
    }
    const ids = preselected(data.kinds);
    openSheet((body) => {
      body.classList.add('st-sheet');
      body.append(el('h3', null, 'إدارة المساحة'));
      body.append(deviceBar(data));
      const list = el('div', 'st-list');
      const footer = el('div', 'st-footer');
      const summary = el('p', 'st-summary');
      const go = el('button', 'btn btn-danger st-go');
      go.type = 'button';
      let armed = false;
      const paint = () => {
        const bytes = selectedBytes(data.kinds, ids);
        const names = data.kinds.filter((k) => ids.has(k.id)).map((k) => k.label);
        summary.replaceChildren();
        if (names.length) {
          summary.append(el('span', null, 'سيُحذف: '), el('b', null, names.join('، ')));
          if (bytes > 0) summary.append(el('span', null, ' — يتحرر '), ltr(formatBytes(bytes)));
        } else summary.append(el('span', null, 'اختر ما تريد حذفه. لا يُحذف شيء دون اختيارك.'));
        armed = false;
        go.disabled = !names.length;
        go.replaceChildren(el('span', null, 'احذف المحدد'));
        if (names.length && bytes > 0) go.append(el('span', null, ' · '), ltr(formatBytes(bytes)));
      };
      for (const k of data.kinds.filter((x) => x.deletable)) list.append(kindRow(k, ids, paint));
      // ما يُدار من مكانه: يُعرض حجمه ليعرف المستخدم أين ذهبت المساحة
      const managed = el('div', 'st-managed');
      managed.append(el('h4', null, 'يُدار من مكانه'));
      if (data.manga > 0) managed.append(infoRow('فصول المانجا المحمّلة', data.manga, 'من «التحميلات» ← «على الجهاز»', deps.openDownloads));
      for (const k of data.kinds.filter((x) => !x.deletable && x.bytes > 0)) managed.append(infoRow(k.label, k.bytes, k.effect, k.id === 'videoDownloads' ? deps.openDownloads : null));
      if (data.other > 0) managed.append(infoRow('بيانات التطبيق', data.other, 'حسابك ومكتبتك وإعداداتك وواجهة التطبيق. لا تُحذف من هنا.'));
      go.onclick = async () => {
        // ضغطتان: الأولى تعرض ما سيُحذف في الزر نفسه، والثانية تحذف
        if (!armed) {
          armed = true;
          go.replaceChildren(el('span', null, `اضغط مرة ثانية لتأكيد حذف ${ids.size === 1 ? 'فئة واحدة' : `${ids.size} فئات`}`));
          return;
        }
        go.disabled = true;
        try {
          const r = await storagePlugin()?.clear({ ids: [...ids] });
          const freed = formatBytes(r?.freed ?? 0);
          const skipped = (r?.skipped ?? []).map((s) => s.reason).filter(Boolean);
          closeSheet();
          toast(skipped.length ? `${freed ? `تحرر ${freed}. ` : ''}${skipped[0]}` : freed ? `تحرر ${freed}` : 'حُذف');
        } catch (e) {
          go.disabled = false;
          toast(`تعذّر الحذف: ${e?.message ?? e}`);
        }
      };
      footer.append(summary, go);
      if (data.native) body.append(list);
      body.append(managed);
      if (data.native) body.append(footer);
      else body.append(el('p', 'st-note', 'تفاصيل المساحة وحذف الكاش في تطبيق Android.'));
      paint();
    });
  }

  function deviceBar(data) {
    const box = el('div', 'st-device');
    const total = Number(data.deviceTotal) || 0;
    const free = Number(data.deviceFree) || 0;
    const app = Number(data.appTotal) || 0;
    const bar = el('div', 'st-bar');
    bar.setAttribute('role', 'img');
    if (total > 0) {
      const used = Math.max(0, total - free - app);
      const seg = (cls, v) => { const i = el('i', cls); i.style.flexGrow = String(Math.max(v, 0)); return i; };
      bar.append(seg('st-bar-app', app), seg('st-bar-other', used), seg('st-bar-free', free));
      bar.setAttribute('aria-label', `VANTARA ${formatBytes(app)}، متاح ${formatBytes(free)} من ${formatBytes(total)}`);
    }
    const legend = el('div', 'st-legend');
    const item = (cls, label, v) => {
      const p = el('p', `st-legend-item ${cls}`);
      p.append(el('i'), el('span', null, label), ltr(formatBytes(v) ?? '—'));
      return p;
    };
    legend.append(item('st-bar-app', 'VANTARA', app));
    if (total > 0) legend.append(item('st-bar-other', 'تطبيقات وملفات أخرى', Math.max(0, total - free - app)), item('st-bar-free', 'متاح', free));
    box.append(bar, legend);
    return box;
  }

  function kindRow(k, ids, paint) {
    const row = el('label', `st-row${k.busy ? ' is-busy' : ''}`);
    const box = el('input');
    box.type = 'checkbox';
    box.checked = ids.has(k.id);
    box.disabled = Boolean(k.busy) || !(k.bytes > 0);
    box.onchange = () => {
      if (box.checked) ids.add(k.id); else ids.delete(k.id);
      paint();
    };
    const text = el('div', 'st-row-text');
    const head = el('div', 'st-row-head');
    head.append(el('b', null, k.label), ltr(formatBytes(k.bytes) ?? '0 B', 'st-size'));
    text.append(head, el('span', 'st-effect', k.busy ? 'المشغّل مفتوح الآن؛ أغلقه ثم احذف.' : k.effect));
    row.append(box, text);
    return row;
  }

  function infoRow(label, bytes, effect, go) {
    const row = el(go ? 'button' : 'div', 'st-row st-row--info');
    if (go) {
      row.type = 'button';
      row.onclick = () => { closeSheet(); go(); };
    }
    const text = el('div', 'st-row-text');
    const head = el('div', 'st-row-head');
    head.append(el('b', null, label), ltr(formatBytes(bytes) ?? '0 B', 'st-size'));
    text.append(head, el('span', 'st-effect', effect));
    row.append(text);
    if (go) {
      const arrow = el('span', 'st-go-arrow');
      arrow.innerHTML = glyph('chevron', { size: 18 });
      row.append(arrow);
    }
    return row;
  }

  return { open };
}
