/**
 * تنزيل حلقة أو فيلم: الرابط من محرك التشغيل نفسه، والملف من محرك المنصة الأصلي.
 *
 * التسلسل: تجهيز الحلقة (`engine.prepare`) ← انتظار السيرفرات حتى تستقر ← اختيار السيرفر
 * (ذكي أو يدوي) ← `engine.pick` يعطي المرشّح ← فحص المحرك الأصلي (الحاوية، الحجم، الاستئناف،
 * الحماية) ← بدء النقل في خدمة أمامية تعيش خارج الـWebView.
 *
 * قواعد ثابتة:
 *   - اليدوي يُلتزم به: سيرفر اختاره المستخدم ولم يصلح ⇒ فشل بسببه، لا بديل صامت.
 *   - بعد أن يبدأ النقل يُقفل المصدر والسيرفر على العنصر؛ الاستئناف (حتى بعد إعادة تشغيل التطبيق
 *     أو انتهاء صلاحية الرابط) يعيد حلّ السيرفر نفسه، فلا تُخلط بايتات مصدرين في ملف واحد.
 *   - الرابط المنتهي يُجدَّد من السيرفر نفسه ويُكمل من آخر بايت صحيح.
 *   - لا محاولة لتجاوز حماية DRM أو صلاحيات المصدر: المحمي يُرفض بسببه.
 */

import { DownloadError } from './model.js';
import { isDownloadReady, rankRoutes, unsupportedReason } from './smart.js';

const SETTLE_MS = 60_000;
const SMART_TRIES = 4;
const MAX_RENEWALS = 3;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('aborted'));
    }, { once: true });
  });
}

/** نفس السيرفر: المصدر نفسه، واسم السيرفر أو رمزه. */
export function sameRoute(route, source) {
  if (!route || !source?.sourceId || route.sourceId !== source.sourceId) return false;
  if (source.routeCode && route.code) return route.code === source.routeCode;
  if (source.server) return route.server === source.server;
  return true;
}

/**
 * يجهّز الحلقة وينتظر السيرفرات: يرجع حين ينتهي التجهيز، أو حين يجهز ما يكفي للاختيار
 * (اليدوي: سيرفره وحده؛ الذكي: كل ما يُجهَّز انتهى أو مرّت المهلة).
 */
export async function resolveRoutes(engine, request, { signal, wanted = null, settleMs = SETTLE_MS, onRoutes = null } = {}) {
  const out = await engine.prepare({ copies: request.copies ?? [], identity: request.identity ?? null, episode: request.episode, pinned: Boolean(request.pinned), probe: true, signal });
  if (!out?.session) throw new DownloadError('NO_ROUTE', 'لم تبدأ جلسة تجهيز السيرفرات', { retryable: true });
  const session = out.session;
  let routes = out.routes ?? [];
  let done = Boolean(out.done);
  const off = engine.on?.('route', (e) => {
    if (e?.session === session && e.route) routes = engine.upsertRoute ? engine.upsertRoute(routes, e.route) : [...routes.filter((r) => r.id !== e.route.id), e.route];
  });
  const offDone = engine.on?.('prepared', (e) => {
    if (e?.session === session) done = true;
  });
  const until = Date.now() + settleMs;
  // ورقة «اختر السيرفر» تعرض كل سيرفر لحظة جاهزيته، لا بعد أن يستقر آخر مصدر
  const report = () => { try { onRoutes?.(routes); } catch { /* عرض فقط */ } };
  try {
    report();
    while (!signal?.aborted) {
      const pending = (r) => r.state === 'RESOLVING' || r.state === 'CHECKING';
      // يدوي/مقفل: يكفي أن تستقر سيرفرات ذلك المصدر وحده، لا ننتظر بقية المصادر
      const mine = wanted ? routes.filter((r) => wanted(r)) : [];
      if (wanted && mine.length && !mine.some(pending)) break;
      const checking = routes.some(pending);
      if (done && !checking) break;
      if (Date.now() >= until) break;
      await sleep(700, signal);
      try {
        const snap = await engine.routes(session, { signal });
        for (const r of snap?.routes ?? []) routes = engine.upsertRoute ? engine.upsertRoute(routes, r) : routes;
        done = done || Boolean(snap?.done);
      } catch {
        /* لقطة فاشلة لا تُسقط ما وصل بالأحداث */
      }
      report();
    }
  } finally {
    off?.();
    offDone?.();
  }
  return { session, routes };
}

