/**
 * VANTARA Together — منطق الغرفة الصافي، بلا Cloudflare ولا شبكة.
 *
 * الغرفة لا تنقل فيديو ولا صورًا: كل جهاز يشغّل من سيرفره هو. ما هنا فقط:
 *  - الخط الزمني المرجعي: {playing, pos, at, rate, seq}. الموقع المطلوب عند أي
 *    لحظة خادم t هو pos + (t − at) × rate إن كان يعمل.
 *  - أوامر مجدولة: أمر المضيف يُختم بلحظة بعد LEAD_MS، فيصل لكل الأجهزة قبل موعده.
 *  - من في الغرفة، ومن المضيف، وأين كل واحد (للوحة الغرفة والوضع الحر).
 * المتعثّر في التحميل لا يغيّر الخط الزمني: الغرفة لا تتوقف إلا بأمر صريح.
 *
 * كل دالة تُرجع رسائل للإرسال بدل أن ترسل بنفسها، فتُختبر بلا WebSocket.
 */

export const LEAD_MS = 300;
export const MAX_CAP = 10;
export const HOST_GRACE_MS = 60_000;
export const EMPTY_TTL_MS = 30 * 60_000;
export const ROSTER_EVERY_MS = 1_000;
/** فرق المدة الذي يُعدّ نفس النسخة. أكبر منه = «نسخة مختلفة» وتُقترح إزاحة. */
export const SAME_VERSION_MS = 2_000;
/** الحلقة التالية تبدأ وحدها حين يجهز الجميع، أو بعد هذه المهلة من جاهزية المضيف: لا أحد يوقف الغرفة. */
export const AUTOSTART_MS = 20_000;

export type Mode = 'sync' | 'free';
export type Control = 'host' | 'all';
export type Kind = 'anime' | 'cinema' | 'manga';

export interface MediaRef {
  /** هوية المحتوى لا الرابط: العمل الموحّد + الحلقة/الفصل. */
  key: string;
  kind: Kind;
  label: string;
}

export interface Timeline {
  media: MediaRef | null;
  /** بدأ التشغيل في هذه الحلقة؟ لا = غرفة الانتظار («جاري التجهيز… جاهز»). */
  started: boolean;
  /** الحلقة التالية: تبدأ وحدها حين يجهز الحاضرون (أو بعد AUTOSTART_MS من جاهزية المضيف). */
  autoStart: boolean;
  playing: boolean;
  /** موقع الحلقة بالمللي ثانية (أو رقم الصفحة في المانجا) عند لحظة الخادم at. */
  pos: number;
  at: number;
  rate: number;
  seq: number;
}

export interface RoomSettings {
  code: string;
  hostUserId: string;
  cap: number;
  mode: Mode;
  control: Control;
  createdAt: number;
  /** من يحق له الدخول: المدعوون بالاسم، أو '*' للكل. المضيف دائمًا. */
  allowed: string[] | '*';
}

export interface Version {
  durationMs: number | null;
  pages: number | null;
}

export interface Report {
  pos: number;
  /** لحظة الخادم التي قيس عندها pos (الجهاز يحوّلها بساعته المشتركة). */
  at: number;
  /** preparing: جاري التجهيز · ready: جاهز · failed: تعذّر السيرفر عنده (لا يوقف أحدًا). */
  state: MemberState;
  source: string | null;
  mediaKey: string | null;
  version: Version | null;
  driftMs: number | null;
  driftP95: number | null;
}

export type MemberState = 'preparing' | 'ready' | 'playing' | 'paused' | 'buffering' | 'failed';
const MEMBER_STATES: readonly MemberState[] = ['preparing', 'ready', 'playing', 'paused', 'buffering', 'failed'];

export interface Member {
  conn: string;
  userId: string;
  name: string;
  avatarKey: string | null;
  joinedAt: number;
  report: Report | null;
}

export interface Persisted {
  settings: RoomSettings;
  timeline: Timeline;
  hostAwaySince: number | null;
  emptySince: number | null;
  hostReadyAt?: number | null;
}

export type Out =
  | { to: 'all' | string[]; except?: string; msg: Record<string, unknown> }
  | { close: string; code: number; reason: string };

const clampInt = (value: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(hi, Math.max(lo, n));
};
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : null;

