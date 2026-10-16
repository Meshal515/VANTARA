/**
 * ورقة السيرفرات المشتركة بين الأنمي والسينما.
 *
 * كانت مربعات برموز (TRR · TRR2 · HGC) لا يعرف أحد معناها. هنا كل سيرفر صفّ
 * بشري: من أين (WitAnime · StreamWish، Torrentio · Nyaa)، بأي جودة، بأي لغة،
 * وكم يحتاج ليبدأ. فوقها بطاقة «الأفضل لك» تقول لماذا هي الأفضل وتشغّل بلمسة.
 *
 * الترتيب: السيرفرات المباشرة أولًا (تبدأ فورًا)، ثم التورنت (يبدأ أبطأ ويحتاج
 * مشاركين)، وما يُجهَّز بعد وما تعذّر مطويّان. الورقة لا تملك جلسة التشغيل:
 * من يفتحها (الأنمي/السينما) يمرّر السيرفرات وحالتها ويقرّر ماذا يحدث عند اللمس.
 */
import { parseRelease, releaseScore, swarmTier } from '../addons/release-info.js';
import { glyph } from './icons.js';

export const isAddonRoute = (r) => String(r?.sourceId ?? '').startsWith('addon|');

const ADDON_NAMES = { torrentio: 'Torrentio', comet: 'Comet', mediafusion: 'MediaFusion', knightcrawler: 'KnightCrawler', jackettio: 'Jackettio', peerflix: 'Peerflix', orion: 'Orion', annatar: 'Annatar', torbox: 'TorBox', debridio: 'Debridio' };
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * اسم إضافة من معرّفها الداخلي «addon|https://torrentio.strem.fun|com.stremio.torrentio.addon»:
 * «Torrentio». المضيف أصدق من المعرّف؛ comet.elfhosted.com ← Comet.
 */
export function addonName(sourceId) {
  const [, url = '', id = ''] = String(sourceId ?? '').split('|');
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = /^[a-z0-9.-]+$/i.test(url) ? url : ''; }
  for (const part of [...host.split('.'), ...id.split('.')]) {
    const known = ADDON_NAMES[part.toLowerCase()];
    if (known) return known;
  }
  const first = host.split('.')[0];
  if (first && !/^(?:addon|api|stremio|app)$/i.test(first)) return capital(first);
  const tail = id.split('.').filter((p) => !/^(?:com|org|net|io|stremio|addon|app)$/i.test(p))[0];
  return tail ? capital(tail) : 'إضافة';
}

/** اسم مصدر للعرض: الاسم المعروف، ثم عنوان نسخة الإضافة، ثم ما يُستخرج من معرّفها. */
export function sourceLabel(sourceId, { names = {}, title = null } = {}) {
  if (names[sourceId]) return names[sourceId];
  if (isAddonRoute({ sourceId })) return (title && !/^addon\|/.test(title) ? title : null) ?? addonName(sourceId);
  return sourceId;
}

const HOSTS = { streamwish: 'StreamWish', hgcloud: 'HG Cloud', mp4upload: 'Mp4Upload', 'ok.ru': 'OK.ru', okru: 'OK.ru', videa: 'Videa', megamax: 'Megamax', doodstream: 'DoodStream', dood: 'DoodStream', voe: 'VOE', filemoon: 'FileMoon', vidmoly: 'Vidmoly', uqload: 'Uqload', streamtape: 'Streamtape', mixdrop: 'Mixdrop', sendvid: 'SendVid', vidguard: 'VidGuard', lulustream: 'LuluStream', mega: 'MEGA', yourupload: 'YourUpload', 'vk.com': 'VK', vk: 'VK', drive: 'Google Drive', gdrive: 'Google Drive', dailymotion: 'Dailymotion', streamhg: 'StreamHG', earnvids: 'EarnVids', vidhide: 'VidHide' };
/** اسم استضافة مقروء: «streamwish» ← StreamWish. الأسماء العربية تبقى كما هي. */
export function hostName(server) {
  const s = String(server ?? '').trim();
  if (!s) return null;
  if (/[؀-ۿ]/.test(s)) return s;
  const key = s.toLowerCase().replace(/^www\./, '').replace(/\.(?:com|net|org|io|to|tv|cc|pro|co|xyz|sx)$/, '');
  return HOSTS[key] ?? HOSTS[s.toLowerCase()] ?? (/^[a-z0-9.-]+$/.test(s) ? capital(key) : s);
}