/**
 * @param {{ engine: () => object, native: () => object|null, platform: () => ({ torrent: boolean }) }} deps
 */
export function createVideoDriver(deps) {
  /** يختار السيرفر والمرشّح: يرجع { route, candidate, info } أو يرمي بسبب واضح. */
  async function choose(engine, native, item, session, routes, signal) {
    const locked = item.source?.locked;
    const manual = item.source?.mode === 'manual';
    if (locked) {
      const route = routes.find((r) => sameRoute(r, item.source));
      if (!route || !isDownloadReady(route)) {
        throw new DownloadError('NO_ROUTE', 'سيرفر هذا التنزيل لم يعد متاحًا لإكماله الآن', { retryable: true });
      }
      const candidate = await engine.pick(session, route.id);
      if (!candidate) throw new DownloadError('NO_ROUTE', 'السيرفر لم يرجع رابطًا');
      const info = await native.inspect({ session, candidate });
      const why = unsupportedReason(info);
      if (why) throw new DownloadError(why, info?.reason ?? null);
      return { route, candidate, info };
    }
    // يدوي: سيرفرات المصدر الذي اختاره المستخدم وحدها، ولا انتقال لغيره مهما كان أفضل
    const pool = manual ? routes.filter((r) => r.sourceId === item.source.sourceId) : routes;
    const ranked = rankRoutes(pool, { platform: deps.platform(), prefer: { quality: item.source?.quality ?? null } });
    if (!ranked.length) {
      throw new DownloadError('NO_ROUTE', manual ? 'المصدر الذي اخترته لم يجهز سيرفرًا قابلًا للتنزيل لهذه الحلقة الآن' : 'لا سيرفر جاهز يدعم التنزيل لهذه الحلقة الآن', { retryable: true });
    }
    let last = null;
    for (const route of ranked.slice(0, SMART_TRIES)) {
      if (signal.aborted) return null;
      try {
        const candidate = await engine.pick(session, route.id);
        if (!candidate) continue;
        const info = await native.inspect({ session, candidate });
        const why = unsupportedReason(info);
        if (why) {
          last = new DownloadError(why, info?.reason ?? null);
          continue;
        }
        return { route, candidate, info };
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof DownloadError ? last : new DownloadError('NO_ROUTE', String(last?.message ?? 'لا سيرفر قابل للتنزيل'), { retryable: true });
  }

  /** ينتظر نهاية العمل الأصلي، ويمرّر تقدّمه. يرجع { status: 'ready'|'expired', ... }. */
  function follow(native, item, ctl) {
    return new Promise((resolve, reject) => {
      let handle = null;
      const onAbort = () => {
        handle?.remove?.();
        const reason = ctl.signal.reason;
        // الإيقاف يحفظ الجزئي، والإلغاء يحذفه (cancel في المحرك)
        void (reason === 'cancel' ? native.cancel({ id: item.id }) : native.pause({ id: item.id })).catch(() => {});
        resolve({ status: 'aborted' });
      };
      ctl.signal.addEventListener('abort', onAbort, { once: true });
      const listener = (e) => {
        if (e?.id !== item.id) return;
        if (e.state === 'downloading') ctl.progress({
          bytes: e.bytes ?? 0,
          total: e.total > 0 ? e.total : null,
          // التورنت: المشاركون والقطع المتحقق من بصمتها (segmentsDone للقطع في محرك التورنت)
          ...(item.transport === 'torrent' || e.peers > 0 ? { torrent: { peers: e.peers ?? 0, pieces: e.segmentsDone ?? 0, piecesTotal: e.segmentsTotal ?? 0 } } : {}),
        });
        else if (e.state === 'reconnecting' || e.state === 'verifying') ctl.update({ state: e.state, bytes: e.bytes ?? item.bytes });
        else if (e.state === 'ready' || e.state === 'failed' || e.state === 'expired') {
          ctl.signal.removeEventListener('abort', onAbort);
          handle?.remove?.();
          if (e.state === 'ready') resolve({ status: 'ready', event: e });
          else if (e.state === 'expired') resolve({ status: 'expired', event: e });
          else reject(new DownloadError(e.code ?? 'UNKNOWN', e.message ?? null, { retryable: e.code === 'NETWORK' }));
        }
      };
      Promise.resolve(native.addListener('progress', listener)).then((h) => {
        handle = h;
        if (ctl.signal.aborted) h?.remove?.();
      });
    });
  }

  return {
    async run(item, ctl) {
      const native = deps.native();
      if (!native) throw new DownloadError('UNSUPPORTED', 'تنزيل الفيديو يعمل في تطبيق Android وويندوز');
      const engine = deps.engine();
      let current = item;
      for (let renewal = 0; renewal <= MAX_RENEWALS; renewal++) {
        ctl.update({ state: 'resolving' });
        const wanted = current.source?.locked ? (r) => sameRoute(r, current.source)
          : current.source?.mode === 'manual' ? (r) => r.sourceId === current.source.sourceId : null;
        const { session, routes } = await resolveRoutes(engine, current.request, { signal: ctl.signal, wanted });
        try {
          if (ctl.signal.aborted) return null;
          const picked = await choose(engine, native, current, session, routes, ctl.signal);
          if (!picked || ctl.signal.aborted) return null;
          const { route, candidate, info } = picked;
          const source = {
            ...current.source,
            sourceId: route.sourceId,
            sourceName: route.sourceName ?? current.source?.sourceName ?? null,
            server: route.server,
            routeCode: route.code ?? null,
            quality: route.quality ?? info.quality ?? null,
            locked: true,
          };
          current = { ...current, source };
          ctl.update({
            source,
            transport: info.transport ?? (route.type === 'torrent' ? 'torrent' : info.container === 'HLS' ? 'hls' : 'http'),
            resumable: info.resumable ?? null,
            total: info.size > 0 ? info.size : current.total ?? null,
            media: { container: info.container ?? null, quality: route.quality ?? info.quality ?? null, codec: info.codec ?? null, audio: info.audio ?? [], subtitles: info.subtitles ?? [] },
          });
          // ترجمات الإضافات المثبتة (العربية أولًا) تُحفظ بجانب الملف: نفس ما يجلبه المشغّل أونلاين
          const subs = await engine.subtitleContext?.(current.request.identity).catch?.(() => null) ?? null;
          await native.start({
            ...(subs?.subtitleIdentity ? { subtitleIdentity: subs.subtitleIdentity, addonSubtitleProviders: subs.addonSubtitleProviders ?? [], episode: current.request.episode ?? 1 } : {}),
            id: current.id,
            session,
            candidate,
            sourceKey: `${source.sourceId}|${source.routeCode ?? source.server ?? ''}`,
            title: current.work.title,
            label: current.unit.number != null ? (current.kind === 'manga' ? `الفصل ${current.unit.number}` : `الحلقة ${current.unit.number}`) : current.work.title,
            section: current.section,
          });
          const end = await follow(native, current, ctl);
          if (end.status === 'aborted') return null;
          if (end.status === 'ready') {
            const e = end.event;
            return {
              bytes: e.bytes,
              total: e.bytes,
              storage: { kind: 'file', path: e.path ?? null, bytes: e.bytes, verified: Boolean(e.verified), location: e.location ?? null },
              media: { ...(current.media ?? {}), ...(e.media ?? {}) },
              source,
            };
          }
          // انتهت صلاحية الرابط: نفس السيرفر برابط جديد، ويكمل المحرك من آخر بايت صحيح
        } finally {
          void engine.closeSession?.(session)?.catch?.(() => {});
        }
      }
      throw new DownloadError('EXPIRED', 'تكرر انتهاء صلاحية رابط المصدر', { retryable: true });
    },

    async remove(item) {
      const native = deps.native();
      await native?.remove?.({ id: item.id });
    },
  };
}
