/**
 * القارئ.
 *
 * المشكلة التي تحلّها هذه الوحدة: على الجوال، السحب للتمرير والنقر للتحكم
 * يبدآن بنفس الحدث. قارئ يعامل كل `touchend` كنقرة يفتح الشريط في وجهك مع كل
 * تمرير، وقارئ يعامل كل لمسة كتمرير لا يستجيب للنقر أصلًا.
 *
 * التمييز هنا بثلاثة شروط معًا: مسافة قصيرة، ومدة قصيرة، وعدم وجود تمرير
 * بينهما. وأي واحد يسقط ⇒ ليست نقرة.
 *
 * والشريط لا يغطي: عند ظهوره يُزاح المحتوى بـpadding بدل أن يُرسم فوقه.
 */

// إبهام يتحرك أقل من هذا = نقرة. أكثر = تمرير. مقاسة على شاشة جوال، لا مخترعة:
// ‏10px أقل من ارتجاف الإصبع الطبيعي، و14 يبدأ يبتلع تمريرًا قصيرًا مقصودًا.
const TAP_SLOP_PX = 12;
// اللمسة الأطول من هذا نية أخرى: ضغط مطوّل، أو تمرير بدأ ببطء.
const TAP_MAX_MS = 320;
// بعد التمرير، تُتجاهل النقرات لهذه المدة: رفع الإصبع بعد تمرير بالقصور الذاتي
// ليس نقرة.
const SCROLL_COOLDOWN_MS = 180;

export function createTapDetector({ onTap }) {
  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  let moved = false;
  let tracking = false;
  let lastScrollAt = 0;

  const markScrolled = () => {
    lastScrollAt = performance.now();
  };

  const onTouchStart = (event) => {
    // لمستان أو أكثر = تكبير، لا نقرة ولا تمرير
    if (event.touches.length !== 1) {
      tracking = false;
      return;
    }
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startedAt = performance.now();
    moved = false;
    tracking = true;
  };

  const onTouchMove = (event) => {
    if (!tracking || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (
      Math.abs(touch.clientX - startX) > TAP_SLOP_PX ||
      Math.abs(touch.clientY - startY) > TAP_SLOP_PX
    ) {
      moved = true;
    }
  };

  const onTouchEnd = (event) => {
    if (!tracking) return;
    tracking = false;

    if (moved) return;
    if (performance.now() - startedAt > TAP_MAX_MS) return;
    if (performance.now() - lastScrollAt < SCROLL_COOLDOWN_MS) return;

    const touch = event.changedTouches[0];
    onTap({ x: touch?.clientX ?? startX, y: touch?.clientY ?? startY, source: 'touch' });
  };

  const onTouchCancel = () => {
    tracking = false;
  };

  // الماوس مسار منفصل: لا سحب ولا قصور ذاتي، والنقرة نقرة.
  const onClick = (event) => {
    // النقرة المصطنعة بعد اللمس تحمل detail=0 في بعض المتصفحات
    if (event.detail === 0) return;
    onTap({ x: event.clientX, y: event.clientY, source: 'mouse' });
  };

  return {
    attach(element, scrollElement = window) {
      // passive: المتصفح لا ينتظر منّا قرارًا، فيبقى التمرير بستين إطارًا
      element.addEventListener('touchstart', onTouchStart, { passive: true });
      element.addEventListener('touchmove', onTouchMove, { passive: true });
      element.addEventListener('touchend', onTouchEnd, { passive: true });
      element.addEventListener('touchcancel', onTouchCancel, { passive: true });
      element.addEventListener('click', onClick);
      scrollElement.addEventListener('scroll', markScrolled, { passive: true });

      return () => {
        element.removeEventListener('touchstart', onTouchStart);
        element.removeEventListener('touchmove', onTouchMove);
        element.removeEventListener('touchend', onTouchEnd);
        element.removeEventListener('touchcancel', onTouchCancel);
        element.removeEventListener('click', onClick);
        scrollElement.removeEventListener('scroll', markScrolled);
      };
    },
  };
}

/**
 * منطقة النقرة: الثلث العلوي والسفلي للتنقل، والوسط للشريط.
 *
 * في واجهة عربية، يمين الشاشة هو "السابق". لكن في الويبتون العمودي التنقل
 * رأسي، فالتقسيم رأسي أيضًا ولا يتأثر بالاتجاه.
 */
export function zoneOf(y, height) {
  if (y < height * 0.28) return 'prev';
  if (y > height * 0.72) return 'next';
  return 'chrome';
}

/**
 * يحمّل الصفحات مع تحميل مسبق محدود.
 *
 * الحد مقصود: تحميل فصل كامل مسبقًا يخنق اتصالًا منزليًا ويستهلك بيانات
 * الجوال بلا داعٍ. صفحتان أمام القارئ تكفيان لإخفاء زمن الشبكة.
 */
export function createPageLoader({ bookId, pageNumbers, prefetch = 2, maxWidth, baseUrl = '' }) {
  // الترقيم 1-based: الفهرس 0 يرجع 502 من upstream، وهذا خطأ صامت لولا القياس
  //
  // baseUrl مطلق داخل الـAPK: لا أصل مشترك هناك، فالمسار النسبي يشير إلى
  // الحاوية المحلية لا إلى خادم المحتوى. فارغ في المتصفح، وهو الصحيح هناك.
  const urlFor = (pageNumber) => {
    const query = maxWidth ? `?maxWidth=${maxWidth}` : '';
    return `${baseUrl}/v1/img/page/${encodeURIComponent(bookId)}/${pageNumber}${query}`;
  };

  const warmed = new Set();

  return {
    urlFor,
    /** يسخّن الصفحات التالية بلا أن يحجب أي شيء. */
    warmAfter(pageNumber) {
      const at = pageNumbers.indexOf(pageNumber);
      if (at < 0) return;
      for (let i = at + 1; i <= at + prefetch && i < pageNumbers.length; i++) {
        const next = pageNumbers[i];
        if (warmed.has(next)) continue;
        warmed.add(next);
        const image = new Image();
        image.decoding = 'async';
        image.src = urlFor(next);
      }
    },
  };
}

/**
 * يتابع الصفحة الظاهرة ويُبلّغ عند تغيّرها.
 *
 * IntersectionObserver لا setState على كل حدث تمرير: الثاني يعيد الرسم عشرات
 * المرات في الثانية ويُسقط الإطارات، وهو السبب الأول لقارئ "غير سلس".
 */
export function observePages({ container, onPageChange, threshold = 0.5 }) {
  let current = -1;

  const observer = new IntersectionObserver(
    (entries) => {
      // الأكثر ظهورًا هو الصفحة الحالية، لا آخر ما دخل الشاشة
      let best = null;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (best === null || entry.intersectionRatio > best.intersectionRatio) best = entry;
      }
      if (!best) return;

      const index = Number(best.target.dataset.page);
      if (Number.isNaN(index) || index === current) return;
      current = index;
      onPageChange(index);
    },
    { root: null, threshold: [threshold] },
  );

  return {
    watch(element) {
      observer.observe(element);
    },
    disconnect() {
      observer.disconnect();
    },
    get current() {
      return current;
    },
  };
}

