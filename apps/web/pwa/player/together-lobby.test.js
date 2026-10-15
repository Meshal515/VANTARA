import { describe, expect, it } from 'vitest';
import { lobbyHeadline } from './together-lobby.js';

const base = { host: true, me: 'me', prepared: true, failed: false, blocked: false, connection: 'live', roster: [{ userId: 'me', name: 'Meshal', state: 'ready' }], pending: [] };

describe('جملة حالة الغرفة الواحدة', () => {
  it('المدعو الذي لم يدخل يُذكر مرة واحدة بلا «بانتظار…» مكررة', () => {
    expect(lobbyHeadline({ ...base, pending: [{ displayName: 'منصور' }] })).toBe('منصور ما دخل بعد');
    expect(lobbyHeadline({ ...base, pending: [{ displayName: 'منصور' }, { displayName: 'دحمي' }, { displayName: 'سعد' }] })).toBe('منصور ودحمي و1 غيرهم ما دخلوا بعد');
  });
  it('من يجهّز ومن تعذّر سيرفره، ثم «الكل جاهز»', () => {
    const roster = [...base.roster, { userId: 'm', name: 'منصور', state: 'preparing' }];
    expect(lobbyHeadline({ ...base, roster })).toBe('منصور يجهّز…');
    expect(lobbyHeadline({ ...base, roster: [...base.roster, { userId: 'm', name: 'منصور', state: 'failed' }] })).toBe('سيرفر منصور تعذّر');
    expect(lobbyHeadline({ ...base, roster: [...base.roster, { userId: 'm', name: 'منصور', state: 'ready' }] })).toBe('الكل جاهز');
    expect(lobbyHeadline({ ...base, host: false, roster: [...base.roster, { userId: 'm', name: 'منصور', state: 'ready' }] })).toBe('الكل جاهز · بانتظار المضيف');
  });
  it('حالتي أنا أولًا: الاتصال، ثم السيرفر', () => {
    expect(lobbyHeadline({ ...base, connection: 'connecting' })).toBe('جاري الاتصال بالغرفة…');
    expect(lobbyHeadline({ ...base, prepared: false })).toBe('نجهّز فيديوك…');
    expect(lobbyHeadline({ ...base, failed: true })).toBe('تعذّر سيرفرك · اختر سيرفرًا آخر');
  });
});
