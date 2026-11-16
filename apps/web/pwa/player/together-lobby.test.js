import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
vi.mock('../../v35/together.js', () => ({ stateLabel: () => 'جاهز' }));
import { lobbyHeadline, pendingInvitees, renderLobby } from './together-lobby.js';
import { dimStrength, startFacts } from '../../lib/together/lobby.js';

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
    host.querySelector('.pl-start').click();
    // التصميم المعتمد: البدء صورة الحلقة ثم دائرة بمثلث ثم «البدء»
    expect(host.querySelector('.pl-start .pl-start-label').textContent).toBe('البدء');
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


describe('بطاقة البدء: التقييم بمصدره والمدة، والتعتيم التكيّفي', () => {
  it('التقييم لا يظهر إلا بقيمة حقيقية ومصدره معه، والمدة كما وصلت، ولا شيء يُخترع', () => {
    expect(startFacts({ rating: 8.7, ratingSource: 'IMDb', duration: '41 دقيقة' })).toEqual([{ text: '★ 8.7 IMDb', dir: 'ltr' }, { text: '41 دقيقة', dir: 'rtl' }]);
    // تقييم صفر (حلقة بلا تقييم عند Cinemeta) أو غائب ⇒ المدة وحدها
    expect(startFacts({ rating: 0, duration: '24 دقيقة' })).toEqual([{ text: '24 دقيقة', dir: 'rtl' }]);
    expect(startFacts({})).toEqual([]);
    // تقييم بلا مصدر لا يُنسب لـIMDb
    expect(startFacts({ rating: 7.123 })).toEqual([{ text: '★ 7.1', dir: 'ltr' }]);
  });
  it('بنر أبيض ناصع من اليسار يُعتَّم كاملًا، والغامق لا يُمسّ، والمجهول يُترك', () => {
    expect(dimStrength(1)).toBe(1);
    expect(dimStrength(0.2)).toBe(0);
    expect(dimStrength(0.575)).toBeCloseTo(0.5, 2);
    expect(dimStrength(NaN)).toBe(0);
  });
  it('الزر يبقى «ابدأ للجميع» وفيه كلمة «البدء» لقارئات الشاشة، والتقييم داخله', () => {
    const { document } = parseHTML('<div id="h"></div>');
    vi.stubGlobal('document', document);
    vi.stubGlobal('Image', class { set src(v) { this._s = v; } get src() { return this._s; } });
    const host = document.getElementById('h');
    renderLobby(host, { ...base, selectingSource: false, art: { title: 'W', episodeImage: 'e.jpg', rating: 8.7, ratingSource: 'IMDb', duration: '41 دقيقة' }, accent: '#D6192B', server: { code: 'HGC' }, offset: 0 }, { avatar: () => document.createElement('span'), start() {}, resume() {}, changeServer() {}, leave() {}, setOffset() {}, episodes() {} });
    const go = host.querySelector('.pl-start');
    expect(go.getAttribute('aria-label')).toBe('ابدأ للجميع');
    expect(go.querySelector('.pl-start-label').textContent).toBe('البدء');
    expect(go.querySelector('.pl-start-meta').textContent).toContain('8.7');
    expect(go.querySelector('.pl-start-meta').textContent).toContain('IMDb');
  });
});

import { deniedText, guestsNotReady } from '../../lib/together/lobby.js';
describe('قاعدة البدء: المضيف وحده، والضيوف كلهم جاهزون على الحلقة نفسها', () => {
  it('تقرير حلقة سابقة أو تجهيز أو تعذّر = غير جاهز؛ المضيف ونفسي خارج الحساب', () => {
    const roster = [
      { userId: 'h', name: 'المضيف', host: true, state: 'ready', mediaKey: 'anime:1#2' },
      { userId: 'b', name: 'دحمي', host: false, state: 'playing', mediaKey: 'anime:1#1' },
      { userId: 'c', name: 'منصور', host: false, state: 'ready', mediaKey: 'anime:1#2' },
      { userId: 'd', name: 'مشعل', host: false, state: 'failed', mediaKey: 'anime:1#2' },
    ];
    expect(guestsNotReady(roster, { me: 'h', roomKey: 'anime:1#2' }).map((r) => r.userId)).toEqual(['b', 'd']);
    expect(guestsNotReady(roster.slice(0, 1), { me: 'h', roomKey: 'anime:1#2' })).toEqual([]);
  });
  it('رفض الخادم يقول من ننتظر', () => {
    expect(deniedText({ t: 'denied', reason: 'not_ready', waiting: ['دحمي'] })).toBe('ما نقدر نبدأ: بانتظار دحمي يجهز');
    expect(deniedText({ t: 'denied' })).toBe('الغرفة رفضت الأمر: التحكم بالتشغيل للمضيف');
  });
});
