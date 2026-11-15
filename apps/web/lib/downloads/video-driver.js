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
/** الذكي لا ينتظر أبطأ مصدر: بعد أول سيرفر صالح بهذه المهلة يختار من الجاهز (كان ينتظر استقرار الكل حتى 60 ث). */
const SMART_GRACE_MS = 8_000;
const SMART_TRIES = 4;
const MAX_RENEWALS = 3;
/** فحص المرشّح (أول بايتات/قائمة HLS) لا يحبس «يجهّز المصدر» دقائق على مضيف ميت. */
const INSPECT_MS = 20_000;
/** إخفاقات من السيرفر نفسه لا من الشبكة: الذكي ينتقل لغيره (ملف جديد، لا خلط بايتات). */
const SERVER_FAULTS = new Set(['SOURCE', 'UNSUPPORTED', 'VERIFY', 'NO_ROUTE', 'DRM']);
/** بادئة جلسات تجهيز التنزيل: المحرك الأصلي لا يسخّن فيها تورنتات لم يخترها المستخدم. */
export const DOWNLOAD_SESSION_PREFIX = 'dl-';

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('aborted'));
    }, { once: true });
  });
}

function withTimeout(promise, ms, code, message) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new DownloadError(code, message)), ms); }),
  ]).finally(() => clearTimeout(t));
}

/**
 * هوية سيرفر ثابتة بين جلستين: بصمة المحرك (التورنت بـinfoHash:fileIdx)، أو معرّف الطريق حيث لا بصمة.
 * الرمز (`code`) ليس هوية: يُعطى بترتيب وصول السيرفرات في كل جلسة (TRR ثم TRR2…).
 */
export function routeIdentity(route) {
  return route?.fingerprint ?? route?.id ?? null;
}

/**
 * السيرفر نفسه الذي اختاره المستخدم أو قُفل عليه التنزيل.
 *   - بصمة محفوظة: تطابق البصمة وحدها (تورنت آخر من الإضافة نفسها ليس هو، مهما تشابهت الجودة).
 *   - بلا بصمة (تنزيل قديم): اسم السيرفر والجودة داخل المصدر نفسه.
 */
export function sameRoute(route, source) {
  if (!route || !source?.sourceId || route.sourceId !== source.sourceId) return false;
  if (source.fingerprint) {
    if (route.fingerprint) return route.fingerprint === source.fingerprint;
    return route.id === source.fingerprint;
  }
  if (source.server && route.server !== source.server) return false;
  if (source.quality != null && route.quality != null && Number(route.quality) !== Number(source.quality)) return false;
  return true;
}

/** هل حدّد المستخدم سيرفرًا بعينه (لا مصدرًا فقط)؟ */
const pinsRoute = (source) => Boolean(source?.fingerprint || source?.server);

/**
 * يجهّز الحلقة وينتظر السيرفرات: يرجع حين ينتهي التجهيز، أو حين يجهز ما يكفي للاختيار
 * (اليدوي: سيرفره وحده؛ الذكي: كل ما يُجهَّز انتهى أو مرّت المهلة).
 */