export function parseMedia(raw: unknown): MediaRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const key = text(r['key'], 200);
  const kind = r['kind'];
  if (!key || (kind !== 'anime' && kind !== 'cinema' && kind !== 'manga')) return null;
  return { key, kind, label: text(r['label'], 200) ?? key };
}

/** الموقع المرجعي عند لحظة الخادم t. */
export function positionAt(t: Timeline, now: number): number {
  if (!t.playing) return t.pos;
  return Math.max(0, t.pos + Math.max(0, now - t.at) * t.rate);
}

/** هل نسخة المشارك تطابق نسخة المضيف؟ null = لا نعرف بعد. */
export function versionMatch(host: Version | null | undefined, mine: Version | null | undefined): boolean | null {
  if (!host || !mine) return null;
  if (host.durationMs != null && mine.durationMs != null) return Math.abs(host.durationMs - mine.durationMs) <= SAME_VERSION_MS;
  if (host.pages != null && mine.pages != null) return host.pages === mine.pages;
  return null;
}

/** المدعوون: '*' (الكل) أو قائمة معرّفات حسابات حقيقية، بلا المضيف وبلا تكرار. */
export function parseInvitees(raw: unknown, known: readonly string[], hostUserId: string): string[] | '*' | null {
  if (raw === '*' || raw === 'all') return '*';
  if (!Array.isArray(raw)) return null;
  const set = new Set(known);
  const ids = [...new Set(raw.filter((id): id is string => typeof id === 'string' && set.has(id) && id !== hostUserId))];
  return ids.length ? ids.slice(0, MAX_CAP - 1) : null;
}

export function createSettings(input: Record<string, unknown> | null, hostUserId: string, code: string, now: number, allowed: string[] | '*' = '*'): RoomSettings {
  return {
    code,
    hostUserId,
    // لا تحديد عدد: الغرفة على قدر من اخترتهم، والسقف 10 (حد الحسابات أصلًا)
    cap: MAX_CAP,
    mode: input?.['mode'] === 'free' ? 'free' : 'sync',
    control: input?.['control'] === 'all' ? 'all' : 'host',
    createdAt: now,
    allowed,
  };
}

export class RoomCore {
  settings: RoomSettings;
  timeline: Timeline;
  hostAwaySince: number | null;
  emptySince: number | null;
  hostReadyAt: number | null;
  readonly members = new Map<string, Member>();
  private lastRosterAt = 0;
  /** تغيّر شيء يستحق الحفظ (لا تقارير المواقع). */
  dirty = false;

  constructor(saved: Persisted) {
    this.settings = saved.settings;
    this.timeline = saved.timeline;
    this.hostAwaySince = saved.hostAwaySince;
    this.emptySince = saved.emptySince;
    this.hostReadyAt = saved.hostReadyAt ?? null;
    // غرف أُنشئت قبل الدعوات
    this.settings.allowed ??= '*';
    this.timeline.started ??= this.timeline.seq > 0;
    this.timeline.autoStart ??= false;
  }

  static create(settings: RoomSettings, media: MediaRef | null, now: number): RoomCore {
    return new RoomCore({
      settings,
      timeline: { media, started: false, autoStart: false, playing: false, pos: 0, at: now, rate: 1, seq: 0 },
      hostAwaySince: null,
      emptySince: now,
    });
  }

  persisted(): Persisted {
    return { settings: this.settings, timeline: this.timeline, hostAwaySince: this.hostAwaySince, emptySince: this.emptySince, hostReadyAt: this.hostReadyAt };
  }

  private byUser(userId: string): Member | undefined {
    for (const m of this.members.values()) if (m.userId === userId) return m;
    return undefined;
  }

  /** عدد الأشخاص لا الاتصالات: نفس الحساب من جهازين = شخص واحد (آخر اتصال يفوز). */
  canJoin(userId: string): boolean {
    return this.invited(userId) && (this.byUser(userId) !== undefined || this.members.size < this.settings.cap);
  }

  invited(userId: string): boolean {
    const { allowed, hostUserId } = this.settings;
    return userId === hostUserId || allowed === '*' || allowed.includes(userId);
  }