/** فرقة الإصدار من اسم الملف: «[SubsPlease] …» أو «…-VARYG». */
export function releaseGroup(filename) {
  const f = String(filename ?? '').replace(/\.(?:mkv|mp4|avi|webm)$/i, '');
  return /^\[([^\]]{2,24})\]/.exec(f)?.[1] ?? /-([A-Za-z][A-Za-z0-9]{1,15})$/.exec(f)?.[1] ?? null;
}

const bucket = (q) => (!Number.isFinite(q) || q <= 0 ? null : q >= 2000 ? 2160 : q >= 1400 ? 1440 : q >= 1000 ? 1080 : q >= 700 ? 720 : 480);
export const qualityLabel = (b) => (b == null ? 'تلقائي' : b === 2160 ? '4K' : b === 480 ? 'SD' : `${b}p`);
const QUALITY_PREF = { 1080: 5, 2160: 4, 1440: 4, 720: 3, 480: 1 };

/** ما يحتاجه الصف ليُرسم: الاسم والنوع والجودة واللغة والصحة. */
export function describe(r, ctx = {}) {
  const torrent = isAddonRoute(r) || r.runtimeReady != null;
  const info = isAddonRoute(r) && r.label ? parseRelease(r.sourceName ?? r.server ?? '', r.label) : null;
  const q = bucket(r.quality ?? info?.quality);
  const name = torrent ? (info?.provider || r.sourceName || ctx.sourceName?.(r) || 'إضافة') : ctx.sourceName?.(r) ?? r.sourceName ?? r.sourceId ?? 'سيرفر';
  const host = torrent ? ([...new Set([info?.site, releaseGroup(info?.filename)].filter(Boolean))].join(' · ') || info?.filename) : hostName(r.server) ?? (r.code && !/^[A-Z0-9]{2,5}$/.test(r.code) ? r.code : null);
  const langs = [];
  if (torrent) {
    if (info?.arabic) langs.push({ t: 'عربي', ar: true });
    if (info?.multiAudio) langs.push({ t: 'صوت متعدد' });
    else if (r.variant === 'DUB' || info?.dubbed) langs.push({ t: 'مدبلج' });
    if (info?.multiSubs && !info?.arabic) langs.push({ t: 'ترجمات متعددة' });
  } else if (r.variant === 'DUB') langs.push({ t: ctx.dubLabel ?? 'مدبلج', ar: true });
  else if (ctx.directLang) langs.push({ t: ctx.directLang, ar: true });
  const tier = info ? swarmTier(info.seeders) : null;
  return { torrent, info, q, name: String(name), host: host && host !== name ? host : null, langs, tier, hdr: info?.hdr ?? [], prefer: Boolean(ctx.prefer && r.code === ctx.prefer) };
}

/** بدء التشغيل المتوقّع للسيرفر المباشر من زمن فحصه. */
export function speedHint(r) {
  const ms = Number(r.probeMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1500) return 'يبدأ فورًا';
  if (ms < 4000) return 'بدء سريع';
  return 'بدء أبطأ';
}

/**
 * «الأفضل لك» بين ما يمكن تشغيله الآن: المباشر يسبق التورنت (يبدأ فورًا)،
 * سيرفرك السابق يتقدّم، ثم الجودة (1080 قبل 4K: يبدأ أسرع)، ثم العربية،
 * وفي التورنت قوة السرب أولًا. ترشيح لا قفل: كل صف ما زال يُلمس.
 */
export function rank(r, d) {
  if (!d.torrent) {
    const ms = Number(r.probeMs);
    return 3e9 + (d.prefer ? 5e8 : 0) + (QUALITY_PREF[d.q] ?? 2) * 1e7 + (r.variant === 'DUB' ? 0 : 1e6) - (Number.isFinite(ms) ? Math.min(ms, 9e5) : 5e5);
  }
  const tier = d.tier;
  if (tier === 'dead' || d.info?.source === 'CAM') return releaseScore(d.info);
  // ملف ضخم (ريمكس 60 GB) لا يُبثّ بسلاسة على اتصال عادي: يتأخر في الترشيح ويبقى في القائمة
  const huge = (d.info?.size ?? 0) > 20 * 1024 ** 3 ? 6e7 : 0;
  return 1e9 + (d.prefer ? 5e8 : 0) + ({ strong: 4, fair: 3, weak: 1 }[tier] ?? 2) * 1e8 + (d.info?.arabic ? 5e7 : 0) + (QUALITY_PREF[d.q] ?? 2) * 1e7 - huge + Math.min(d.info?.seeders ?? 0, 99999);
}

