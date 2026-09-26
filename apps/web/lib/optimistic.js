/**
 * أثر الكتابة قبل أن يردّ الخادم.
 *
 * الواجهة كانت تنتظر رحلة كاملة (إرسال ← كتابة ← سحب) قبل أن يتغير القلب أو
 * تختفي نقطة الإشعار: ثانية أو أكثر لكل لمسة. هنا لكل عملية «إسقاط»: ما
 * ستصير إليه صفوف المرآة إن نجحت. الإسقاطات طبقة فوق المرآة لا داخلها:
 *
 *   - المرآة تبقى ما قاله الخادم، والطبقة تُحسب من الطابور نفسه.
 *   - سحبٌ يصل قبل أن تُرسل الكتابة لا يُرجع القلب: الطبقة تُعاد فوقه.
 *   - عملية عُزلت (رفضها الخادم) تخرج من الطابور فتسقط طبقتها وحدها — لا
 *     «تراجع» يُكتب يدويًّا، ولا صفٌّ متفائل يبقى في المرآة إلى الأبد.
 *
 * كل إسقاط دالة نقية: `(op, get, userId) => [{ table, key, row }]`، و`get`
 * يقرأ الصف كما هو حتى الآن (المرآة ثم ما قبله من الطابور).
 */

const now = () => Date.now();

function collection(kind) {
  return (op, get, userId) => {
    const p = op.payload ?? {};
    if (!p.seriesRef) return [];
    const key = `${userId}/${kind}/${p.seriesRef}`;
    const prev = get('collections', key);
    return [
      {
        table: 'collections',
        key,
        row: {
          ...(prev ?? { user_id: userId, kind, series_ref: p.seriesRef, position: p.position ?? null }),
          member: p.member === false ? 0 : 1,
          updated_at: now(),
        },
      },
    ];
  };
}