  /** يعيد عضوًا بعد استيقاظ الكائن من السبات (الاتصال باقٍ، الذاكرة لا). */
  restore(member: Omit<Member, 'report'>): void {
    this.members.set(member.conn, { ...member, report: null });
  }

  join(member: Omit<Member, 'report' | 'joinedAt'>, now: number): Out[] {
    const out: Out[] = [];
    const previous = this.byUser(member.userId);
    if (!this.invited(member.userId)) {
      return [{ to: [member.conn], msg: { t: 'uninvited' } }, { close: member.conn, code: 4005, reason: 'uninvited' }];
    }
    if (previous) {
      this.members.delete(previous.conn);
      out.push({ close: previous.conn, code: 4001, reason: 'replaced' });
    } else if (this.members.size >= this.settings.cap) {
      return [{ to: [member.conn], msg: { t: 'full', cap: this.settings.cap } }, { close: member.conn, code: 4003, reason: 'full' }];
    }
    const joined: Member = { ...member, joinedAt: previous?.joinedAt ?? now, report: previous?.report ?? null };
    this.members.set(member.conn, joined);
    this.emptySince = null;
    if (member.userId === this.settings.hostUserId) this.hostAwaySince = null;
    this.dirty = true;
    out.push({ to: [member.conn], msg: { t: 'welcome', you: member.userId, now, room: this.roomView(), state: this.timeline, roster: this.roster(now) } });
    if (!previous) out.push({ to: 'all', except: member.conn, msg: { t: 'joined', userId: member.userId, name: member.name, avatarKey: member.avatarKey } });
    out.push(this.rosterOut(now));
    return out;
  }

  leave(conn: string, now: number): Out[] {
    const m = this.members.get(conn);
    if (!m) return [];
    this.members.delete(conn);
    if (this.members.size === 0) this.emptySince = now;
    if (m.userId === this.settings.hostUserId) this.hostAwaySince = now;
    this.dirty = true;
    return [{ to: 'all', msg: { t: 'left', userId: m.userId, name: m.name } }, this.rosterOut(now)];
  }

  isHost(conn: string): boolean {
    return this.members.get(conn)?.userId === this.settings.hostUserId;
  }

  private canControl(conn: string): boolean {
    return this.isHost(conn) || (this.settings.control === 'all' && this.members.has(conn));
  }

  handle(conn: string, msg: Record<string, unknown>, now: number): Out[] {
    const member = this.members.get(conn);
    if (!member) return [];
    switch (msg['t']) {
      case 'ping':
        return [{ to: [conn], msg: { t: 'pong', t0: finite(msg['t0']), ts: now } }];
      case 'cmd':
        return this.command(conn, msg, now);
      case 'report':
        return this.report(member, msg, now);
      case 'mode': {
        if (!this.isHost(conn)) return this.denied(conn);
        const mode: Mode = msg['mode'] === 'free' ? 'free' : 'sync';
        if (mode === this.settings.mode) return [];
        this.settings = { ...this.settings, mode };
        // من حر إلى متزامن: الكل يلحق بموقع المضيف، فالخط الزمني يُرسى على تقريره الأخير
        if (mode === 'sync') this.anchorToHost(now);
        this.dirty = true;
        return [{ to: 'all', msg: { t: 'room', room: this.roomView() } }, { to: 'all', msg: { t: 'state', state: this.timeline } }];
      }
      case 'settings': {
        if (!this.isHost(conn)) return this.denied(conn);
        const control: Control = msg['control'] === 'all' ? 'all' : msg['control'] === 'host' ? 'host' : this.settings.control;
        this.settings = { ...this.settings, control };
        this.dirty = true;
        return [{ to: 'all', msg: { t: 'room', room: this.roomView() } }];
      }
      case 'invite': {
        if (!this.isHost(conn)) return this.denied(conn);
        const { allowed } = this.settings;
        if (allowed === '*') return [];
        const ids = Array.isArray(msg['userIds']) ? (msg['userIds'] as unknown[]).filter((x): x is string => typeof x === 'string' && x.length <= 80) : [];
        const merged = [...new Set([...allowed, ...ids])].filter((id) => id !== this.settings.hostUserId).slice(0, MAX_CAP - 1);
        this.settings = { ...this.settings, allowed: msg['all'] === true ? '*' : merged };
        this.dirty = true;
        return [{ to: 'all', msg: { t: 'room', room: this.roomView() } }];
      }
      case 'host': {
        if (!this.isHost(conn)) return this.denied(conn);
        const target = typeof msg['userId'] === 'string' ? this.byUser(msg['userId']) : undefined;
        if (!target) return [];
        return this.transferHost(target.userId, now);
      }
      default:
        return [];
    }
  }

