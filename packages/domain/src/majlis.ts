/**
 * المجلس: من يرى ما يُرسَل بين الأصدقاء.
 *
 * لا رسائل خاصة في VANTARA. الفريم أو التوصية لشخص تصله هو (إشعارًا)، وتظهر
 * في المجلس لبقية الأصدقاء: «مشعل أرسل إلى عبد الرحمن». والمرسل يختار من
 * يُخفيها عنه، فلا يراها المُخفى عنه أبدًا — ولا حتى في سجل الفروقات، لأن
 * الإخفاء يُطبَّق عند السحب لا في الواجهة.
 *
 * و«الجميع» يعني كل الأصدقاء إلا المرسل ومن أُخفيت عنه.
 */

export type MajlisAudience = {
  /** من يصله الإشعار. */
  recipients: string[];
  /** من لا يرى الإرسال إطلاقًا. مرتّب وبلا تكرار، ولا يضم المرسل ولا المستلم. */
  hidden: string[];
};

/**
 * جمهور إرسالٍ في المجلس، أو `null` إن لم يكن له مستلم صالح.
 *
 * المستلم لا يُخفى عنه ما أُرسل إليه، والمرسل لا يُخفى عنه ما أرسله: قائمة
 * إخفاء تضمّهما تُصحَّح بصمت لا تُرفض. وأي معرّف ليس صديقًا يسقط.
 */
export function majlisAudience(input: {
  accounts: readonly string[];
  actorId: string;
  toId?: string | null;
  hiddenFrom?: unknown;
}): MajlisAudience | null {
  const accounts = new Set(input.accounts);
  const to = input.toId || null;
  if (to && (to === input.actorId || !accounts.has(to))) return null;

  const raw = Array.isArray(input.hiddenFrom) ? input.hiddenFrom : [];
  const hidden = [
    ...new Set(
      raw.filter(
        (id): id is string => typeof id === 'string' && accounts.has(id) && id !== input.actorId && id !== to,
      ),
    ),
  ].sort();

  const recipients = to
    ? [to]
    : [...accounts].filter((id) => id !== input.actorId && !hidden.includes(id)).sort();
  if (recipients.length === 0) return null;
  return { recipients, hidden };
}

/** شكل المعرّف داخل `hidden_json` كما يبحث عنه SQL (`instr`). */
export function hiddenToken(userId: string): string {
  return JSON.stringify(userId);
}

/**
 * تفاعلات المجلس: رمزٌ واحد لا نص حر، فلا يتحول التفاعل إلى قناة رسائل.
 *
 * الستة الأولى هي الشريط السريع؛ وزرّ «+» يفتح كل الرموز. فالتحقق بالشكل لا
 * بالقائمة: رمز تعبيري واحد (مع مُعدِّلاته ووصلاته — 👍🏽 و❤️‍🔥 رمزٌ واحد)، لا
 * حروف ولا أرقام ولا أكثر من رمز.
 */
export const MAJLIS_REACTIONS = ['❤️', '🔥', '😂', '😮', '😢', '👏'] as const;
export type MajlisReaction = string;
export const MAJLIS_TARGETS = ['frame', 'rec', 'activity'] as const;
export type MajlisTarget = (typeof MAJLIS_TARGETS)[number];

const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:\uFE0F|\p{Emoji_Modifier}|\u200D(?:\p{Extended_Pictographic})\uFE0F?|\u20E3)*$/u;

export function isMajlisReaction(value: unknown): value is MajlisReaction {
  return typeof value === 'string' && value.length <= 16 && EMOJI.test(value);
}
export function isMajlisTarget(value: unknown): value is MajlisTarget {
  return typeof value === 'string' && (MAJLIS_TARGETS as readonly string[]).includes(value);
}
