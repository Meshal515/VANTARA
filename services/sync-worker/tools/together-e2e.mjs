/**
 * اختبار حي لـVANTARA Together على workerd حقيقي (wrangler dev)، بعميلين وثلاثة حسابات.
 * التشغيل: wrangler dev محليًا بـ.dev.vars فيه VANTARA_IDENTITY_SECRET، ثم:
 *   TOGETHER_BASE=http://127.0.0.1:8787 TOGETHER_SECRET=<نفس السر> node services/sync-worker/tools/together-e2e.mjs
 * الحسابات الثلاثة هي التي تزرعها الترحيلات (ngm، dahmi، mansour).
 */
import { mintIdentityToken } from '../../../packages/domain/dist/index.js';
import { createRoom, joinRoom, roomInfo } from '../../../apps/web/lib/together/room.js';
import { createDriftController, targetAt } from '../../../apps/web/lib/together/sync.js';
const base = process.env.TOGETHER_BASE ?? 'http://127.0.0.1:8787';
const SECRET = process.env.TOGETHER_SECRET ?? 'dev-identity-secret-at-least-32-characters-long';
const U = { host: 'bedcf897-a6f0-4730-b757-402b14891ca5', dahmi: '07588797-a471-44d1-99ce-7fb4f188c196', third: '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed' };
const tok = (u) => mintIdentityToken({ userId: u, deviceId: 'dev-' + u.slice(0, 8) }, SECRET);
const T = {}; for (const [k, v] of Object.entries(U)) T[k] = await tok(v);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { const s = Date.now(); while (Date.now() - s < ms) { if (fn()) return true; await wait(20); } return false; };
const results = []; const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name} ${extra}`); };

const media = { key: 'anime:frieren:e5', kind: 'anime', label: 'Frieren — الحلقة 5' };
const code = await createRoom({ baseUrl: base, token: T.host, invite: [U.dahmi], media });
check('إنشاء غرفة وإرجاع رمز', /^[A-Z2-9]{6}$/.test(code), code);
const unauth = await fetch(`${base}/v1/together/rooms`, { method: 'POST', body: '{}' });
const noInvite = await fetch(`${base}/v1/together/rooms`, { method: 'POST', headers: { authorization: `Bearer ${T.host}` }, body: JSON.stringify({ invite: [], media }) });
check('لا غرفة بلا مدعوين', noInvite.status === 400, String(noInvite.status));
check('رفض إنشاء بلا توكن', unauth.status === 401, String(unauth.status));

const host = joinRoom({ baseUrl: base, code, getToken: () => T.host });
check('المضيف يدخل (welcome)', await until(() => host.status === 'live'), host.status);
const joinedNames = []; host.on('joined', (m) => joinedNames.push(m.name));
const dahmi = joinRoom({ baseUrl: base, code, getToken: () => T.dahmi });
check('دحمي يدخل', await until(() => dahmi.status === 'live'));
check('المضيف يرى «دحمي دخل» بالاسم من الحساب', await until(() => joinedNames.length === 1), JSON.stringify(joinedNames));
check('القائمة فيها شخصان', await until(() => host.roster.length === 2 && dahmi.roster.length === 2));
check('isHost صحيح', host.isHost && !dahmi.isHost);

await until(() => host.clock.rtt != null && dahmi.clock.rtt != null, 3000); await wait(1500);
check('الساعة المشتركة: rtt محلي صغير', host.clock.rtt < 50, `rtt=${host.clock.rtt?.toFixed(1)}ms offset=${host.clock.offset.toFixed(1)}ms`);

const third = joinRoom({ baseUrl: base, code, getToken: () => T.third });
check('غير المدعو لا يدخل', await until(() => third.status === 'uninvited', 6000), third.status);
third.close();

// غرفة الانتظار: «جاري التجهيز» ثم «جاهز» تحت كل أفاتار، والتنبيهات فورية
check('الغرفة تبدأ في الانتظار (لم تبدأ)', host.timeline.started === false && dahmi.timeline.started === false);
const statuses = []; host.on('status', (m) => statuses.push(`${m.name}:${m.state}`));
dahmi.report({ pos: 0, at: dahmi.clock.serverNow(), state: 'preparing', source: 'witanime' });
await until(() => statuses.length >= 1);
dahmi.report({ pos: 0, at: dahmi.clock.serverNow(), state: 'ready', source: 'witanime' });
check('المضيف يرى «جاري التجهيز» ثم «جاهز» عند دحمي فورًا', await until(() => statuses.includes('دحمي:ready')), JSON.stringify(statuses));
const info = await roomInfo({ baseUrl: base, token: T.dahmi, code });
check('بطاقة الدعوة ترى من داخل وهل بدأت', info?.people?.length === 2 && info.state.started === false, JSON.stringify(info?.people?.map((p) => p.state)));

let denied = false; dahmi.on('denied', () => (denied = true));
dahmi.command('play', { pos: 0 });
check('غير المضيف لا يتحكم', await until(() => denied));

const seqBefore = dahmi.timeline.seq;
host.command('play', { pos: 10_000 });
check('«ابدأ» من المضيف يصل للجميع ويبدأ الحلقة', await until(() => dahmi.timeline?.seq === seqBefore + 1 && host.timeline?.seq === seqBefore + 1 && dahmi.timeline.started === true));
const tl = dahmi.timeline;
const leadAtArrival = tl.at - dahmi.clock.serverNow();
check('الأمر مجدول للمستقبل (يصل قبل موعده)', leadAtArrival > 0 && leadAtArrival <= 300, `باقي ${leadAtArrival.toFixed(0)}ms عند الوصول`);
const a = targetAt(host.timeline, host.clock.serverNow()); const b = targetAt(dahmi.timeline, dahmi.clock.serverNow());
check('الجهازان يحسبان نفس الموقع المطلوب', Math.abs(a - b) < 20, `فرق ${Math.abs(a - b).toFixed(1)}ms`);

// تقارير → اللوحة ترى سيرفر كل شخص
host.report({ pos: 10_500, at: host.clock.serverNow(), state: 'playing', source: 'witanime', mediaKey: media.key, version: { durationMs: 1_440_000 } });
await wait(1100);
dahmi.report({ pos: 9_000, at: dahmi.clock.serverNow(), state: 'buffering', source: 'torrent', mediaKey: media.key, version: { durationMs: 1_530_000 } });
dahmi.report({ pos: 9_000, at: dahmi.clock.serverNow(), state: 'failed', source: 'okru' });
check('«تعذّر تشغيل السيرفر عند دحمي» يصل فورًا', await until(() => statuses.includes('دحمي:failed')));
dahmi.report({ pos: 9_000, at: dahmi.clock.serverNow(), state: 'buffering', source: 'torrent', mediaKey: media.key, version: { durationMs: 1_530_000 } });
const seen = await until(() => host.roster.find((r) => r.userId === U.dahmi)?.source === 'torrent', 3000);
const rd = host.roster.find((r) => r.userId === U.dahmi);
check('اللوحة: سيرفر دحمي وحالته ونسخته', seen && rd.state === 'buffering' && rd.sameVersion === false, JSON.stringify({ source: rd?.source, state: rd?.state, sameVersion: rd?.sameVersion }));
check('تعثّر دحمي لم يغيّر الخط الزمني', host.timeline.seq === seqBefore + 1 && host.timeline.playing === true);

// الوضع الحر ثم العودة
host.setMode('free');
check('تحويل إلى الوضع الحر', await until(() => dahmi.info?.mode === 'free'));
host.setMode('sync');
check('العودة للمتزامن', await until(() => dahmi.info?.mode === 'sync'));

// نفس الحساب من جهاز آخر يستبدل القديم ولا يكرر «دخل»
const before = joinedNames.length;
const dahmi2 = joinRoom({ baseUrl: base, code, getToken: () => T.dahmi });
check('إعادة دخول نفس الحساب', await until(() => dahmi2.status === 'live' && dahmi.status === 'replaced'), `${dahmi.status}`);
await wait(300);
check('لا «دخل» مكرر ولا شخص زائد', joinedNames.length === before && host.roster.length === 2);

// محاكاة مشغّلين حقيقيين: دحمي متأخر 1.4s ومخزّنه 30s، والمضيف متقدّم 300ms بلا مخزّن خلفي
const players = [{ room: host, pos: null, rate: 1, err0: 300, ahead: 0, behind: 0 }, { room: dahmi2, pos: null, rate: 1, err0: -1400, ahead: 30_000, behind: 0 }];
for (const p of players) { p.ctl = createDriftController(); const t = p.room.clock.serverNow(); p.pos = targetAt(p.room.timeline, t) + p.err0; p.last = t; }
const errs = [[], []];
for (let i = 0; i < 40; i++) {
  await wait(500);
  players.forEach((p, j) => {
    const t = p.room.clock.serverNow();
    p.pos += (t - p.last) * p.rate; p.last = t;
    const d = p.ctl.step({ timeline: p.room.timeline, pos: p.pos, at: t, bufferedAhead: p.ahead, bufferedBehind: p.behind });
    p.rate = d.rate; if (d.seekTo != null) p.pos = d.seekTo;
    errs[j].push(p.pos - targetAt(p.room.timeline, t));
    const s = p.ctl.stats(); p.room.report({ pos: p.pos, at: t, state: 'playing', source: 'sim', driftMs: Math.round(errs[j].at(-1)), driftP95: s.p95 });
  });
}
const tail = (xs) => xs.slice(-6).map((x) => Math.abs(x));
check('بعد 20 ث: الاثنان تحت 60ms عن الهدف', Math.max(...tail(errs[0]), ...tail(errs[1])) < 60, `المضيف ${tail(errs[0]).at(-1).toFixed(0)}ms، دحمي ${tail(errs[1]).at(-1).toFixed(0)}ms`);
const firstOk = errs[1].findIndex((e) => Math.abs(e) < 60);
check('دحمي (متأخر 1.4ث) لحق بقفز واحد', firstOk >= 0 && firstOk <= 3, `بعد ${(firstOk + 1) * 0.5}ث`);
const hostOk = errs[0].findIndex((e) => Math.abs(e) < 60);
check('المضيف (متقدّم 300ms) لحق بالسرعة', hostOk >= 0, `بعد ${(hostOk + 1) * 0.5}ث`);
await wait(1100);
const panel = host.roster.find((r) => r.userId === U.dahmi);
check('اللوحة ترى فرق المزامنة الفعلي', panel?.driftMs != null && Math.abs(panel.driftMs) < 60, `driftMs=${panel?.driftMs} p95=${panel?.driftP95}`);

// دخول متأخر والحلقة تعمل: بلا انتظار ولا «جاهز»، مباشرة عند الثانية الحالية
host.invite([U.third]);
await wait(300);
const late = joinRoom({ baseUrl: base, code, getToken: () => T.third });
check('المدعو لاحقًا يدخل والحلقة بدأت (مباشرة)', await until(() => late.status === 'live' && late.timeline?.started === true && late.timeline.playing === true), late.status);
const lateTarget = targetAt(late.timeline, late.clock.serverNow()); const hostTarget = targetAt(host.timeline, host.clock.serverNow());
check('المتأخر يحسب نفس الثانية', Math.abs(lateTarget - hostTarget) < 30, `فرق ${Math.abs(lateTarget - hostTarget).toFixed(0)}ms عند ${(hostTarget / 1000).toFixed(1)}ث`);

// الحلقة التالية في نفس الغرفة: الكل «جاري التجهيز» ثم تبدأ وحدها حين يجهزون
const next = { key: 'anime:frieren:e6', kind: 'anime', label: 'Frieren — الحلقة 6' };
host.command('load', { media: next });
check('الحلقة التالية: نفس الغرفة، انتظار من جديد', await until(() => late.timeline?.media?.key === next.key && late.timeline.started === false && dahmi2.timeline.started === false));
for (const r of [host, dahmi2, late]) r.report({ pos: 0, at: r.clock.serverNow(), state: 'ready', source: 'sim', mediaKey: next.key });
check('تبدأ وحدها حين يجهز الجميع', await until(() => late.timeline?.started === true && host.timeline.started === true && late.timeline.playing === true));
late.close();
await wait(300);

// انتقال الاستضافة بعد 60 ث من غياب المضيف
host.close();
let newHost = null; dahmi2.on('host', (id) => (newHost = id));
check('خروج المضيف يصل كـ left', await until(() => dahmi2.roster.length === 1), String(dahmi2.roster.length));
console.log('… انتظار مهلة غياب المضيف (60 ث)');
check('بعد 60 ث تنتقل الاستضافة لدحمي', await until(() => newHost === U.dahmi, 70_000), String(newHost));
check('دحمي صار يتحكم', dahmi2.isHost);
dahmi2.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} نجح`);
process.exit(failed ? 1 : 0);
