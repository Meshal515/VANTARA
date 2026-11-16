/**
 * قواعد الإشعارات عند العميل.
 *
 * الصندوق يستلم دائمًا؛ هذا الملف يقرر **المنبثق** وحده: ما يظهر كتنبيه جانبي
 * صغير الآن. الحالة الثلاثية (`created/seen/read`) تعيش في D1 ومالكها الخادم،
 * وهنا نقرأها لا نخترعها.
 *
 * أسماء الأنواع مكرّرة عن `packages/domain/src/notifications.ts` لأن الواجهة
 * JS خالص بلا bundler فلا تستورد الحزمة. اختبار في
 * `tools/repository-safety.test.mjs` يفشل إذا اختلفت القائمتان، فالتكرار
 * مكشوف لا صامت.
 */

/** نص كل نوع كما يُقرأ في التنبيه والإعدادات. */
export const NOTIFICATION_LABELS = {
  MESSAGE: 'رسائل المجلس',
  NEW_UNIT: 'جديد المفضلة',
  RECOMMENDATION: 'التوصيات',
  TOGETHER: 'دعوات المشاهدة',
  FRAME: 'الفريمات',
  COMMENT_REPLY: 'الردود والتعليقات',
  REACTION: 'التفاعلات',
  FRIEND_ACTIVITY: 'نشاط الأصدقاء',
  SYSTEM: 'أحداث مهمة',
};

export const NOTIFICATION_KINDS = Object.keys(NOTIFICATION_LABELS);

/** حالة الصف. `read` تعني العرض ضمنًا حتى لو لم يُكتب `seen`. */
export function stateOf(row) {
  if (row?.read === 1 || row?.read === true) return 'read';
  if (row?.seen === 1 || row?.seen === true) return 'seen';
  return 'created';
}

/** غير المقروء: `read` هو المعيار وحده — العرض ليس قراءة. */
export function unreadCount(rows) {
  return rows.filter((row) => stateOf(row) !== 'read').length;
}

/**
 * إعدادات المنبثق من الإعدادات المشتركة.
 *
 * التسامح مقصود: حقل فاسد أو ناقص يعني «مفعّل». الافتراض المعاكس كان سيُسكت كل
 * التنبيهات بسبب إعداد مكتوب خطأ، وهو عطل لا يشتكي منه المستخدم بل يظنّ أن
 * أصدقاءه لا يرسلون شيئًا.
 */
export function popupSettings(settingsRow) {
  let data = {};
  try {
    const raw = settingsRow?.data;
    data = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {});
  } catch {
    data = {};
  }
  const block = data?.notifications ?? {};
  const kinds = {};
  for (const kind of NOTIFICATION_KINDS) {
    kinds[kind] = block?.kinds?.[kind] !== false;
  }
  return { enabled: block?.popups !== false, kinds, phone: block?.phone !== false, lockPreview: block?.lockPreview === true };
}

/** ما يُكتب في الإعدادات عند تغيير مفتاح. شكل واحد لا اثنان. */
export function popupPatch(settings) {
  const kinds = {};
  for (const kind of NOTIFICATION_KINDS) kinds[kind] = settings.kinds[kind] !== false;
  // الحقل يُكتب كاملًا (json_set): كل مفتاح فيه يُحمل هنا وإلا مُسح «إشعارات الجوال» و«شاشة القفل»
  return { notifications: { popups: settings.enabled !== false, kinds, phone: settings.phone !== false, lockPreview: settings.lockPreview === true } };
}

/**
 * هل يظهر تنبيه جانبي لهذا الصف الآن؟
 *
 * أربعة شروط: الإشعار لي، ولستُ الفاعل، ولم يُعرض بعد، والنوع غير مُطفأ.
 * الشرط الثالث هو ما يمنع تكرار نفس التنبيه عند كل مزامنة.
 */
export function shouldToast(row, { viewerId, settings }) {
  if (!row || !viewerId) return false;
  if (row.user_id !== viewerId) return false;
  if (row.actor_id && row.actor_id === viewerId) return false;
  if (stateOf(row) !== 'created') return false;
  if (settings.enabled === false) return false;
  if (!NOTIFICATION_KINDS.includes(row.kind)) return true;
  return settings.kinds[row.kind] !== false;
}