  private denied(conn: string): Out[] {
    return [{ to: [conn], msg: { t: 'denied' } }];
  }

  private command(conn: string, msg: Record<string, unknown>, now: number): Out[] {
    if (!this.canControl(conn)) return this.denied(conn);
    const op = msg['op'];
    const at = now + LEAD_MS;
    const given = finite(msg['pos']);
    const t = this.timeline;
    let next: Timeline;
    if (op === 'play') {
      next = { ...t, started: true, autoStart: false, playing: true, pos: Math.max(0, given ?? positionAt(t, at)), at };
    } else if (op === 'pause') {
      next = { ...t, playing: false, pos: Math.max(0, given ?? positionAt(t, at)), at };
    } else if (op === 'seek') {
      if (given == null) return [];
      next = { ...t, pos: Math.max(0, given), at };
    } else if (op === 'load') {
      const media = parseMedia(msg['media']);
      if (!media) return [];
      // الحلقة التالية في نفس الغرفة: الكل يرجع «جاري التجهيز»، وتبدأ وحدها حين يجهزون
      next = { ...t, media, started: false, autoStart: msg['autoStart'] !== false, playing: false, pos: Math.max(0, given ?? 0), at };
      this.hostReadyAt = null;
      for (const m of this.members.values()) if (m.report) m.report = { ...m.report, state: 'preparing', mediaKey: null, version: null };
    } else return [];
    next.seq = t.seq + 1;
    this.timeline = next;
    this.dirty = true;
    const out: Out[] = [{ to: 'all', msg: { t: 'state', state: next, by: this.members.get(conn)?.userId ?? null } }];
    if (op === 'load') out.push(this.rosterOut(now));
    return out;
  }

  private anchorToHost(now: number): void {
    const host = this.byUser(this.settings.hostUserId);
    const r = host?.report;
    if (!r) return;
    const playing = r.state === 'playing' || r.state === 'buffering';
    const pos = playing ? r.pos + Math.max(0, now - r.at) : r.pos;
    this.timeline = { ...this.timeline, playing: this.timeline.playing, pos, at: now, seq: this.timeline.seq + 1 };
  }

  private report(member: Member, msg: Record<string, unknown>, now: number): Out[] {
    const pos = finite(msg['pos']);
    if (pos == null) return [];
    const state = msg['state'];
    const v = msg['version'] as Record<string, unknown> | null | undefined;
    const before = member.report?.state ?? null;
    member.report = {
      pos: Math.max(0, pos),
      // لحظة القياس بساعة الخادم كما يقدّرها الجهاز؛ لا نقبل مستقبلًا بعيدًا ولا ماضيًا سحيقًا
      at: Math.min(now + 1000, Math.max(now - 30_000, finite(msg['at']) ?? now)),
      state: MEMBER_STATES.includes(state as MemberState) ? (state as MemberState) : state === 'loading' ? 'preparing' : state === 'error' ? 'failed' : 'paused',
      source: text(msg['source'], 80),
      mediaKey: text(msg['mediaKey'], 200),
      version: v && typeof v === 'object' ? { durationMs: finite(v['durationMs']), pages: finite(v['pages']) } : null,
      driftMs: finite(msg['driftMs']),
      driftP95: finite(msg['driftP95']),
    };
    const after = member.report.state;
    // تغيّر الحالة يُبث فورًا (تنبيه «اشتغل الفيديو عند دحمي»)، والمواقع وحدها مقيّدة بثانية
    if (after !== before) {
      const out: Out[] = [{ to: 'all', msg: { t: 'status', userId: member.userId, name: member.name, state: after, source: member.report.source } }];
      if (member.userId === this.settings.hostUserId && (after === 'ready' || after === 'playing') && this.hostReadyAt == null) {
        this.hostReadyAt = now;
        this.dirty = true;
      }
      out.push(...this.maybeAutoStart(now));
      out.push(this.rosterOut(now));
      return out;
    }
    if (now - this.lastRosterAt < ROSTER_EVERY_MS) return [];
    return [this.rosterOut(now)];
  }

