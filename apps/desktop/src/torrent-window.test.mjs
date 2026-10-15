import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, stat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planWindow, playbackByte, alignDownToPiece, readNeedsRebuild, rangeStart, bytesPerSecond, createHolePuncher, WINDOW } from './torrent-window.mjs';
import { contiguousEndFrom, pieceLengthOf, insideDir } from './services.mjs';

const MiB = 1024 * 1024, GiB = 1024 * MiB;
// فيلم 40GB مدته ساعتان ونصف (≈4.55MB/ث)
const film = { fileLength: 40 * GiB, fileOffset: 0, pieceLength: 16 * MiB, durationSeconds: 9000 };

test('يُفرّغ ما خلف المشاهدة ويبقي 50 ثانية فقط، بحدود القطع', () => {
  const plan = planWindow({ ...film, positionSeconds: 3600, readPos: 3600 / 9000 * film.fileLength + 300 * MiB, forwardCacheBytes: 300 * MiB, freeBytes: 50 * GiB });
  const bps = bytesPerSecond(film.fileLength, 9000);
  const play = 3600 / 9000 * film.fileLength;
  assert.ok(plan.evictTo > 0);
  assert.equal(plan.evictTo % film.pieceLength, 0);
  assert.ok(plan.evictTo <= play - 50 * bps, 'لا يمس آخر 50 ثانية');
  assert.ok(play - 50 * bps - plan.evictTo < film.pieceLength, 'لا يبقي أكثر من قطعة زيادة');
});

test('قدّام بقدر المساحة: المساحة وافرة لا توقف، قليلة توقف، وتحرّرها يستأنف', () => {
  assert.equal(planWindow({ ...film, positionSeconds: 100, contiguousEnd: 10 * GiB, freeBytes: 30 * GiB }).action, null);
  const pause = planWindow({ ...film, positionSeconds: 100, contiguousEnd: 10 * GiB, freeBytes: 600 * MiB });
  assert.equal(pause.action, 'pause');
  assert.equal(planWindow({ ...film, positionSeconds: 100, contiguousEnd: 10 * GiB, freeBytes: 1000 * MiB, paused: true }).action, null, 'فارق يمنع التذبذب');
  assert.equal(planWindow({ ...film, positionSeconds: 100, contiguousEnd: 10 * GiB, freeBytes: 2 * GiB, paused: true }).action, 'resume');
});

test('المخزون قدّام ينفد: يستأنف ولو المساحة قليلة، والقرص الممتلئ فعلًا يوقف بأمان', () => {
  const play = 100 / 9000 * film.fileLength;
  const starving = planWindow({ ...film, positionSeconds: 100, contiguousEnd: play + 5 * MiB, freeBytes: 500 * MiB, paused: true });
  assert.equal(starving.action, 'resume');
  const full = planWindow({ ...film, positionSeconds: 100, contiguousEnd: play + 5 * MiB, freeBytes: 10 * MiB, evictedTo: 0, buffering: true });
  assert.match(full.fail, /القرص ممتلئ/);
});

test('موضع المشاهدة: القراءة ناقص ذاكرة المشغّل، ولا يتجاوز نسبة الوقت', () => {
  assert.equal(playbackByte({ readPos: 1000 * MiB, forwardCacheBytes: 200 * MiB, positionSeconds: 0, durationSeconds: 100, fileLength: 10 * GiB }), 0 + 10 * GiB * 0.02);
  assert.equal(playbackByte({ readPos: 1000 * MiB, forwardCacheBytes: 200 * MiB, positionSeconds: 50, durationSeconds: 100, fileLength: 10 * GiB }), 800 * MiB);
  assert.equal(playbackByte({ positionSeconds: null, durationSeconds: null, fileLength: 1 }), null);
});

test('رجوع لمنطقة مفرّغة يتطلب إعادة بناء، وغيرها لا', () => {
  assert.equal(readNeedsRebuild(10, 0), false);
  assert.equal(readNeedsRebuild(5 * MiB, 64 * MiB), true);
  assert.equal(readNeedsRebuild(64 * MiB, 64 * MiB), false);
  assert.equal(rangeStart('bytes=123-'), 123);
  assert.equal(rangeStart(undefined), 0);
});

test('الحدود: القطعة تُعدّ من بداية التورنت', () => {
  assert.equal(alignDownToPiece(100, 10, 64), 54);
  assert.equal(alignDownToPiece(5, 10, 64), 0);
  assert.equal(pieceLengthOf(40 * GiB, 2560), 16 * MiB);
  assert.equal(pieceLengthOf(10 * MiB + 5, 3), 4 * MiB);
});

test('نهاية المنزّل المتصل من بت-فيلد rqbit (Msb0)', () => {
  const bits = Buffer.from([0b11110000, 0b00000000]);
  const meta = { fileOffset: 0, fileLength: 16 * 4, pieceLength: 4, totalPieces: 16 };
  assert.equal(contiguousEndFrom(bits, meta, 0), 16);
  assert.equal(contiguousEndFrom(bits, meta, 9), 16);
  assert.equal(contiguousEndFrom(bits, meta, 20), 20);
});

test('لا تفريغ خارج مجلد الجلسة', () => {
  assert.equal(insideDir('/c/cache/s/a/file.mkv', '/c/cache/s', 'linux'), true);
  assert.equal(insideDir('/c/cache/s-other/file.mkv', '/c/cache/s', 'linux'), false);
  assert.equal(insideDir('/c/cache/s/../x', '/c/cache/s', 'linux'), false);
});

test('fallocate يحرّر المساحة فعلًا ويبقي الحجم والبيانات اللاحقة (لينكس)', { skip: process.platform !== 'linux' }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'vantara-punch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'f.bin');
  await writeFile(file, Buffer.alloc(8 * MiB, 7));
  const before = await stat(file);
  const puncher = createHolePuncher('linux');
  assert.equal(await puncher.punch(file, 0, 4 * MiB), true);
  const after = await stat(file);
  assert.equal(after.size, before.size);
  assert.ok(after.blocks < before.blocks, `blocks ${before.blocks} → ${after.blocks}`);
  const data = await readFile(file);
  assert.equal(data[0], 0);
  assert.equal(data[4 * MiB], 7);
});

test('الحدود الافتراضية متّسقة', () => {
  assert.ok(WINDOW.resumeAboveFree > WINDOW.pauseBelowFree && WINDOW.pauseBelowFree > WINDOW.hardFloorFree);
});
