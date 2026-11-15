/**
 * طابور التنزيلات الدائم: عنصر واحد = ملف واحد، والتوازي عدد العناصر لا عدد الاتصالات.
 *
 * - «التحميل المتوازي» 1..4 (افتراضي 2): ما زاد ينتظر ويبدأ تلقائيًا حين تفرغ خانة.
 *   اتصالات الملف الواحد يقررها محرك المنصة حسب المصدر، لا تظهر للمستخدم.
 * - الحالة تُحفظ عند كل انتقال، والتقدّم كل ثانيتين: إغلاق التطبيق لا يضيع ما نُزّل.
 *   عند الفتح يعود ما كان نشطًا إلى الانتظار ويُستأنف من آخر بيانات صحيحة.
 * - الإيقاف المؤقت يحفظ الجزئي، الإلغاء يحذف الجزئي ويُخرج العنصر، الحذف يحذف الملف المحفوظ.
 *   أربع عمليات لا تختلط.
 * - انقطاع الشبكة: «يعيد الاتصال» بمحاولات متباعدة على المصدر نفسه، لا انتقال لمصدر آخر.
 * - المستمعون يُبلَّغون بالعنصر الذي تغيّر وحده: الواجهة تحدّث صفّه لا القائمة كلها.
 */

import { ACTIVE_STATES, DownloadError, STATES, createItem, queueSummary } from './model.js';
import { createRateMeter } from './units.js';

export const PARALLEL_CHOICES = [1, 2, 3, 4];
export const DEFAULT_PARALLEL = 2;
const PROGRESS_SAVE_MS = 2000;
const RETRY_DELAYS_MS = [2000, 8000, 20000];

const clampParallel = (n) => (PARALLEL_CHOICES.includes(Number(n)) ? Number(n) : DEFAULT_PARALLEL);

/**
 * @param {{
 *   store: ReturnType<import('./store.js').memoryStore>,
 *   drivers: Record<string, { run: Function, remove?: Function, cancel?: Function }>,
 *   settings?: { parallel?: number, wifiOnly?: boolean },
 *   saveSettings?: (s: object) => void,
 *   network?: { metered: () => boolean, online: () => boolean, onChange?: (fn: Function) => Function },
 *   now?: () => number,
 *   timers?: { setTimeout: Function, clearTimeout: Function },
 *   notify?: (event: object) => void,
 * }} deps
 */
