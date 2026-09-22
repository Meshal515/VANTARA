/**
 * قفل «من يتابع؟».
 *
 * الخادم يقول `active` لكل حساب نبض خلال خمس دقائق. القفل كما صُمّم في v35
 * يمنع الدخول إلى أي حساب نشط — وهذا صحيح لمن يحاول دخول حساب يستعمله غيره،
 * وخاطئ لصاحب الجهاز: من خرج ثم عاد خلال دقائق يجد حسابه «مستخدمًا الآن»
 * ومقفلًا في وجهه.
 *
 * فالاستثناء واحد: الحساب الذي دخله **هذا الجهاز** آخر مرة. ومفتاحه منفصل عن
 * جلسة المزامنة لأن `signOut` يمحو تلك — وهو بالضبط لحظة الحاجة إليه.
 */

const GATE_ACCOUNT_KEY = 'vantara.gate.lastAccount';

/** @returns {{ locked: boolean }} */
export function gateEntry(account, rememberedUserId) {
  const locked = Boolean(account?.active) && account.userId !== rememberedUserId;
  return { locked };
}

export function rememberedGateAccount() {
  try {
    return localStorage.getItem(GATE_ACCOUNT_KEY) || null;
  } catch {
    // تخزين محجوب: لا استثناء، والقفل يعمل كما صُمّم
    return null;
  }
}

export function rememberGateAccount(userId) {
  try {
    localStorage.setItem(GATE_ACCOUNT_KEY, String(userId));
  } catch {
    // الحصة ممتلئة أو نافذة خاصة: الاستثناء تحسين لا شرط
  }
}