/** ترتيب صفوف التورنت: الأصح سربًا ثم الأعلى جودة ثم العربية ثم المشاركون. */
function torrentOrder(a, b) {
  const t = (d) => ({ strong: 4, fair: 3, weak: 1, dead: 0 }[d.tier] ?? 2) - (d.info?.source === 'CAM' ? 9 : 0);
  return t(b.d) - t(a.d) || (b.d.q ?? 0) - (a.d.q ?? 0) || Number(Boolean(b.d.info?.arabic)) - Number(Boolean(a.d.info?.arabic)) || (b.d.info?.seeders ?? 0) - (a.d.info?.seeders ?? 0);
}

const METER = { dead: 0, weak: 1, fair: 2, strong: 3 };
const meterBars = (d) => {
  const s = d.info?.seeders;
  if (!Number.isFinite(s)) return -1;
  return s >= 100 ? 4 : METER[d.tier] ?? 0;
};
const compact = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

/** ما يقال عن الصف في سطره الثاني. */
function metaChips(r, d, pending) {
  const out = [];
  if (d.torrent) {
    for (const l of d.langs) out.push({ t: l.t, cls: l.ar ? 'ar' : 'lang' });
    if (d.info?.source === 'CAM') out.push({ t: 'CAM', cls: 'cam' });
    if (d.info?.sizeLabel) out.push({ t: d.info.sizeLabel, cls: 'spec' });
    if (d.info?.source && d.info.source !== 'CAM') out.push({ t: d.info.source, cls: 'spec' });
    if (d.info?.codec) out.push({ t: d.info.codec, cls: 'spec' });
    if (d.info?.audio) out.push({ t: d.info.audio, cls: 'spec' });
    // سطر واحد لا يُقصّ في منتصف كلمة: اللغات أولًا ثم الأهم من المواصفات
    return out.slice(0, d.langs.length > 1 ? 4 : 5);
  } else {
    for (const l of d.langs) out.push({ t: l.t, cls: l.ar ? 'ar' : 'lang' });
    const sp = !pending && speedHint(r);
    if (sp) out.push({ t: sp, cls: 'speed' });
    if (d.prefer) out.push({ t: 'سيرفرك السابق', cls: 'prefer' });
  }
  return out;
}

/**
 * يبني الورقة داخل `body` ويعيد {update, best, status}.
 * o: { el, title, kicker, hero, onBack, onPick(r), onBest(), onRetry(), onUnavailable(r),
 *      selectable(r), pending(r), dead(r), sourceName(r), prefer, directLang, extraFoot[] }
 */