export function createDownloadManager(deps) {
  const { store, drivers } = deps;
  const now = deps.now ?? (() => Date.now());
  const timers = deps.timers ?? { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) };
  const network = deps.network ?? { metered: () => false, online: () => true };
  const settings = { parallel: clampParallel(deps.settings?.parallel), wifiOnly: Boolean(deps.settings?.wifiOnly) };
  const items = new Map();
  const running = new Map(); // id -> { controller, meter, savedAt, promise }
  const retryTimers = new Map();
  const listeners = new Set();
  let order = 0;
  let pumping = false;

  const emit = (event) => {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch {
        /* مستمع معطوب لا يوقف الطابور */
      }
    }
  };

  const persist = (item) => store.putItem(item).catch(() => {});

  function patch(id, change, { save = true, type = 'change' } = {}) {
    const item = items.get(id);
    if (!item) return null;
    Object.assign(item, change, { updatedAt: now() });
    if (save) void persist(item);
    emit({ type, id, item });
    return item;
  }

  const ready = (async () => {
    const saved = (await store.allItems().catch(() => [])) ?? [];
    for (const item of saved) {
      if (!item?.id) continue;
      // ما كان يعمل لحظة الإغلاق يعود للانتظار ويُستأنف من الجزئي المحفوظ
      if (ACTIVE_STATES.has(item.state)) {
        item.state = STATES.queued;
        item.speed = 0;
      }
      items.set(item.id, item);
      order = Math.max(order, Number(item.order) || 0);
    }
    emit({ type: 'list' });
    pump();
  })();

  const unlistenNetwork = network.onChange?.(() => pump());

  function canRunNow() {
    if (!network.online()) return false;
    if (settings.wifiOnly && network.metered()) return false;
    return true;
  }

  /** يملأ خانات التوازي من رأس الطابور. */
  function pump() {
    if (pumping) return;
    pumping = true;
    try {
      const queue = [...items.values()]
        .filter((i) => i.state === STATES.queued || i.state === STATES.waitingWifi)
        .sort((a, b) => a.order - b.order);
      if (!canRunNow()) {
        // بلا Wi-Fi والإعداد يطلبه: يُقال ذلك صراحة بدل «في الانتظار» بلا سبب
        if (settings.wifiOnly && network.online() && network.metered()) {
          for (const i of queue) if (i.state !== STATES.waitingWifi) patch(i.id, { state: STATES.waitingWifi });
        }
        return;
      }
      let free = settings.parallel - running.size;
      for (const i of queue) {
        if (free <= 0) {
          if (i.state === STATES.waitingWifi) patch(i.id, { state: STATES.queued });
          continue;
        }
        free--;
        start(i);
      }
    } finally {
      pumping = false;
    }
  }

  function start(item) {
    const driver = drivers[item.kind === 'manga' ? 'manga' : 'video'];
    if (!driver?.run) {
      patch(item.id, { state: STATES.failed, error: { code: 'UNSUPPORTED', message: 'هذا الجهاز لا ينزّل هذا النوع' } });
      return;
    }
    const controller = new AbortController();
    const meter = createRateMeter();
    const slot = { controller, meter, savedAt: 0, promise: null };
    running.set(item.id, slot);
    patch(item.id, { state: STATES.resolving, error: null, startedAt: item.startedAt ?? now(), attempts: (item.attempts ?? 0) + 1 });
    const ctl = {
      signal: controller.signal,
      /** تحديث تقدّم: بايتات وإجمالي وصفحات. السرعة تُحسب هنا لا في المحرك، فتتوحد بين المنصات. */
      progress(change) {
        const cur = items.get(item.id);
        if (!cur || controller.signal.aborted) return;
        const bytes = change.bytes ?? cur.bytes;
        const at = now();
        const rate = change.bytes != null ? meter.sample(at, bytes) : meter.rate();
        const next = { ...change, speed: rate, stable: meter.stable() };
        if (cur.state !== STATES.downloading && cur.state !== STATES.verifying) {
          next.state = STATES.downloading;
          // نقلٌ بدأ فعلًا: انقطاع لاحق يستحق محاولاته كاملة
          next.attempts = 1;
        }
        const save = at - slot.savedAt >= PROGRESS_SAVE_MS;
        if (save) slot.savedAt = at;
        patch(item.id, next, { save, type: next.state ? 'change' : 'progress' });
      },
      /** حالة وسطى يعلنها المحرك: يعيد الاتصال، يتحقق، أو وصف المصدر الذي اختاره. */
      update(change) {
        if (controller.signal.aborted) return;
        if (change.state === STATES.reconnecting || change.state === STATES.verifying) meter.reset();
        patch(item.id, { ...change, ...(change.state && change.state !== STATES.downloading ? { speed: 0 } : {}) });
      },
    };
    slot.promise = Promise.resolve()
      .then(() => driver.run(items.get(item.id), ctl))
      .then(
        (result) => finish(item.id, slot, null, result),
        (error) => finish(item.id, slot, error, null),
      );
  }

  function finish(id, slot, error, result) {
    if (running.get(id) !== slot) return;
    running.delete(id);
    const reason = slot.controller.signal.reason;
    const cur = items.get(id);
    if (!cur) {
      pump();
      return;
    }
    if (slot.controller.signal.aborted) {
      // الإيقاف/الإلغاء/الحذف قرّروا الحالة بأنفسهم؛ لا يكتب فوقها فشل الإجهاض
      if (reason === 'pause') patch(id, { state: STATES.paused, speed: 0 });
      else if (reason === 'requeue') patch(id, { state: STATES.queued, speed: 0 });
      pump();
      return;
    }
    if (!error) {
      patch(id, {
        ...(result ?? {}),
        state: STATES.ready,
        speed: 0,
        error: null,
        attempts: 0,
        finishedAt: now(),
      });
      emit({ type: 'completed', id, item: items.get(id) });
      pump();
      return;
    }
    const code = error instanceof DownloadError ? error.code : error?.code ?? 'UNKNOWN';
    const message = String(error?.message ?? error ?? '');
    if (code === 'NO_SPACE') {
      patch(id, { state: STATES.noSpace, speed: 0, error: { code, message } });
      pump();
      return;
    }
    const retryable = error?.retryable || code === 'NETWORK';
    const attempt = cur.attempts ?? 1;
    if (retryable && attempt <= RETRY_DELAYS_MS.length) {
      // نفس المصدر بعد مهلة متزايدة؛ الخانة تفرغ لغيره أثناء الانتظار
      patch(id, { state: STATES.reconnecting, speed: 0, error: { code, message } });
      const t = timers.setTimeout(() => {
        retryTimers.delete(id);
        const again = items.get(id);
        if (again?.state === STATES.reconnecting) {
          patch(id, { state: STATES.queued });
          pump();
        }
      }, RETRY_DELAYS_MS[attempt - 1]);
      retryTimers.set(id, t);
      pump();
      return;
    }
    patch(id, { state: STATES.failed, speed: 0, error: { code, message } });
    pump();
  }

  function stopRunning(id, reason) {
    const slot = running.get(id);
    if (slot) slot.controller.abort(reason);
    const t = retryTimers.get(id);
    if (t) {
      timers.clearTimeout(t);
      retryTimers.delete(id);
    }
    return slot;
  }

  const driverOf = (item) => drivers[item.kind === 'manga' ? 'manga' : 'video'];

  const api = {
    ready,
    settings: () => ({ ...settings }),
    list: () => [...items.values()].sort((a, b) => a.order - b.order),
    get: (id) => items.get(id) ?? null,
    byKey: (key) => [...items.values()].find((i) => i.key === key) ?? null,
    summary: () => queueSummary(items.values()),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /**
     * يضيف عناصر للطابور. الموجود مسبقًا (نفس العمل ونفس الفصل/الحلقة) لا يتكرر:
     * الجاهز يبقى كما هو، والفاشل يُعاد، والجاري يبقى في مكانه.
     */
    async enqueue(specs) {
      await ready;
      const added = [];
      const skipped = [];
      for (const spec of specs ?? []) {
        let item;
        try {
          item = createItem(spec, { now: now(), order: ++order });
        } catch (error) {
          skipped.push({ spec, reason: error.message });
          continue;
        }
        const existing = items.get(item.id);
        if (existing) {
          if (existing.state === STATES.failed || existing.state === STATES.noSpace) {
            patch(existing.id, { state: STATES.queued, error: null, attempts: 0, source: item.source, request: item.request });
            added.push(existing);
          } else skipped.push({ spec, reason: existing.state === STATES.ready ? 'على الجهاز' : 'في الطابور', item: existing });
          continue;
        }
        items.set(item.id, item);
        await persist(item);
        added.push(item);
      }
      if (added.length) emit({ type: 'list' });
      pump();
      return { added, skipped };
    },

    pause(id) {
      const item = items.get(id);
      if (!item || item.state === STATES.ready) return;
      if (!stopRunning(id, 'pause')) patch(id, { state: STATES.paused, speed: 0 });
    },

    resume(id) {
      const item = items.get(id);
      if (!item || ![STATES.paused, STATES.failed, STATES.noSpace, STATES.reconnecting].includes(item.state)) return;
      stopRunning(id, 'requeue');
      patch(id, { state: STATES.queued, error: null, attempts: 0 });
      pump();
    },

    retry(id) {
      api.resume(id);
    },

    pauseAll() {
      for (const item of items.values()) if (item.state !== STATES.ready && item.state !== STATES.paused) api.pause(item.id);
    },

    resumeAll() {
      for (const item of [...items.values()].sort((a, b) => a.order - b.order)) {
        if (item.state === STATES.paused) patch(item.id, { state: STATES.queued });
      }
      pump();
    },

    /**
     * إلغاء تنزيل لم يكتمل: يوقفه، يحذف بياناته الجزئية، ويخرجه من الطابور.
     * لا يمس عنصرًا جاهزًا على الجهاز (ذاك «حذف»).
     */
    async cancel(id) {
      const item = items.get(id);
      if (!item || item.state === STATES.ready) return false;
      const slot = stopRunning(id, 'cancel');
      if (slot) await slot.promise?.catch(() => {});
      await driverOf(item)?.remove?.(item).catch?.(() => {});
      items.delete(id);
      await store.deleteItem(id).catch(() => {});
      emit({ type: 'removed', id, item });
      emit({ type: 'list' });
      pump();
      return true;
    },

    /** حذف ما على الجهاز (بعد تأكيد الواجهة): الملف ووصفه. يرجع البايتات المحررة. */
    async remove(ids) {
      let freed = 0;
      for (const id of [].concat(ids)) {
        const item = items.get(id);
        if (!item) continue;
        const slot = stopRunning(id, 'cancel');
        if (slot) await slot.promise?.catch(() => {});
        freed += Number(item.storage?.bytes ?? item.bytes ?? 0) || 0;
        await driverOf(item)?.remove?.(item).catch?.(() => {});
        items.delete(id);
        await store.deleteItem(id).catch(() => {});
        emit({ type: 'removed', id, item });
      }
      emit({ type: 'list' });
      pump();
      return freed;
    },

    setParallel(n) {
      settings.parallel = clampParallel(n);
      deps.saveSettings?.({ ...settings });
      // التقليل لا يقطع الجاري: ما زاد يكمل، والخانات الجديدة تُملأ بعده
      pump();
      emit({ type: 'settings', settings: { ...settings } });
    },

    setWifiOnly(on) {
      settings.wifiOnly = Boolean(on);
      deps.saveSettings?.({ ...settings });
      if (settings.wifiOnly && network.metered()) {
        for (const [id] of running) {
          stopRunning(id, 'requeue');
        }
      }
      pump();
      emit({ type: 'settings', settings: { ...settings } });
    },

    /** أعد فحص الطابور (عاد الاتصال، تغيرت الشبكة، عاد التطبيق للواجهة). */
    pump,

    destroy() {
      unlistenNetwork?.();
      for (const [id] of running) stopRunning(id, 'requeue');
      listeners.clear();
    },
  };
  return api;
}
