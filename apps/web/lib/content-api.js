/**
 * نداء واحد لخادم المحتوى، لكل من الويب والـAPK.
 *
 * المشكلة (`BE-P0-05`): كوكي الجلسة `SameSite=Lax` لا يُرسل في نداء cross-site
 * أصلًا، و`None` يعتمد على كوكي طرف ثالث وهو في طريق الزوال. فالـAPK — يُقدَّم
 * من `https://localhost` — كان كل نداء JSON منه بلا هوية: 401 صامت على كل شيء.
 *
 * فالهوية تُحمل في الترويسة: نفس access token v2 الذي يصدره Sync Worker
 * (‏B2)، والـContent API يقبله في `requireSession`. والكوكي يبقى للويب حيث
 * الأصل مشترك ويعمل بلا شيء إضافي.
 *
 * ثلاث قواعد حاكمة:
 *
 * 1. **الترويسة تُبنى عند الإرسال لا عند النداء.** التوكن عمره خمس عشرة دقيقة،
 *    فترويسة مُحتجزة في متغير تصبح منتهية بلا أن يلاحظ أحد.
 *
 * 2. **تجديد واحد ثم استسلام.** 401 بعد التجديد يعني أن الجلسة انتهت فعلًا؛
 *    إعادة المحاولة بعده حلقة لا نهائية تُغرق الخادم وتجمّد الشاشة.
 *
 * 3. **الطلب يُعاد كما هو.** التجديد لا يغيّر إلا الترويسة: مسارًا أو جسمًا
 *    مختلفًا في المحاولة الثانية يعني عملية أخرى تُنفَّذ بلا أن يطلبها أحد.
 */

/** الترويسة الآن — لا قيمة محفوظة من قبل. */
function identityHeader(sync) {
  const header = sync?.authorizationHeader;
  return typeof header === 'string' && header.length > 0 ? header : null;
}

function buildInit(sync, options) {
  const headers = { ...(options.headers ?? {}) };
  const authorization = identityHeader(sync);
  if (authorization) headers.authorization = authorization;
  if (options.body !== undefined && options.body !== null) {
    headers['content-type'] = 'application/json';
  }

  return {
    ...options,
    headers,
    // الاعتماد صراحةً: `fetch` الافتراضي `same-origin`، وعلى الـAPK الأصل مختلف.
    // يُرسل مع الترويسة لا بدلًا منها: الويب يعمل بالكوكي والـAPK بالترويسة،
    // وهذا مسار واحد يخدم الاثنين.
    credentials: 'include',
    body:
      options.body === undefined || options.body === null
        ? undefined
        : typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body),
  };
}

async function readPayload(response) {
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function failure(response, payload) {
  const error = new Error(payload?.error ?? `HTTP ${response.status}`);
  error.status = response.status;
  error.code = payload?.error;
  return error;
}

/**
 * ينفّذ نداء JSON على خادم المحتوى.
 *
 * `sync` هو مالك الهوية: منه تُقرأ الترويسة ومنه يُطلب التجديد. لا يُخزَّن منه
 * شيء هنا — مصدر واحد للتوكن، وإلا بقيت نسخة قديمة تُرسل بعد التجديد.
 */
export async function requestContent({ baseUrl = '', sync, path, options = {} }) {
  const url = `${baseUrl}${path}`;

  const send = () => fetch(url, buildInit(sync, options));

  let response = await send();

  if (response.status === 401) {
    const canRefresh =
      typeof sync?.refreshSession === 'function' &&
      (identityHeader(sync) !== null || sync?.signedIn === true);

    if (canRefresh) {
      // فشل التجديد ليس خطأً جديدًا يُرمى: الأصل أن الطلب رجع 401، وهذا ما
      // يُبلَّغ. رمي خطأ التجديد كان يُخفي السبب الحقيقي عن المُنادي.
      try {
        await sync.refreshSession();
      } catch {
        /* يبقى الفشل هو 401 الأصلي */
      }
      response = await send();
    }
  }

  const payload = await readPayload(response);
  if (!response.ok) throw failure(response, payload);
  return payload;
}
