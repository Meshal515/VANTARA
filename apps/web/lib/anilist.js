/**
 * بوابة واحدة لكل طلبات AniList في التطبيق.
 *
 * AniList يحدّ الطلبات لكل عنوان IP (الآن 30 في الدقيقة، ويرد 429 بعدها حتى تمضي الدقيقة). كان كل
 * جزء يطلب وحده (أغلفة المانجا، الأنمي، البحث، المشاهدة معًا، رفيق، صور التصنيفات)، فتستهلك الأغلفة
 * في الخلفية الحد، ثم يفشل ما ضغطه المستخدم: «تعذّر جلب تفاصيل الأنمي» على كل عمل وفي البحث.
 *
 *   - الحد يُقرأ من AniList نفسه (X-RateLimit-Limit/Remaining/Reset، Retry-After) ويُحترم للجميع.
 *   - ما يطلبه المستخدم الآن (`priority: 'user'`) يتقدم الطابور ويُحجز له هامش؛ طلبات الخلفية تنتظر،
 *     وتُترك إن طال انتظارها (لا تزاحم ما بعدها).
 *   - 429: يتوقف الكل حتى موعد الفتح، وطلب المستخدم يُعاد مرة واحدة بعده بدل أن يفشل.
 *   - الطلب نفسه (نفس الاستعلام والمتغيرات) أثناء طيرانه يُشارَك ولا يُكرَّر.
 *
 * `anilistFetch(url, init, opts)` بديل `fetch` بالتوقيع نفسه: غير AniList يمر كما هو.
 */

const HOST = 'graphql.anilist.co';
const WINDOW_MS = 60_000;
/** هامش لا تأخذه الخلفية: ضغطة المستخدم تجد مكانًا دائمًا. */
const USER_RESERVE = 6;
/** طلب خلفية ينتظر أكثر من هذا يُترك (لا يسد الطريق بعد أن فقد معناه). */
const BACKGROUND_PATIENCE_MS = 25_000;
/** أقصى انتظار يُعاد بعده طلب المستخدم بعد 429 (أطول من هذا: يفشل بسبب واضح). */
const USER_RETRY_MAX_MS = 20_000;

export class AnilistBusyError extends Error {
  constructor(retryAt) {
    super('anilist_busy');
    this.name = 'AnilistBusyError';
    this.code = 'anilist_busy';
    this.retryAt = retryAt;
  }
}