export function createServerSheet(body, o) {
  const el = o.el;
  const btn = (cls, html, label) => {
    const b = el('button', cls);
    b.type = 'button';
    if (html) b.innerHTML = html;
    if (label) b.setAttribute('aria-label', label);
    return b;
  };
  body.classList.add('an-pick', 'ss');
  const bar = el('header', 'an-pick-bar');
  const back = btn('an-pick-back', glyph('back', { size: 22 }), 'رجوع');
  back.onclick = () => o.onBack?.();
  const heading = el('div', 'an-pick-heading');
  const name = el('span', 'an-pick-anime');
  name.dir = 'rtl';
  name.textContent = [o.kicker, o.title].filter(Boolean).join(' · ');
  heading.append(el('b', null, 'اختر السيرفر'), name);
  bar.append(back, heading);

  const scroll = el('div', 'an-pick-scroll');
  const rec = el('section', 'ss-rec ss-rec--loading');
  rec.setAttribute('aria-live', 'polite');
  const status = el('div', 'an-srv-status');
  const filters = el('div', 'an-pick-filters');
  const list = el('div', 'an-srv-list');
  scroll.append(...[o.hero, rec, filters, status, list].filter(Boolean));

  const foot = el('footer', 'an-pick-foot');
  const best = btn('an-pick-best');
  foot.append(best, ...(o.extraFoot ?? []));
  body.append(bar, scroll, foot);

  const filter = { q: 'all', v: null };
  // ما لمسه المستخدم: صفّه يقول «يبدأ…» حتى يفتح المشغّل
  let picked = null;
  const pick = (r) => {
    picked = r.id;
    return o.onPick(r);
  };
  const rows = new Map();
  const views = new Map();
  const view = (r) => {
    // الوصف يتغيّر بتغيّر الحالة لا بغيرها: يُحسب مرة لكل نسخة من السيرفر
    const key = `${r.label ?? ''}|${r.quality}|${r.variant}|${r.server}`;
    const hit = views.get(r.id);
    if (hit?.key === key) return hit.d;
    const d = describe(r, { sourceName: o.sourceName, prefer: o.prefer, directLang: o.directLang });
    views.set(r.id, { key, d });
    return d;
  };

  const section = (cls, title, sub) => {
    const s = el('section', `an-srv-group ${cls}`);
    const h = el('h4', 'an-srv-q');
    const t = el('b', null, title);
    const count = el('span', 'ss-count');
    h.append(t, count);
    if (sub) h.append(el('span', 'ss-sub', sub));
    const grid = el('div', 'an-srv-grid');
    const more = el('details', 'cn-srv-dead an-srv-more');
    const summary = el('summary');
    const moreGrid = el('div', 'an-srv-grid');
    more.append(summary, moreGrid);
    s.append(h, grid, more);
    return { s, count, grid, more, summary, moreGrid };
  };
  const direct = section('ss-group--direct', 'سيرفرات مباشرة', 'تبدأ خلال ثوانٍ');
  const torrent = section('ss-group--torrent', 'تورنت', 'يبدأ أبطأ · جودة وحجم أعلى');
  const fold = (cls) => {
    const d = el('details', `cn-srv-dead ${cls}`);
    const summary = el('summary');
    const grid = el('div', 'an-srv-grid');
    d.append(summary, grid);
    return { d, summary, grid };
  };
  const wait = fold('cn-srv-wait');
  const dead = fold('ss-dead');
  const skeleton = el('div', 'ss-skel-list');
  for (let i = 0; i < 4; i++) {
    const sk = el('div', 'ss-skel');
    sk.innerHTML = '<i class="ss-shim ss-shim--box"></i><span><i class="ss-shim ss-shim--a"></i><i class="ss-shim ss-shim--b"></i></span>';
    skeleton.append(sk);
  }

  const reconcile = (parent, nodes) => {
    nodes.forEach((node, i) => {
      if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] ?? null);
    });
    while (parent.children.length > nodes.length) parent.lastElementChild.remove();
  };

  const isPending = (r) => o.pending?.(r) ?? r.state === 'RESOLVING';
  const isDead = (r) => o.dead?.(r) ?? (r.state === 'UNAVAILABLE' || r.state === 'FAILED');
  const isSelectable = (r) => o.selectable?.(r) ?? r.state === 'READY';

  function chipNode(c) {
    const i = el('i', `ss-chip ss-chip--${c.cls}`);
    // «2.1 GB» يبقى بترتيبه داخل سطر عربي، والفاصل بين الرقائق في جهته الصحيحة
    if (/[A-Za-z0-9]/.test(c.t) && !/[\u0600-\u06FF]/.test(c.t)) {
      const b = el('bdi', null, c.t);
      b.dir = 'ltr';
      i.append(b);
    } else i.textContent = c.t;
    if (c.cls === 'ar') i.classList.add('an-srv-lang--ar');
    return i;
  }

  function row(r) {
    const d = view(r);
    const pending = isPending(r);
    const selectable = isSelectable(r);
    const gone = !pending && !selectable;
    let b = rows.get(r.id);
    if (!b) {
      b = el('button');
      b.type = 'button';
      b.innerHTML = '<span class="ss-q"><b dir="ltr"></b><small dir="ltr"></small></span><span class="ss-main"><span class="ss-line"><b class="ss-name" dir="auto"></b><span class="ss-host" dir="auto"></span></span><span class="ss-meta"></span></span><span class="ss-end"></span>';
      rows.set(r.id, b);
    }
    const stateCls = pending ? 'resolving' : selectable ? 'ready' : String(r.state ?? 'unavailable').toLowerCase();
    b.className = `an-srv ss-row ss-row--${d.torrent ? 'torrent' : 'direct'} an-srv--${stateCls}${d.tier ? ` an-srv--swarm-${d.tier}` : ''}${d.prefer ? ' an-srv--prefer' : ''}${d.q === 2160 ? ' ss-row--uhd' : ''}`;
    b.disabled = pending;
    const qb = b.querySelector('.ss-q');
    qb.firstElementChild.textContent = d.q == null ? 'HD' : d.q === 2160 ? '4K' : d.q === 480 ? 'SD' : String(d.q);
    qb.lastElementChild.textContent = d.hdr.length ? d.hdr[0] : ({ 2160: 'UHD', 1440: 'QHD', 1080: 'FHD', 720: 'HD' })[d.q] ?? '';
    qb.classList.toggle('ss-q--hdr', d.hdr.length > 0);
    b.querySelector('.ss-name').textContent = d.name;
    const host = b.querySelector('.ss-host');
    host.textContent = d.host ?? '';
    host.hidden = !d.host;
    b.querySelector('.ss-meta').replaceChildren(...metaChips(r, d, pending).map(chipNode));
    const end = b.querySelector('.ss-end');
    const starting = Boolean(last.busy && picked === r.id);
    b.classList.toggle('ss-row--busy', starting);
    if (starting) end.innerHTML = '<i class="ss-spin"></i><small>يبدأ…</small>';
    else if (pending) end.innerHTML = '<i class="ss-spin"></i><small>نفحص…</small>';
    else if (gone) end.innerHTML = `<small class="ss-bad">${r.state === 'FAILED' ? 'تعذّر' : 'غير متاح'}</small>`;
    else if (d.torrent) {
      const bars = meterBars(d);
      const meter = Array.from({ length: 4 }, (_, i) => `<i${i < bars ? ' class="on"' : ''}></i>`).join('');
      end.innerHTML = bars < 0
        ? `<span class="ss-meter ss-meter--none">${meter}</span><small>غير معلن</small>`
        : `<b class="an-srv-seeds" dir="ltr">${compact(d.info.seeders)}</b><span class="ss-meter ss-meter--${d.tier}" aria-hidden="true">${meter}</span>`;
    } else end.innerHTML = `<span class="ss-play">${glyph('play', { size: 14, filled: true })}</span>`;
    const why = [d.name, d.host, qualityLabel(d.q), ...d.langs.map((l) => l.t), d.torrent && Number.isFinite(d.info?.seeders) ? `${d.info.seeders} مشارك` : null, pending ? 'نفحص التشغيل' : gone ? 'غير متاح' : null].filter(Boolean).join('، ');
    b.setAttribute('aria-label', why);
    b.title = d.info?.filename ?? r.label ?? '';
    b.onclick = () => (selectable ? pick(r) : o.onUnavailable?.(r));
    return b;
  }

  function recCard(r, model) {
    rec.className = 'ss-rec';
    const d = view(r);
    const reasons = [];
    if (!d.torrent) reasons.push({ t: speedHint(r) ?? 'سيرفر مباشر · يبدأ فورًا', cls: 'speed', icon: 'bolt' });
    else if (Number.isFinite(d.info?.seeders)) reasons.push({ t: `${d.info.seeders.toLocaleString('en')} مشارك · ${({ strong: 'سرب قوي', fair: 'سرب متوسط', weak: 'سرب ضعيف', dead: 'بلا مشاركين' })[d.tier]}`, cls: 'speed' });
    else reasons.push({ t: 'تورنت', cls: 'kind' });
    for (const l of d.langs) reasons.push({ t: l.t, cls: l.ar ? 'ar' : 'lang' });
    if (d.prefer) reasons.push({ t: 'سيرفرك السابق', cls: 'prefer' });
    if (d.torrent && d.info?.sizeLabel) reasons.push({ t: d.info.sizeLabel, cls: 'spec', ltr: true });
    const play = btn('ss-rec-play', glyph('play', { size: 22, filled: true }), `شغّل ${d.name} ${qualityLabel(d.q)}`);
    play.disabled = model.busy;
    const head = el('div', 'ss-rec-head');
    head.innerHTML = `${glyph('spark', { size: 14 })}<span>الأفضل لك</span>`;
    const main = el('div', 'ss-rec-main');
    const q = el('span', `ss-rec-q${d.q === 2160 ? ' ss-rec-q--uhd' : ''}`);
    q.dir = 'ltr';
    q.textContent = qualityLabel(d.q);
    const copy = el('div', 'ss-rec-copy');
    const nm = el('b', 'ss-rec-name', d.name);
    nm.dir = 'auto';
    copy.append(nm);
    if (d.host) {
      const h = el('span', 'ss-rec-host', d.host);
      h.dir = 'auto';
      copy.append(h);
    }
    main.append(q, copy, play);
    const why = el('div', 'ss-rec-why');
    why.append(...reasons.map((c) => {
      const n = chipNode(c);
      if (c.icon) n.insertAdjacentHTML('afterbegin', glyph(c.icon, { size: 12, filled: true }));
      return n;
    }));
    rec.replaceChildren(head, main, why);
    rec.onclick = () => {
      if (!model.busy) pick(r);
    };
  }

  function recEmpty(model) {
    if (model.settled || model.missing || model.error) {
      rec.className = 'ss-rec ss-rec--empty';
      rec.onclick = null;
      const msg = model.missing ? 'لم نجد هذه الحلقة في المصادر الآن' : model.error ? 'تعذّر الوصول إلى المصادر' : 'لم يجهز أي سيرفر الآن';
      rec.innerHTML = `<div class="ss-rec-head">${glyph('info', { size: 14 })}<span>${msg}</span></div><p class="ss-rec-note">${model.missing ? 'جرّب لاحقًا، أو فعّل مصادر أخرى من الإعدادات.' : 'أعد المحاولة بعد لحظات — كثيرًا ما تعود السيرفرات سريعًا.'}</p>`;
      return;
    }
    rec.className = 'ss-rec ss-rec--loading';
    rec.onclick = null;
    rec.innerHTML = `<div class="ss-rec-head"><i class="ss-spin"></i><span>نختار لك الأفضل…</span></div><div class="ss-rec-main"><span class="ss-shim ss-shim--q"></span><span class="ss-rec-copy"><span class="ss-shim ss-shim--a"></span><span class="ss-shim ss-shim--b"></span></span></div>`;
  }

  const seg = (items, active, onPick, label) => {
    const g = el('div', 'ss-seg');
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', label);
    for (const [key, text] of items) {
      const b = btn(`ss-seg-btn${key === active ? ' on' : ''}`);
      b.textContent = text;
      b.setAttribute('aria-pressed', String(key === active));
      b.onclick = () => onPick(key);
      g.append(b);
    }
    return g;
  };

  let last = { routes: [] };
  function paintFilters(routes) {
    const live = routes.filter((r) => !isDead(r));
    const qs = [...new Set(live.map((r) => view(r).q).filter((x) => x != null))].sort((a, b) => b - a);
    if (filter.q !== 'all' && !qs.includes(filter.q)) filter.q = 'all';
    const dub = live.some((r) => r.variant === 'DUB');
    const sub = live.some((r) => r.variant !== 'DUB');
    if (!(dub && sub)) filter.v = null;
    const parts = [];
    if (qs.length > 1) parts.push(seg([['all', 'الكل'], ...qs.map((x) => [x, qualityLabel(x)])], filter.q, (k) => { filter.q = k; update(last); }, 'الجودة'));
    // اللغة زرّان يُلغى المختار منهما بلمسة ثانية: سطر واحد يتّسع للجودة واللغة معًا
    if (dub && sub) parts.push(seg([['SUB', 'مترجم'], ['DUB', 'مدبلج']], filter.v, (k) => { filter.v = filter.v === k ? null : k; update(last); }, 'اللغة'));
    filters.replaceChildren(...parts);
    filters.hidden = !parts.length;
  }
  const passes = (r) => (filter.q === 'all' || view(r).q === filter.q) && (filter.v == null || (filter.v === 'DUB') === (r.variant === 'DUB'));

  /**
   * model: { routes, busy, settled, missing, error, status: {text, spin}, retry: null | {wait} }
   */
  function update(model) {
    last = model;
    const routes = model.routes ?? [];
    paintFilters(routes);
    const shown = routes.filter(passes);
    const ready = shown.filter(isSelectable);
    const anyReady = routes.some(isSelectable);
    const scored = ready.map((r) => ({ r, s: rank(r, view(r)) })).sort((a, b) => b.s - a.s);
    const top = scored[0]?.r ?? null;
    if (top) recCard(top, model);
    else recEmpty(model);

    // سطر الحالة
    const st = model.status ?? {};
    status.replaceChildren();
    if (st.spin) status.append(el('i', 'an-sources-spin'));
    status.append(el('span', null, st.text ?? ''));
    status.classList.toggle('ss-status--warn', Boolean(model.error || model.missing));
    // بطاقة «الأفضل لك» تقول الحال حين لا جاهز ولا انتظار: لا سطر يكرّرها
    status.hidden = !top && Boolean(model.settled || model.missing || model.error);

    // المباشر ثم التورنت؛ ما يُجهَّز بعد (حين يوجد جاهز) وما تعذّر مطويّان
    const pend = shown.filter(isPending);
    const gone = shown.filter((r) => !isPending(r) && !isSelectable(r));
    const live = shown.filter((r) => isSelectable(r) || (isPending(r) && !anyReady));
    const directLive = live.filter((r) => !view(r).torrent)
      .map((r) => ({ r, s: isSelectable(r) ? rank(r, view(r)) : 0 }))
      .sort((a, b) => b.s - a.s).map((x) => x.r);
    const torrentLive = live.filter((r) => view(r).torrent).map((r) => ({ r, d: view(r) })).sort(torrentOrder).map((x) => x.r);

    const fill = (g, items, cap, weak) => {
      const main = [];
      const extra = [];
      for (const r of items) ((weak?.(r) || main.length >= cap) ? extra : main).push(row(r));
      reconcile(g.grid, main);
      reconcile(g.moreGrid, extra);
      g.more.hidden = !extra.length;
      g.summary.textContent = `نسخ إضافية (${extra.length})`;
      g.count.textContent = String(items.length);
      g.s.hidden = !items.length;
    };
    fill(direct, directLive, 8);
    fill(torrent, torrentLive, 6, (r) => {
      const d = view(r);
      return d.tier === 'dead' || d.info?.source === 'CAM';
    });
    // ترتيب الأقسام ثابت: مباشر، تورنت، يُجهَّز، غير متاح
    const waiting = anyReady ? pend : [];
    reconcile(wait.grid, waiting.map(row));
    wait.summary.textContent = `تُجهَّز بالخلفية (${waiting.length})`;
    reconcile(dead.grid, gone.map(row));
    dead.summary.textContent = `غير متاح الآن (${gone.length})`;
    const loading = !routes.length && !model.settled && !model.missing && !model.error;
    const order = [
      loading ? skeleton : null,
      directLive.length ? direct.s : null,
      torrentLive.length ? torrent.s : null,
      waiting.length ? wait.d : null,
      gone.length ? dead.d : null,
    ].filter(Boolean);
    reconcile(list, order);
    if (!order.length && routes.length) list.replaceChildren(el('p', 'ss-none', 'لا سيرفر بهذا الاختيار — جرّب جودة أو لغة أخرى'));

    // الزر الثابت أسفل الورقة: يشغّل نفس «الأفضل لك»، أو ينتظر أول جاهز
    best.classList.remove('waiting');
    if (model.retry) {
      const w = model.retry.wait;
      best.disabled = w > 0;
      best.innerHTML = `${glyph('refresh', { size: 20 })}<span>${w ? `أعد المحاولة بعد ${w} ث` : 'أعد المحاولة'}</span>`;
      best.onclick = () => o.onRetry?.();
      return;
    }
    best.disabled = Boolean(model.busy || model.missing || (!top && (model.settled || (filter.q !== 'all' || filter.v != null))));
    best.classList.toggle('waiting', !top && !model.settled && !model.missing);
    const td = top ? view(top) : null;
    const label = model.busy ? 'نجهّز التشغيل…' : top ? 'شغّل الأفضل' : model.settled ? 'لا سيرفر جاهز' : 'شغّل أول سيرفر يجهز';
    best.innerHTML = `${glyph('play', { size: 20, filled: true })}<span class="ss-best-copy"><span>${label}</span>${td && !model.busy ? `<small dir="auto"></small>` : ''}</span>`;
    const small = best.querySelector('small');
    if (small) small.textContent = `${td.name} · ${qualityLabel(td.q)}`;
    best.onclick = () => {
      if (best.disabled) return;
      if (top) pick(top);
      else o.onBest?.();
    };
  }

  return { update, best, status, body, scroll };
}