  /** الحلقة التالية تبدأ وحدها: حين يجهز كل الحاضرين، أو بعد مهلة من جاهزية المضيف. */
  private maybeAutoStart(now: number): Out[] {
    const t = this.timeline;
    if (t.started || !t.autoStart || this.hostReadyAt == null) return [];
    const present = [...this.members.values()];
    const settled = (m: Member) => m.report != null && m.report.state !== 'preparing';
    if (!present.every(settled) && now - this.hostReadyAt < AUTOSTART_MS) return [];
    const at = now + LEAD_MS;
    this.timeline = { ...t, started: true, autoStart: false, playing: true, at, seq: t.seq + 1 };
    this.dirty = true;
    return [{ to: 'all', msg: { t: 'state', state: this.timeline, by: null } }];
  }

  private transferHost(userId: string, now: number): Out[] {
    if (userId === this.settings.hostUserId) return [];
    this.settings = { ...this.settings, hostUserId: userId };
    this.hostAwaySince = null;
    this.dirty = true;
    return [{ to: 'all', msg: { t: 'host', userId } }, { to: 'all', msg: { t: 'room', room: this.roomView() } }, this.rosterOut(now)];
  }

  /** مواعيد: انتقال الاستضافة إن غاب المضيف، وحذف الغرفة الفارغة. */
  tick(now: number): { out: Out[]; expired: boolean } {
    if (this.members.size === 0 && this.emptySince != null && now - this.emptySince >= EMPTY_TTL_MS) return { out: [], expired: true };
    const auto = this.maybeAutoStart(now);
    if (auto.length) return { out: auto, expired: false };
    if (this.hostAwaySince != null && now - this.hostAwaySince >= HOST_GRACE_MS && this.members.size > 0) {
      const oldest = [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0]!;
      return { out: this.transferHost(oldest.userId, now), expired: false };
    }
    return { out: [], expired: false };
  }

  /** أقرب موعد يحتاج tick، أو null. */
  nextDeadline(): number | null {
    const times: number[] = [];
    if (this.members.size === 0 && this.emptySince != null) times.push(this.emptySince + EMPTY_TTL_MS);
    if (this.hostAwaySince != null && this.members.size > 0) times.push(this.hostAwaySince + HOST_GRACE_MS);
    if (!this.timeline.started && this.timeline.autoStart && this.hostReadyAt != null) times.push(this.hostReadyAt + AUTOSTART_MS);
    return times.length ? Math.min(...times) : null;
  }

  roomView() {
    const { code, hostUserId, cap, mode, control, allowed } = this.settings;
    return { code, hostUserId, cap, mode, control, invited: allowed };
  }

  roster(now: number) {
    const host = this.byUser(this.settings.hostUserId);
    const hostVersion = host?.report?.version;
    return [...this.members.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((m) => ({
        userId: m.userId,
        name: m.name,
        avatarKey: m.avatarKey,
        host: m.userId === this.settings.hostUserId,
        joinedAt: m.joinedAt,
        pos: m.report?.pos ?? null,
        at: m.report?.at ?? null,
        state: m.report?.state ?? 'preparing',
        source: m.report?.source ?? null,
        driftMs: m.report?.driftMs ?? null,
        driftP95: m.report?.driftP95 ?? null,
        sameMedia: m.report?.mediaKey == null || this.timeline.media == null ? null : m.report.mediaKey === this.timeline.media.key,
        sameVersion: m.userId === this.settings.hostUserId ? true : versionMatch(hostVersion, m.report?.version),
        durationMs: m.report?.version?.durationMs ?? null,
      }))
      .map((r) => ({ ...r, seenMs: r.at == null ? null : Math.max(0, now - r.at) }));
  }

  private rosterOut(now: number): Out {
    this.lastRosterAt = now;
    return { to: 'all', msg: { t: 'roster', roster: this.roster(now), now } };
  }
}

/** رمز الغرفة: 6 أحرف بلا الملتبسة (0/O، 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function roomCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(6);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return code.length === 6 && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}
