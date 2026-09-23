/**
 * الهوية الأساسية للحسابات الثلاثة: الاسم والصورة قبل أن يغيّرها صاحبها.
 *
 * الصور مع التطبيق نفسه لا على الخادم: تظهر أول مرة وبلا اتصال، ولا تُحسب
 * من حصة أحد. وما يرفعه صاحب الحساب من المحرّر يأخذ مكانها، وحذفه يرجعها.
 *
 * الأسماء التي زرعتها أول هجرة («دحمي»، «N G M»، «منصور») تُعامل كأنها غير
 * مكتوبة: هي عنصر نائب لا اختيار أحد. أما اسمٌ كتبه صاحبه فلا يُلمس.
 */

const IDENTITIES = [
  {
    userId: 'bedcf897-a6f0-4730-b757-402b14891ca5',
    username: 'ngm',
    displayName: 'Meshal',
    avatar: '/avatars/meshal.webp',
    seedNames: ['N G M', 'ngm'],
  },
  {
    userId: '07588797-a471-44d1-99ce-7fb4f188c196',
    username: 'dahmi',
    displayName: 'D7m',
    avatar: '/avatars/d7m.webp',
    seedNames: ['دحمي', 'dahmi'],
  },
  {
    userId: '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed',
    username: 'mansour',
    displayName: 'Man',
    avatar: '/avatars/man.webp',
    seedNames: ['منصور', 'mansour'],
  },
];

export const DEFAULT_AVATARS = IDENTITIES.map((i) => i.avatar);

export function identityFor(userId, username) {
  return IDENTITIES.find((i) => i.userId === userId) ?? (username ? IDENTITIES.find((i) => i.username === String(username).toLowerCase()) : null) ?? null;
}

const unset = (value, seeds) => {
  const v = String(value ?? '').trim();
  return !v || seeds.includes(v);
};

/** صف `profiles` كما تراه الشاشات: الأساسي مكان الفارغ. لا يغيّر الأصل. */
export function withIdentity(row, username) {
  const identity = row && identityFor(row.user_id, username);
  if (!identity) return row;
  const nameUnset = unset(row.display_name, identity.seedNames);
  if (!nameUnset && row.avatar_key) return row;
  return {
    ...row,
    display_name: nameUnset ? identity.displayName : row.display_name,
    avatar_key: row.avatar_key || identity.avatar,
    // المحرّر يفرّق بين صورة رفعها صاحبها وصورة أساسية لا تُحذف
    default_avatar: !row.avatar_key,
  };
}

/** نفس القاعدة لحساب من `/v1/accounts` (شاشة «من يتابع؟»). */
export function accountWithIdentity(account) {
  const identity = account && identityFor(account.userId, account.username);
  if (!identity) return account;
  return {
    ...account,
    displayName: unset(account.displayName, identity.seedNames) ? identity.displayName : account.displayName,
    avatarKey: account.avatarKey || identity.avatar,
  };
}
