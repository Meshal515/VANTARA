import { describe, expect, it } from 'vitest';
import { accountWithIdentity, identityFor, withIdentity } from './identity.js';

const NGM = 'bedcf897-a6f0-4730-b757-402b14891ca5';
const DAHMI = '07588797-a471-44d1-99ce-7fb4f188c196';

describe('الهوية الأساسية', () => {
  it('الأسماء المزروعة تُعامل كأنها غير مكتوبة', () => {
    const row = withIdentity({ user_id: NGM, display_name: 'N G M', avatar_key: null });
    expect(row.display_name).toBe('Meshal');
    expect(row.avatar_key).toBe('/avatars/meshal.webp');
    expect(row.default_avatar).toBe(true);
  });

  it('اسمٌ وصورةٌ اختارهما صاحبهما لا يُلمسان', () => {
    const own = { user_id: DAHMI, display_name: 'دحومي', avatar_key: 'https://x/v1/media/abc' };
    expect(withIdentity(own)).toBe(own);
  });

  it('صورة مرفوعة مع اسم مزروع: الاسم الأساسي والصورة المرفوعة', () => {
    const row = withIdentity({ user_id: DAHMI, display_name: 'دحمي', avatar_key: 'https://x/v1/media/abc' });
    expect(row.display_name).toBe('D7m');
    expect(row.avatar_key).toBe('https://x/v1/media/abc');
    expect(row.default_avatar).toBe(false);
  });

  it('يُعرف الحساب باسم المستخدم حين لا يطابق المعرّف', () => {
    expect(identityFor('other', 'Mansour')?.displayName).toBe('Man');
    expect(identityFor('other', 'someone')).toBeNull();
  });

  it('حساب من /v1/accounts يأخذ نفس القاعدة', () => {
    const a = accountWithIdentity({ userId: NGM, username: 'ngm', displayName: 'ngm', avatarKey: null });
    expect(a.displayName).toBe('Meshal');
    expect(a.avatarKey).toBe('/avatars/meshal.webp');
    expect(accountWithIdentity(null)).toBeNull();
  });

  it('حساب غريب يمرّ كما هو', () => {
    const row = { user_id: 'x', display_name: null, avatar_key: null };
    expect(withIdentity(row)).toBe(row);
  });
});
