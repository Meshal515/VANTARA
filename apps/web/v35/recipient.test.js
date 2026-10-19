import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { recipientFace, resolveRecipientAvatar } from './recipient.js';
import { openShareSheet } from './share.js';

const hash = 'ab'.repeat(32);
const mediaUrl = (key) => `https://sync.test/v1/media/${key}`;
const friends = Array.from({ length: 6 }, (_, i) => ({
  userId: `friend-${i}`, displayName: `صديق ${i}`, avatarKey: `/avatars/${i}.webp`,
}));
beforeEach(() => vi.stubGlobal('document', parseHTML('<html><body></body></html>').document));
afterEach(() => vi.unstubAllGlobals());

it('resolves uploaded media hashes and preserves existing avatar URLs', () => {
  expect(resolveRecipientAvatar({ avatar_key: hash }, mediaUrl)).toBe(mediaUrl(hash));
  for (const url of ['/avatars/man.webp', 'https://cdn.test/face.webp', 'blob:https://app.test/avatar']) {
    expect(resolveRecipientAvatar({ avatarKey: url }, mediaUrl)).toBe(url);
  }
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ sync: 'https://configured.test' }) });
  expect(resolveRecipientAvatar(hash)).toBe(`https://configured.test/v1/media/${hash}`);
  for (const invalid of ['javascript:alert(1)', 'data:text/html,hi', '//outside.test/avatar', '../secret', hash + '?foo']) {
    expect(resolveRecipientAvatar(invalid, mediaUrl)).toBeNull();
  }
  expect(resolveRecipientAvatar(hash, () => 'javascript:alert(1)')).toBeNull();
  expect(resolveRecipientAvatar(hash, () => { throw new Error('unavailable'); })).toBeNull();
});

it('uses a real profile image with snake-case fields and initials only without a usable image', () => {
  expect(recipientFace({ display_name: 'ليلى', avatar_key: '/avatars/layla.webp' }).querySelector('img').getAttribute('src')).toBe('/avatars/layla.webp');
  const missing = recipientFace({ displayName: 'ليلى', avatarKey: null });
  expect(missing.querySelector('img')).toBeNull();
  expect(missing.textContent).toBe('ل');
  expect(recipientFace({ displayName: '   ' }).textContent).toBe('؟');
});

it('uses a real image and keeps the same-sized fallback after an image error', () => {
  const face = recipientFace({ displayName: 'سارة', avatarKey: hash }, { size: 58, mediaUrl });
  expect(face.querySelector('img').getAttribute('src')).toBe(mediaUrl(hash));
  expect(face.style.width).toBe('58px');
  const img = face.querySelector('img');
  img.onerror();
  expect(face.querySelector('img')).toBeNull();
  expect(face.textContent).toBe('س');
  expect(face.style.width).toBe('58px');
});

it.each([0, 1, 2, 3, 4, 6])('everyone shows the actual %i friends, capped at three and an accurate fourth count', (count) => {
  const face = recipientFace({ everyone: true }, { friends: friends.slice(0, count), size: 58 });
  expect(face.querySelectorAll('img').length).toBe(Math.min(count, 3));
  expect([...face.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual(friends.slice(0, Math.min(count, 3)).map((f) => f.avatarKey));
  expect(face.querySelector('.recipient-overflow')?.textContent ?? null).toBe(count > 3 ? `+${count - 3}` : null);
  expect(face.children.length).toBe(count ? Math.min(count, 4) : 1);
});

it('renders real avatars through recommendation selection and compose without changing the recipient', () => {
  const body = document.createElement('div');
  const sent = [];
  openShareSheet({
    friends: friends.slice(0, 4).map((f, i) => i ? f : { ...f, avatarKey: hash }), mediaUrl,
    work: { ref: 'manga:one', title: 'عمل', cover: null },
    openSheet: (build) => build(body), sheetBody: () => body,
    closeSheet() {}, toast() {}, sync: { enqueue: (...args) => sent.push(args) },
  });
  expect(body.querySelector('.share-person img').getAttribute('src')).toBe(mediaUrl(hash));
  expect(body.querySelector('.share-person .recipient-overflow').textContent).toBe('+1');
  const firstFriend = body.querySelectorAll('.share-person')[1];
  expect(firstFriend.querySelector('img').getAttribute('src')).toBe(mediaUrl(hash));
  firstFriend.onclick();
  expect(body.querySelector('.share-to img').getAttribute('src')).toBe(mediaUrl(hash));
  expect(body.querySelectorAll('.share-hide img').length).toBe(3);
  body.querySelector('.share-send').onclick();
  expect(sent[0][0]).toBe('recommendation.send');
  expect(sent[0][1].toId).toBe('friend-0');
});

it('retains the everyone avatar stack and broadcast recipient after composing', () => {
  const body = document.createElement('div');
  const sent = [];
  openShareSheet({
    friends, work: { ref: 'manga:one', title: 'عمل', cover: null },
    chapter: { label: 'الفصل الأول', number: 1 },
    openSheet: (build) => build(body), sheetBody: () => body,
    closeSheet() {}, toast() {}, sync: { enqueue: (...args) => sent.push(args) },
  });
  body.querySelector('.share-person').onclick();
  expect(body.querySelectorAll('.share-to img').length).toBe(3);
  expect(body.querySelector('.share-to .recipient-overflow').textContent).toBe('+3');
  const hidden = body.querySelector('.share-hide input');
  hidden.checked = true;
  hidden.onchange();
  body.querySelector('.share-send').onclick();
  expect(sent[0][1]).toMatchObject({ toId: null, hiddenFrom: ['friend-0'], chapterNumber: 1 });
});
