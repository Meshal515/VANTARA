import { glyph } from './icons.js';
import { duration } from './insights.js';

const element = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

/** سطر صغير داخل صفحة العمل فقط. نتيجة كل صديق تأتي من endpoint مفوّض. */
export async function paintWorkInsights(host, { sync, ref, openProfile, mediaUrl }) {
  const owner = sync.user?.userId;
  if (!owner || !host) return;
  const accounts = sync.rows('accounts');
  const replies = await Promise.all(accounts.map(async (a) => ({ user: a, data: await sync.insights(a.user_id, ref) })));
  if (!host.isConnected || host.dataset.ref !== String(ref) || owner !== sync.user?.userId) return;
  host.replaceChildren();
  for (const { user, data } of replies) {
    const item = data?.content?.find((x) => x.seriesRef === ref);
    if (!item || (!item.activeMs && !item.completed)) continue;
    const line = element('div', 'work-insights-line');
    if (user.user_id !== owner) {
      const profile = sync.rows('profiles', (p) => p.user_id === user.user_id)[0];
      const avatar = profile?.avatar_key ? element('img') : element('span', 'insights-avatar', (profile?.display_name || user.username || '?').slice(0, 1));
      if (profile?.avatar_key) { avatar.src = profile.avatar_key; avatar.alt = ''; }
      const b = element('button', 'work-insights-person');
      b.type = 'button';
      b.append(avatar, element('bdi', null, profile?.display_name || user.username));
      b.onclick = () => openProfile(user.user_id);
      line.append(b);
    }
    if (data.timeShared && item.activeMs) {
      const s = element('span');
      s.innerHTML = glyph('clock', { size: 16 });
      s.append(element('bdi', null, duration(item.activeMs)));
      line.append(s);
    }
    if (data.progressShared && item.completed) {
      const s = element('span');
      s.innerHTML = glyph(item.section === 'anime' ? 'play' : 'book', { size: 16 });
      s.append(element('bdi', null, `${item.completed} ${item.section === 'anime' ? 'حلقة' : 'فصل'}`));
      line.append(s);
    }
    host.append(line);
  }
}
