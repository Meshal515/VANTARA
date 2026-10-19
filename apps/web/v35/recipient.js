import { endpoints } from '../lib/config.js';
import { glyph } from './icons.js';

function imageUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || /[\u0000-\u0020\\]/.test(url)) return null;
  if (/^\/(?!\/)/.test(url)) return url;
  if (/^(https?:\/\/|blob:https?:\/\/)/i.test(url)) {
    try { new URL(url); return url; } catch { return null; }
  }
  return null;
}

/** Avatar keys are either an existing image URL or a content-addressed media hash. */
export function resolveRecipientAvatar(personOrKey, mediaUrl) {
  const key = typeof personOrKey === 'string' ? personOrKey : personOrKey?.avatarKey ?? personOrKey?.avatar_key;
  const direct = imageUrl(key);
  if (direct) return direct;
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/i.test(key)) return null;
  try {
    return imageUrl(mediaUrl ? mediaUrl(key) : `${endpoints().sync}/v1/media/${key}`);
  } catch { return null; }
}

function circle(size, className = '') {
  const face = document.createElement('span');
  face.className = `recipient-face avatar-letter ${className}`.trim();
  face.style.cssText = `width:${size}px;height:${size}px;--recipient-size:${size}px`;
  face.setAttribute('aria-hidden', 'true');
  return face;
}

/** Decorative recipient image; the picker supplies the adjacent accessible name. */
export function recipientFace(person, { friends = [], size = 44, mediaUrl } = {}) {
  if (person?.everyone) {
    const people = friends.filter(Boolean);
    if (!people.length) {
      const empty = circle(size, 'share-everyone');
      empty.innerHTML = glyph('users', { size: Math.round(size * 0.42) });
      return empty;
    }
    const stack = document.createElement('span');
    stack.className = 'recipient-stack';
    stack.setAttribute('aria-hidden', 'true');
    stack.style.setProperty('--recipient-size', `${size}px`);
    stack.style.height = `${size}px`;
    for (const friend of people.slice(0, 3)) stack.append(recipientFace(friend, { size, mediaUrl }));
    if (people.length > 3) {
      const remaining = circle(size, 'recipient-overflow');
      remaining.textContent = `+${people.length - 3}`;
      remaining.dir = 'ltr';
      stack.append(remaining);
    }
    return stack;
  }
  const face = circle(size);
  const initial = document.createElement('span');
  initial.className = 'recipient-initial';
  initial.textContent = [...String(person?.displayName || person?.display_name || '؟').trim()][0] || '؟';
  face.append(initial);
  const src = resolveRecipientAvatar(person, mediaUrl);
  if (src) {
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.onerror = () => { img.onerror = null; img.remove(); };
    img.src = src;
    face.append(img);
  }
  return face;
}
