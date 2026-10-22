import { describe, expect, it } from 'vitest';
import { accountWithIdentity, canManageDangerZone, identityFor, withIdentity } from './identity.js';

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


describe('منطقة الخطر: صلاحية حساب المالك وحده', () => {
  const MANSOUR = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
  const session = (who, rows, locked = false) => ({
    user: who ? { userId: who, username: 'ngm' } : null,
    locked,
    rows(table, predicate) {
      return table === 'accounts' ? rows.filter(predicate) : [];
    },
  });
  const owner = { user_id: NGM, badge: 'owner', lifecycle: 'ACTIVE' };

  it('يعرضها فقط لحساب ngm المالك الذي منحه الخادم شارة المالك', () => {
    expect(canManageDangerZone(session(NGM, [owner]))).toBe(true);
  });

  it('يخفيها عن منصور ودحمي حتى لو نُسخت الشارة إلى حسابهما', () => {
    for (const id of [DAHMI, MANSOUR]) {
      expect(canManageDangerZone(session(id, [owner]))).toBe(false);
      expect(canManageDangerZone(session(id, [{ user_id: id, badge: 'owner', lifecycle: 'ACTIVE' }]))).toBe(false);
    }
  });

  it('لا يمنحها لمجرد تطابق اسم المستخدم أو عند غياب سجل المالك', () => {
    expect(canManageDangerZone(session('impostor', [owner]))).toBe(false);
    expect(canManageDangerZone(session(NGM, []))).toBe(false);
    expect(canManageDangerZone(session(NGM, [{ ...owner, badge: null }]))).toBe(false);
    expect(canManageDangerZone(session(null, [owner]))).toBe(false);
  });

  it('يقفلها أثناء قفل الحساب أو فترة حذفه', () => {
    expect(canManageDangerZone(session(NGM, [owner], true))).toBe(false);
    expect(canManageDangerZone(session(NGM, [{ ...owner, lifecycle: 'PENDING_DELETE' }]))).toBe(false);
    expect(canManageDangerZone(session(NGM, [{ ...owner, lifecycle: 'DELETED' }]))).toBe(false);
  });

  it('تتغير الصلاحية فور تبديل الحساب على الجهاز نفسه', () => {
    const active = session(NGM, [owner]);
    expect(canManageDangerZone(active)).toBe(true);
    active.user = { userId: DAHMI, username: 'dahmi' };
    expect(canManageDangerZone(active)).toBe(false);
  });
});