/** الصفوف التي تستحق تنبيهًا، الأقدم أولًا كي يظهر الترتيب طبيعيًا. */
export function toastable(rows, context) {
  return rows
    .filter((row) => shouldToast(row, context))
    .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
}

/**
 * دعوة «مشاهدة معًا» في التنبيه المنبثق: عنوانها («مشعل يدعوك تشاهد معه») ورمز الغرفة الذي يُدخل إليها عند الضغط.
 * null لغير الدعوات. كان التنبيه يكتب «إشعار» واسم العمل فقط، ويفتح صفحة العمل لا الغرفة.
 */
export function togetherInvite(row, actor) {
  if (row?.kind !== 'TOGETHER') return null;
  const code = /#together=([A-Z0-9]{6})/.exec(row.link ?? '')?.[1] ?? null;
  const reading = !/^(anime|cinema):/.test(row.series_ref ?? '');
  return { code, title: `${actor} يدعوك ${reading ? 'تقرأ' : 'تشاهد'} معه` };
}

/** جسم JSON صغير (رسائل وجديد المفضلة)؛ نص قديم أو فاسد = null فيُعرض كما هو. */
export function notificationData(row) {
  const raw = row?.body;
  if (typeof raw !== 'string' || !raw.startsWith('{')) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const fmt = String;

/** «نزل الفصل 120» / «نزلت الفصول 118–120» / «الموسم 2 · نزلت الحلقة 5». */
export function unitLine(data) {
  const a = num(data?.a);
  const b = num(data?.b) ?? a;
  const s = num(data?.s);
  if (data?.k === 'movie' || b === null) return 'صار متاحًا الآن';
  const many = a !== null && a !== b;
  const range = many ? `${fmt(Math.min(a, b))}–${fmt(Math.max(a, b))}` : fmt(b);
  const line = data?.k === 'episode'
    ? (many ? `نزلت الحلقات ${range}` : `نزلت الحلقة ${range}`)
    : (many ? `نزلت الفصول ${range}` : `نزل الفصل ${range}`);
  return s !== null && data?.k === 'episode' ? `الموسم ${fmt(s)} · ${line}` : line;
}

/**
 * نص الإشعار الواحد كما يُقرأ في كل مكان: المنبثق، وصندوق الإشعارات، وإشعار الجوال (يرسمه
 * الخادم بهذه الدالة نفسها للفحص الدوري). مصدر واحد للصياغة فلا تختلف بين المنصات.
 *
 * `actor` اسم الفاعل الظاهر. `image` غلاف العمل لجديد المفضلة (صورة الفاعل يضعها المستدعي).
 * `group` قناة العرض: messages | favorites | social | system.
 */
export function describeNotification(row, actor = 'صديق') {
  const data = notificationData(row);
  const body = row?.body ?? '';
  switch (row?.kind) {
    case 'MESSAGE': {
      const n = num(data?.n) ?? 1;
      const text = data?.x ? 'حُذفت الرسالة' : data?.v ? '🎤 رسالة صوتية' : String(data?.p ?? body ?? '');
      return { title: n > 1 ? `${actor} · ${n} رسائل` : actor, body: text, group: 'messages', image: null };
    }
    case 'NEW_UNIT':
      return { title: String(data?.t ?? 'عمل في مفضلتك'), body: unitLine(data), group: 'favorites', image: data?.c ?? null };
    case 'RECOMMENDATION':
      return { title: `${actor} رشّح لك`, body, group: 'social', image: null };
    case 'FRAME':
      return { title: `${actor} أرسل لك فريم`, body, group: 'social', image: null };
    case 'TOGETHER':
      return { title: togetherInvite(row, actor).title, body, group: 'social', image: null };
    case 'REACTION': {
      const majlis = String(row?.link ?? '').startsWith('vantara://majlis/') ? String(row.link).split('/')[3] : null;
      const what = { frame: 'فريمك', rec: 'ترشيحك', activity: 'نشاطك' }[majlis] ?? (majlis ? 'رسالتك' : 'تعليقك');
      return { title: `${actor} تفاعل ${body} مع ${what}`, body: '', group: 'social', image: null };
    }
    case 'COMMENT_REPLY':
      return { title: `${actor} ردّ عليك`, body, group: 'social', image: null };
    default:
      return { title: NOTIFICATION_LABELS[row?.kind] ?? 'إشعار', body, group: 'system', image: null };
  }
}