export function createAnilistGate({ fetchImpl = (...a) => globalThis.fetch(...a), now = () => Date.now(), timer = (fn, ms) => setTimeout(fn, ms) } = {}) {
  // الحد يُعرف من ترويسات AniList نفسه (أول رد خلال ثانية من فتح التطبيق)؛ قبلها لا تقييد، و429 يُحترم دائمًا
  let limit = Infinity;
  const sent = [];
  let pausedUntil = 0;
  const queue = [];
  const inflight = new Map();
  let pumping = false;
  let wake = null;

  const prune = () => {
    const edge = now() - WINDOW_MS;
    while (sent.length && sent[0] <= edge) sent.shift();
  };
  const free = () => {
    prune();
    // هامش واحد: عدّاد AniList يبدأ قبل عدّنا بلحظة
    return Math.max(0, limit - 1 - sent.length);
  };
  const nextSlotAt = () => (sent.length ? sent[0] + WINDOW_MS + 5 : now());

  function learn(res) {
    const h = res?.headers;
    if (!h?.get) return;
    const lim = Number(h.get('x-ratelimit-limit'));
    if (Number.isFinite(lim) && lim > 0) limit = lim;
    const remaining = Number(h.get('x-ratelimit-remaining'));
    const reset = Number(h.get('x-ratelimit-reset'));
    const retryAfter = Number(h.get('retry-after'));
    if (res.status === 429) {
      const until = Number.isFinite(retryAfter) && retryAfter > 0 ? now() + retryAfter * 1000 : Number.isFinite(reset) && reset > 0 ? reset * 1000 : now() + WINDOW_MS;
      pausedUntil = Math.max(pausedUntil, until);
    } else if (remaining === 0 && Number.isFinite(reset) && reset > 0) {
      pausedUntil = Math.max(pausedUntil, reset * 1000);
    }
  }

  function schedule(ms) {
    if (wake) return;
    wake = timer(() => {
      wake = null;
      pump();
    }, Math.max(0, ms));
  }

  function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        // المستخدم أولًا، والأقدم أولًا داخل كل فئة
        queue.sort((a, b) => (a.priority === b.priority ? a.at - b.at : a.priority === 'user' ? -1 : 1));
        const t = now();
        // خلفية طال انتظارها تُترك
        for (let i = queue.length - 1; i >= 0; i--) {
          const job = queue[i];
          if (job.priority !== 'user' && t - job.at > BACKGROUND_PATIENCE_MS) {
            queue.splice(i, 1);
            job.reject(new AnilistBusyError(Math.max(pausedUntil, nextSlotAt())));
          }
        }
        if (!queue.length) break;
        if (pausedUntil > t) return schedule(pausedUntil - t);
        const head = queue[0];
        const room = free();
        const needed = head.priority === 'user' ? 1 : USER_RESERVE + 1;
        if (room < needed) {
          // يصحو عند أول مكان، أو عند انتهاء صبر أقدم طلب خلفية (يُترك بدل أن يبقى معلقًا)
          const stale = queue.filter((j) => j.priority !== 'user').map((j) => j.at + BACKGROUND_PATIENCE_MS + 1);
          return schedule(Math.min(nextSlotAt(), ...stale) - t);
        }
        queue.shift();
        sent.push(t);
        head.run();
      }
    } finally {
      pumping = false;
    }
  }

  function enqueue(priority, run) {
    return new Promise((resolve, reject) => {
      queue.push({
        priority,
        at: now(),
        reject,
        run: () => run().then(resolve, reject),
      });
      pump();
    });
  }

  async function send(url, init, priority, attempt = 0) {
    const res = await enqueue(priority, () => fetchImpl(url, init));
    learn(res);
    if (res.status === 429) {
      const wait = pausedUntil - now();
      if (priority === 'user' && attempt === 0 && wait <= USER_RETRY_MAX_MS) return send(url, init, priority, 1);
      throw new AnilistBusyError(pausedUntil);
    }
    return res;
  }

  /** بديل fetch: AniList يمر من البوابة، وغيره كما هو. */
  async function anilistFetch(url, init = {}, { priority = 'background' } = {}) {
    if (!String(url).includes(HOST)) return fetchImpl(url, init);
    const key = `${priority === 'user' ? 'u' : 'b'}|${typeof init.body === 'string' ? init.body : ''}`;
    // نفس الطلب في الطريق: نشارك جوابه (نسخة لكل مستدعٍ)
    const copy = (r) => (typeof r?.clone === 'function' ? r.clone() : r);
    if (init.body && !init.signal && inflight.has(key)) return copy(await inflight.get(key));
    const p = send(url, init, priority);
    if (init.body && !init.signal) {
      inflight.set(key, p);
      p.finally(() => inflight.delete(key)).catch(() => {});
    }
    const res = await p;
    return init.body && !init.signal ? copy(res) : res;
  }

  return {
    anilistFetch,
    /** للاختبار والتشخيص. */
    state: () => ({ limit, used: (prune(), sent.length), pausedUntil, queued: queue.length }),
  };
}

const shared = createAnilistGate();
/** البوابة المشتركة للتطبيق كله. */
export const anilistFetch = shared.anilistFetch;
/** fetch لمستعلمي AniList بأولوية المستخدم (فتح عمل، بحث). */
export const anilistUserFetch = (url, init) => shared.anilistFetch(url, init, { priority: 'user' });
export const anilistState = shared.state;