export async function resolveRoutes(engine, request, { signal, wanted = null, enough = null, settleMs = SETTLE_MS, onRoutes = null, session: sessionId } = {}) {
  const session0 = sessionId ?? `${DOWNLOAD_SESSION_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const out = await engine.prepare({ copies: request.copies ?? [], identity: request.identity ?? null, episode: request.episode, pinned: Boolean(request.pinned), probe: true, signal, session: session0 });
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
      // الذكي: ما يكفي جاهز (سيرفر صالح ومهلة سماح بعده)، فلا ينتظر أبطأ مصدر
      if (!wanted && enough?.(routes)) break;
      if (Date.now() >= until) break;
      // الإلغاء يُنهي الانتظار بلا استثناء: الجلسة تعود للمتصل فيغلقها (كانت تتسرب مفتوحة مع الاستثناء)
      await sleep(700, signal).catch(() => {});
      if (signal?.aborted) break;
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

/** لماذا لم يعطِ السيرفر المختار رابطًا (من المحرك الأصلي)، بكلام مفهوم. */
const PICK_REASON = {
  NO_CANDIDATES: 'السيرفر لم يرجع رابطًا لهذه الحلقة',
  EXPIRED: 'انتهت صلاحية روابط هذا السيرفر؛ نعيد التجهيز',
  FAILED: 'روابط هذا السيرفر فشلت في التشغيل',
  PROBE_FAILED: 'روابط هذا السيرفر لم تجتز الفحص (المضيف رفض أو الرابط ميت)',
};

/**
 * @param {{ engine: () => object, native: () => object|null, platform: () => ({ torrent: boolean }) }} deps
 */
export function createVideoDriver(deps) {
  /** فحص المرشّح بمهلة: مضيف لا يرد لا يحبس التنزيل في «يجهّز المصدر». */
  async function inspect(native, session, candidate) {
    const info = await withTimeout(native.inspect({ session, candidate }), INSPECT_MS, 'SOURCE', 'السيرفر لم يرد على الفحص خلال 20 ثانية');
    const why = unsupportedReason(info);
    if (why) throw new DownloadError(why, info?.reason ?? null);
    return info;
  }

  /** يختار السيرفر والمرشّح: يرجع { route, candidate, info } أو يرمي بسبب واضح. */
  async function choose(engine, native, item, session, routes, signal, skip = new Set()) {
    const source = item.source ?? {};
    const exact = source.locked || (source.mode === 'manual' && pinsRoute(source));
    if (exact) {
      // اليدوي والمقفول: السيرفر نفسه بهويته، لا «الأفضل» من مصدره (كان اليدوي يختار أعلى تورنت في Torrentio
      // بدل الذي ضغطه المستخدم)
      // اختيار المستخدم يُحترم كما هو: لا ترتيب «ذكي» يستبعد تورنتًا لأن وصفه يقول 0 مشاركين
      const route = routes.filter((r) => sameRoute(r, source) && isDownloadReady(r))
        .sort((a, b) => Number(Boolean(b.fingerprint && b.fingerprint === source.fingerprint)) - Number(Boolean(a.fingerprint && a.fingerprint === source.fingerprint))
          || Number(b.probed === true) - Number(a.probed === true))[0];
      if (!route || !isDownloadReady(route)) {
        throw new DownloadError('NO_ROUTE', source.locked ? 'سيرفر هذا التنزيل لم يعد متاحًا لإكماله الآن' : 'السيرفر الذي اخترته لم يعد متاحًا لهذه الحلقة الآن', { retryable: true });
      }
      const { candidate, reason } = engine.pickWithReason ? await engine.pickWithReason(session, route.id) : { candidate: await engine.pick(session, route.id), reason: null };
      if (!candidate) throw new DownloadError('NO_ROUTE', PICK_REASON[reason] ?? 'السيرفر لم يرجع رابطًا', { retryable: reason === 'EXPIRED' || reason === 'NO_CANDIDATES' });
      return { route, candidate, info: await inspect(native, session, candidate) };
    }
    // يدوي بمصدر فقط: سيرفرات ذلك المصدر وحدها؛ الذكي: الكل
    const pool = (source.mode === 'manual' ? routes.filter((r) => r.sourceId === source.sourceId) : routes).filter((r) => !skip.has(routeIdentity(r)));
    const ranked = rankRoutes(pool, { platform: deps.platform(), prefer: { quality: source.quality ?? null } });
    if (!ranked.length) {
      throw new DownloadError('NO_ROUTE', source.mode === 'manual' ? 'المصدر الذي اخترته لم يجهز سيرفرًا قابلًا للتنزيل لهذه الحلقة الآن' : noRouteReason(routes, skip), { retryable: true });
    }
    let last = null;
    for (const route of ranked.slice(0, SMART_TRIES)) {
      if (signal.aborted) return null;
      try {
        const { candidate } = engine.pickWithReason ? await engine.pickWithReason(session, route.id) : { candidate: await engine.pick(session, route.id) };
        if (!candidate) continue;
        return { route, candidate, info: await inspect(native, session, candidate) };
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof DownloadError ? last : new DownloadError('NO_ROUTE', String(last?.message ?? 'لا سيرفر قابل للتنزيل'), { retryable: true });
  }

  /** لماذا لا سيرفر: بالأرقام، لا «تعذّر» صامت. */
  function noRouteReason(routes, skip) {
    const torrentOnly = routes.length > 0 && routes.every((r) => r.type === 'torrent');
    if (!routes.length) return 'لم يرجع أي مصدر سيرفرًا لهذه الحلقة';
    if (torrentOnly && !deps.platform()?.torrent) return 'كل السيرفرات تورنت، وهذا الجهاز لا يحفظ التورنت';
    const failed = routes.filter((r) => r.state === 'UNAVAILABLE' || r.state === 'FAILED' || r.probed === false).length;
    const tried = skip.size ? ` (جُرّب ${skip.size} ورفض)` : '';
    return `لا سيرفر صالح للتنزيل من ${routes.length}${failed ? `، ${failed} منها لا يعمل الآن` : ''}${tried}`;
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
        // في طابور الجهاز (Android) ينتظر خانته هناك
        if (e.state === 'queued') ctl.update({ state: 'scheduled' });
        else if (e.state === 'downloading') ctl.progress({
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
      Promise.resolve(native.addListener('progress', listener)).then(async (h) => {
        handle = h;
        if (ctl.signal.aborted) return void h?.remove?.();
        // حدث سبق الاشتراك (فشل فوري برمز 404، أو اكتمال سريع) لا يُفقد: الحالة الحالية من الجهاز.
        // بدونها يبقى الصف «يجهّز المصدر» للأبد لأن نهايته وصلت قبل أن يستمع أحد
        const st = await native.status?.({ id: item.id }).catch(() => null);
        if (st?.exists && ['ready', 'failed', 'expired'].includes(st.state)) listener({ ...st, id: item.id });
      });
    });
  }

  /** نهاية العمل الأصلي إلى نتيجة المدير. */
  function outcome(end, current, source) {
    const e = end.event;
    return {
      bytes: e.bytes,
      total: e.bytes,
      storage: { kind: 'file', path: e.path ?? null, bytes: e.bytes, verified: Boolean(e.verified), location: e.location ?? null },
      media: { ...(current.media ?? {}), ...(e.media ?? {}) },
      source,
    };
  }

  // Android وحده يملك طابورًا أصليًا يكمل بلا واجهة (DownloadService)؛ ويندوز ينفّذ ما يُسلَّم فورًا
  const deviceQueue = () => deps.platform?.()?.platform === 'android';

  return {
    async run(item, ctl) {
      const native = deps.native();
      if (!native) throw new DownloadError('UNSUPPORTED', 'تنزيل الفيديو يعمل في تطبيق Android وويندوز');
      const engine = deps.engine();
      let current = item;
      // سُلِّم من قبل (أُغلق التطبيق والجهاز أكمل أو ما زال يعمل): نتابعه، بلا تجهيز سيرفر ولا تنزيل ثانٍ
      if (deviceQueue()) {
        const st = await native.status?.({ id: item.id }).catch(() => null);
        if (st?.exists && st.state === 'ready') return outcome({ event: st }, current, current.source);
        if (st?.exists && (st.running || st.queued)) {
          ctl.handoff?.();
          if (st.queued) ctl.update({ state: 'scheduled' });
          const end = await follow(native, current, ctl);
          if (end.status === 'aborted') return null;
          if (end.status === 'ready') return outcome(end, current, current.source);
          // انتهت صلاحية الرابط وهو في طابور الجهاز: يُجهَّز من جديد أدناه
        }
      }
      // أخطاء السيرفر نفسه في الذكي: يُستبعد ويُجرَّب التالي (ملف جديد من الصفر، لا خلط بايتات)
      const skip = new Set();
      for (let renewal = 0; renewal <= MAX_RENEWALS + SMART_TRIES; renewal++) {
        ctl.update({ state: 'resolving', stage: 'نجهّز سيرفرات الحلقة…' });
        const exact = current.source?.locked || (current.source?.mode === 'manual' && pinsRoute(current.source));
        const wanted = exact ? (r) => sameRoute(r, current.source)
          : current.source?.mode === 'manual' ? (r) => r.sourceId === current.source.sourceId : null;
        let firstGood = 0;
        const enough = (routes) => {
          if (!rankRoutes(routes.filter((r) => !skip.has(routeIdentity(r))), { platform: deps.platform() }).length) return false;
          firstGood ||= Date.now();
          return Date.now() - firstGood >= SMART_GRACE_MS;
        };
        const onRoutes = (routes) => {
          const ready = routes.filter((r) => isDownloadReady(r)).length;
          const pending = routes.filter((r) => r.state === 'RESOLVING' || r.state === 'CHECKING').length;
          const stage = ready ? `${ready} ${ready === 1 ? 'سيرفر جاهز' : 'سيرفرات جاهزة'}${pending ? ` · يُفحص ${pending}` : ''}` : pending ? `نبحث في المصادر · ${pending}` : 'نجهّز سيرفرات الحلقة…';
          if (stage !== current.stage) { current = { ...current, stage }; ctl.update({ stage }); }
        };
        const { session, routes } = await resolveRoutes(engine, current.request, { signal: ctl.signal, wanted, enough, onRoutes });
        let started = null;
        try {
          if (ctl.signal.aborted) return null;
          ctl.update({ stage: 'نفحص الملف قبل الحفظ…' });
          const picked = await choose(engine, native, current, session, routes, ctl.signal, skip);
          if (!picked || ctl.signal.aborted) return null;
          const { route, candidate, info } = picked;
          const source = {
            ...current.source,
            sourceId: route.sourceId,
            sourceName: route.sourceName ?? current.source?.sourceName ?? null,
            server: route.server,
            routeCode: route.code ?? null,
            fingerprint: routeIdentity(route),
            label: route.label ?? current.source?.label ?? null,
            quality: route.quality ?? info.quality ?? null,
            locked: true,
            // قفلُ الذكي (لا المستخدم): خطأ دائم من السيرفر ينقل لغيره
            auto: current.source?.mode !== 'manual',
          };
          current = { ...current, source };
          started = routeIdentity(route);
          ctl.update({
            source,
            stage: null,
            transport: info.transport ?? (route.type === 'torrent' ? 'torrent' : info.container === 'HLS' ? 'hls' : 'http'),
            resumable: info.resumable ?? null,
            total: info.size > 0 ? info.size : current.total ?? null,
            media: { container: info.container ?? null, quality: route.quality ?? info.quality ?? null, codec: info.codec ?? null, audio: info.audio ?? [], subtitles: info.subtitles ?? [] },
          });
          // ترجمات الإضافات المثبتة (العربية أولًا) تُحفظ بجانب الملف: نفس ما يجلبه المشغّل أونلاين
          const subs = await engine.subtitleContext?.(current.request.identity).catch?.(() => null) ?? null;
          const conf = ctl.settings?.() ?? {};
          await native.start({
            parallel: conf.parallel,
            wifiOnly: conf.wifiOnly,
            ...(subs?.subtitleIdentity ? { subtitleIdentity: subs.subtitleIdentity, addonSubtitleProviders: subs.addonSubtitleProviders ?? [], episode: current.request.episode ?? 1 } : {}),
            id: current.id,
            session,
            candidate,
            // هوية السيرفر الثابتة: نفسها ⇒ يكمل الجزئي، غيرها ⇒ ملف جديد (الرمز يتغير بين الجلسات فلا يصلح)
            sourceKey: `${source.sourceId}|${source.fingerprint ?? source.server ?? ''}`,
            title: current.work.title,
            label: current.unit.number != null ? (current.kind === 'manga' ? `الفصل ${current.unit.number}` : `الحلقة ${current.unit.number}`) : current.work.title,
            section: current.section,
          });
          // في طابور الجهاز الآن: الخانة هنا تفرغ لتجهيز التالي، والجهاز يكمل ولو أُغلق التطبيق
          if (deviceQueue()) ctl.handoff?.();
          const end = await follow(native, current, ctl);
          if (end.status === 'aborted') return null;
          if (end.status === 'ready') return outcome(end, current, source);
          // انتهت صلاحية الرابط: نفس السيرفر برابط جديد، ويكمل المحرك من آخر بايت صحيح
        } catch (error) {
          // الذكي وحده ينتقل: سيرفر رفض (404، صفحة بدل ملف، فحص فاشل) يُستبعد ويُجرَّب الذي بعده
          const code = error instanceof DownloadError ? error.code : null;
          const smart = current.source?.mode !== 'manual' && (!current.source?.locked || current.source?.auto);
          if (!smart || !SERVER_FAULTS.has(code) || ctl.signal.aborted) throw error;
          // فشل قبل البدء: choose جرّب أفضل ما عنده بالفعل، فلا جولة تجهيز ثانية بلا جديد
          if (!started) throw error;
          skip.add(started);
          // لا بديل جاهز في هذه الجولة: السبب الحقيقي (404…) لا «لا سيرفر صالح» عام، ولا جولة تجهيز بلا جدوى
          const others = rankRoutes(routes.filter((r) => !skip.has(routeIdentity(r))), { platform: deps.platform() });
          if (skip.size >= SMART_TRIES || !others.length) throw error;
          current = { ...current, source: { ...current.source, locked: false, fingerprint: null, server: null, routeCode: null } };
          ctl.update({ source: current.source, stage: 'السيرفر رفض — نجرّب غيره…' });
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