/**
 * يحفظ التقدم بلا أن يُغرق الشبكة.
 *
 * التمرير يولّد تغييرات كثيرة؛ الحفظ عند كل واحدة يرسل مئات الطلبات لفصل
 * واحد. هذا يؤجّل، ويتجاهل الصفحة المتكررة، ويحفظ حتمًا عند إخفاء الصفحة
 * (‏`visibilitychange` هو آخر حدث نضمنه على الجوال، لا `beforeunload`).
 */
export function createProgressSaver({
  bookId,
  delayMs = 2_000,
  fetchImpl = fetch,
  baseUrl = '',
  /** يُنادى بالصفحة فقط بعد أن يقبلها مالك التقدم فعلًا. */
  onSaved = null,
}) {
  let timer = null;
  let pending = null;
  let lastSaved = null;

  const send = async (page, useBeacon = false) => {
    if (page === lastSaved) return;
    lastSaved = page;
    const body = JSON.stringify({ page });
    const url = `${baseUrl}/v1/books/${encodeURIComponent(bookId)}/progress`;

    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      // beacon ينجو من إغلاق التبويب، بخلاف fetch. لا جواب منه، فلا إقرار:
      // الصف يبقى في الصندوق ويُصرَّف عند الإقلاع القادم
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      return;
    }
    try {
      const response = await fetchImpl(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        // الاعتماد يجب أن يُرسل صراحةً عبر الأصول: `fetch` الافتراضي
        // `same-origin`، وهذا المسار يتجاوز عميل الـAPI المشترك. فعلى الـAPK
        // (`https://localhost` → خادم آخر) كان يذهب بلا اعتماد فيرجع 401 —
        // وحفظ التقدم لا ينجح أبدًا بلا خطأ ظاهر للقارئ.
        credentials: baseUrl ? 'include' : 'same-origin',
      });
      // fetch لا يرمي على 401/502. اعتبار ذلك نجاحًا كان يعلّم التقدم «وصل
      // المالك» وهو لم يصل، فيضيع بلا إعادة محاولة ويعود القارئ للصفحة الأولى.
      if (!response?.ok) {
        lastSaved = null;
        return;
      }
      onSaved?.(page);
    } catch {
      // فقدان حفظ تقدم ليس سببًا لإزعاج القارئ؛ النبضة التالية تصلحه
      lastSaved = null;
    }
  };

  return {
    update(page) {
      pending = page;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (pending !== null) void send(pending);
      }, delayMs);
    },
    flush(useBeacon = false) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending !== null) void send(pending, useBeacon);
    },
  };
}