export const PROJECTIONS = {
  'notification.read': (op, get) => {
    const prev = get('notifications', op.payload?.id);
    return prev ? [{ table: 'notifications', key: prev.id, row: { ...prev, read: 1, seen: 1 } }] : [];
  },
  'notification.seen': (op, get) => {
    const prev = get('notifications', op.payload?.id);
    return prev ? [{ table: 'notifications', key: prev.id, row: { ...prev, seen: 1 } }] : [];
  },
  'favorite.set': collection('favorite'),
  'readLater.set': collection('read_later'),
  'top.set': collection('top'),
  'completed.set': (op, get, userId) => {
    const p = op.payload ?? {};
    if (!p.seriesRef) return [];
    const key = `${userId}/${p.seriesRef}`;
    return [{ table: 'completions', key, row: { user_id: userId, series_ref: p.seriesRef, member: p.member === false ? 0 : 1, updated_at: now() } }];
  },
  'library.add': (op, get, userId) => {
    const p = op.payload ?? {};
    if (!p.seriesRef) return [];
    const key = `${userId}/${p.seriesRef}`;
    const prev = get('library', key);
    return [
      {
        table: 'library',
        key,
        row: {
          ...(prev ?? { user_id: userId, series_ref: p.seriesRef, added_at: now() }),
          series_title: p.seriesTitle ?? prev?.series_title ?? null,
          cover_url: p.coverUrl ?? prev?.cover_url ?? null,
          source_id: p.sourceId ?? prev?.source_id ?? null,
          removed: 0,
        },
      },
    ];
  },
  'library.remove': (op, get, userId) => {
    const key = `${userId}/${op.payload?.seriesRef}`;
    const prev = get('library', key);
    return prev ? [{ table: 'library', key, row: { ...prev, removed: 1 } }] : [];
  },
  'chapter.mark': (op, get, userId) => {
    const p = op.payload ?? {};
    if (!p.chapterKey) return [];
    const key = `${userId}/${p.chapterKey}`;
    return [
      {
        table: 'chapter_marks',
        key,
        row: { ...(get('chapter_marks', key) ?? {}), user_id: userId, chapter_key: p.chapterKey, series_ref: p.seriesRef, read: p.read ? 1 : 0, updated_at: now() },
      },
    ];
  },
  'chapter.markMany': (op, get, userId, mirror) => {
    const p = op.payload ?? {};
    const t = now();
    if (p.all && p.read === false) {
      return Object.values(mirror?.chapter_marks ?? {})
        .filter((r) => r.user_id === userId && r.series_ref === p.seriesRef && r.read)
        .map((r) => ({ table: 'chapter_marks', key: `${userId}/${r.chapter_key}`, row: { ...r, read: 0, updated_at: t } }));
    }
    return (p.keys ?? []).map((key) => ({
      table: 'chapter_marks',
      key: `${userId}/${key}`,
      row: { user_id: userId, chapter_key: key, series_ref: p.seriesRef, read: p.read ? 1 : 0, updated_at: t },
    }));
  },
  'rating.set': (op, get, userId) => {
    const p = op.payload ?? {};
    const key = `${userId}/${p.seriesRef}`;
    return [{ table: 'ratings', key, row: { ...(get('ratings', key) ?? {}), user_id: userId, series_ref: p.seriesRef, score: p.score, updated_at: now() } }];
  },
  'majlis.react': (op, get, userId) => {
    const p = op.payload ?? {};
    const key = `${p.targetKind}/${p.targetId}/${userId}`;
    return [
      {
        table: 'majlis_reactions',
        key,
        row: { target_kind: p.targetKind, target_id: p.targetId, user_id: userId, emoji: p.emoji ?? null, updated_at: now() },
      },
    ];
  },
  'majlis.receipt': (op, get, userId) => {
    const p = op.payload ?? {};
    const key = `${p.targetKind}/${p.targetId}/${userId}`;
    const prev = get('majlis_receipts', key);
    const t = now();
    return [
      {
        table: 'majlis_receipts',
        key,
        row: {
          target_kind: p.targetKind,
          target_id: p.targetId,
          user_id: userId,
          delivered_at: prev?.delivered_at ?? t,
          seen_at: prev?.seen_at ?? (p.seen ? t : null),
        },
      },
    ];
  },
  'view.add': (op, get, userId) => {
    const p = op.payload ?? {};
    if (!p.seriesRef) return [];
    const key = `${userId}/${p.seriesRef}`;
    const prev = get('work_views', key);
    const at = p.at ?? now();
    return [
      {
        table: 'work_views',
        key,
        row: {
          ...(prev ?? {}),
          user_id: userId,
          series_ref: p.seriesRef,
          series_title: p.seriesTitle ?? prev?.series_title ?? null,
          cover_url: p.coverUrl ?? prev?.cover_url ?? null,
          chapter_label: p.chapterLabel ?? prev?.chapter_label ?? null,
          chapter_number: p.chapterNumber ?? prev?.chapter_number ?? null,
          viewed_at: Math.max(prev?.viewed_at ?? 0, at),
          removed: prev && prev.removed && at <= prev.viewed_at ? 1 : 0,
        },
      },
    ];
  },
  'view.remove': (op, get, userId) => {
    const key = `${userId}/${op.payload?.seriesRef}`;
    const prev = get('work_views', key);
    return prev ? [{ table: 'work_views', key, row: { ...prev, removed: 1 } }] : [];
  },
  // رسالتك تظهر في المجلس لحظة الإرسال بـ«يُرسَل…»، ثم يحلّ صفّ الخادم محلها
  // بنفس المعرّف (op_id هو معرّف الفريم والترشيح عند الخادم)
  // «حذف للجميع»: يختفي من شاشتك فورًا، والخادم يسحبه من عند الكل
  'majlis.unsend': (op, get) => {
    const p = op.payload ?? {};
    const table = { frame: 'frames', rec: 'recommendations', activity: 'activity' }[p.targetKind];
    const prev = table ? get(table, p.targetId) : null;
    return prev ? [{ table, key: p.targetId, row: { ...prev, removed: 1 } }] : [];
  },
  'frame.send': (op, get, userId) => {
    const p = op.payload ?? {};
    if (!p.work || !p.chapter) return [];
    return [
      {
        table: 'frames',
        key: op.opId,
        row: {
          id: op.opId,
          from_id: userId,
          to_id: p.toId ?? userId,
          broadcast: p.toId ? 0 : 1,
          source_id: p.sourceId,
          series_title: p.work.title ?? '',
          chapter_label: p.chapter.name ?? '',
          cover_url: p.work.thumbnailUrl ?? null,
          work_json: JSON.stringify(p.work),
          chapter_json: JSON.stringify(p.chapter),
          pages_json: JSON.stringify(p.pages ?? []),
          message: p.message ?? null,
          hidden_json: JSON.stringify(p.hiddenFrom ?? []),
          audience: 'MAJLIS',
          created_at: op.at ?? now(),
          _pending: true,
        },
      },
    ];
  },
  'recommendation.send': (op, get, userId) => {
    const p = op.payload ?? {};
    if (!p.seriesRef) return [];
    return [
      {
        table: 'recommendations',
        key: op.opId,
        row: {
          id: op.opId,
          from_id: userId,
          to_id: p.toId ?? null,
          series_ref: p.seriesRef,
          series_title: p.seriesTitle ?? null,
          cover_url: p.coverUrl ?? null,
          message: p.message ?? null,
          chapter_label: p.chapterLabel ?? null,
          chapter_number: p.chapterNumber ?? null,
          hidden_json: JSON.stringify(p.hiddenFrom ?? []),
          audience: 'MAJLIS',
          state: 'SENT',
          created_at: op.at ?? now(),
          _pending: true,
        },
      },
    ];
  },
  'profile.patch': (op, get, userId) => {
    const fields = op.payload?.fields ?? {};
    const column = { displayName: 'display_name', bio: 'bio', avatarKey: 'avatar_key', bannerKey: 'banner_key', accent: 'accent' };
    const prev = get('profiles', userId) ?? { user_id: userId };
    const row = { ...prev };
    for (const [k, v] of Object.entries(fields)) if (column[k]) row[column[k]] = v;
    return [{ table: 'profiles', key: userId, row }];
  },
};

/**
 * الطبقة كلها من الطابور بترتيبه: عمليتان على نفس الصف، الأخيرة تفوز.
 * @returns {Record<string, Record<string, object>>}
 */
export function projectQueue(queue, mirror, userId) {
  const overlay = {};
  if (!userId) return overlay;
  const get = (table, key) => (key == null ? null : overlay[table]?.[key] ?? mirror[table]?.[key] ?? null);
  for (const op of queue) {
    const project = PROJECTIONS[op?.kind];
    if (!project) continue;
    let changes = [];
    try {
      changes = project(op, get, userId, mirror) ?? [];
    } catch {
      changes = [];
    }
    for (const { table, key, row } of changes) {
      if (key == null || !row) continue;
      (overlay[table] ??= {})[key] = row;
    }
  }
  return overlay;
}
