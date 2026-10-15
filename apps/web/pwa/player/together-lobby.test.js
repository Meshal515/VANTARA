import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
vi.mock('../../v35/together.js', () => ({ stateLabel: () => 'جاهز' }));
import { lobbyHeadline, pendingInvitees, renderLobby } from './together-lobby.js';

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


const MANSOUR = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
afterEach(() => vi.unstubAllGlobals());
describe('pending identity and visible lobby actions', () => {
  it('uses the existing verified identity if a pending profile has not synced', () => {
    const people = pendingInvitees([MANSOUR, MANSOUR, 'me', 'joined'], [{ userId: 'joined' }], 'me', () => ({ displayName: 'صديق', avatarKey: null }));
    expect(people).toEqual([{ userId: MANSOUR, displayName: 'Man', avatarKey: '/avatars/man.webp' }]);
    expect(pendingInvitees(['unknown'], [], 'me', () => ({ displayName: 'صديق', avatarKey: null }))[0].avatarKey).toBeNull();
  });
  it('preserves a custom photo and display name', () => {
    expect(pendingInvitees([MANSOUR], [], 'me', () => ({ displayName: 'منصور الجديد', avatarKey: 'https://example.com/custom.webp' }))[0])
      .toMatchObject({ displayName: 'منصور الجديد', avatarKey: 'https://example.com/custom.webp' });
  });
  it('always exposes Choose Server beside Start and keeps the timing controls interactive', () => {
    const { document } = parseHTML('<html><body><div id="lobby"></div></body></html>');
    vi.stubGlobal('document', document);
    vi.stubGlobal('Image', function () { return document.createElement('img'); });
    const host = document.getElementById('lobby');
    const changeServer = vi.fn();
    const start = vi.fn();
    const setOffset = vi.fn();
    const avatar = (p) => { const img = document.createElement('img'); img.src = p.avatarKey; return img; };
    renderLobby(host, { ...base, art: { title: 'Spider-Man' }, server: { code: 'MYS', quality: '720p' }, offset: 0, pending: [{ userId: MANSOUR, displayName: 'صديق', avatarKey: null }] }, { avatar, changeServer, start, setOffset, leave: vi.fn() });
    expect(host.querySelector('.pl-face.is-pending img').getAttribute('src')).toBe('/avatars/man.webp');
    host.querySelector('.pl-choose-server').click();
    host.querySelector('.pl-go:not(.pl-choose-server)').click();
    expect(changeServer).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(host.querySelector('.pl-more').hidden).toBe(true);
    host.querySelector('.pl-icon').click();
    expect(host.querySelector('.pl-more').hidden).toBe(false);
    const steps = host.querySelectorAll('.pl-step-btn');
    steps[0].click(); steps[1].click();
    expect(setOffset.mock.calls).toEqual([[-500], [500]]);
  });
});
