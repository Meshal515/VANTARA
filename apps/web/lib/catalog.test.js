/**
 * الكتالوج الموحّد.
 *
 * السؤال هنا ليس «هل الدالة ترجع مصفوفة» بل: هل يرى القارئ العمل الواحد
 * مرةً واحدة وإن حملته خمسة مصادر؟ وهل يصل إلى الفصل ١٣٠٠ الموجود عند مصدر
 * واحد بينما البقية واقفة عند ١٢٠٠؟ ومصدرٌ يسقط، هل يأخذ معه الباقين؟
 */
import { describe, expect, it } from 'vitest';
import {
	chapterNumberOf,
	createWorkIndex,
	gather,
	groupWorks,
	mergeChapters,
	normalizeTitle,
	parseChapterNumber,
	rankListing,
} from './catalog.js';

const manga = (title, extra = {}) => ({ title, url: `/${title}`, ...extra });
const entry = (sourceId, title, extra) => ({ sourceId, label: sourceId, manga: manga(title, extra) });
const chapter = (name, extra = {}) => ({ name, url: `/${name}`, chapterNumber: -1, ...extra });

describe('مطابقة العناوين عبر المصادر', () => {
	it('تتجاهل اختلاف حالة الأحرف والمسافات', () => {
		// هذا هو الحال الواقعي في اللقطات: Team X يكتب «Nano machine»
		// وMangaSwat يكتب «Nano Machine»، وهما عمل واحد
		expect(normalizeTitle('Nano machine')).toBe(normalizeTitle('Nano  Machine'));
	});

	it('توحّد الهمزة والتاء المربوطة والألف المقصورة', () => {
		expect(normalizeTitle('الآلة النانوية')).toBe(normalizeTitle('الالة النانويه'));
		expect(normalizeTitle('مصطفى')).toBe(normalizeTitle('مصطفي'));
	});

	it('تتجاهل التشكيل والتطويل وعلامات الترقيم', () => {
		expect(normalizeTitle('سُولُو ليفلنج!')).toBe(normalizeTitle('سولــو ليفلنج'));
	});

	it('تحذف كلمات الحشو التي يضيفها بعض المصادر', () => {
		expect(normalizeTitle('ون بيس مانجا مترجمة')).toBe(normalizeTitle('ون بيس'));
	});

	it('لا تُفرغ عنوانًا كله كلمات حشو', () => {
		// مفتاحٌ فارغ كان سيجمع كل هذه العناوين في عمل واحد
		expect(normalizeTitle('مانجا مترجمة')).not.toBe('');
		expect(normalizeTitle('مانجا مترجمة')).not.toBe(normalizeTitle('manga'));
	});

	it('لا تدّعي مطابقة عبر الأبجديتين', () => {
		// حدٌّ معروف: الجمع بالتخمين يعرض فصول عملٍ آخر، وهذا أسوأ من بطاقتين
		expect(normalizeTitle('Solo Leveling')).not.toBe(normalizeTitle('سولو ليفلنج'));
	});

	it('تصمد أمام ما ليس نصًّا', () => {
		expect(normalizeTitle(undefined)).toBe('');
		expect(normalizeTitle(null)).toBe('');
	});
});

describe('قراءة رقم الفصل', () => {
	it('تأخذ أول عدد في الاسم مهما تبعه', () => {
		expect(parseChapterNumber('Chapter 330 - القوات الخاصة <3>!!!')).toBe(330);
	});

	it('تقرأ الأرقام العشرية', () => {
		expect(parseChapterNumber('1288.5')).toBe(1288.5);
	});

	it('تقرأ الأرقام العربية-الهندية', () => {
		expect(parseChapterNumber('الفصل ٣٣٠')).toBe(330);
	});

	it('ترجع ‎-1 حين لا رقم إطلاقًا', () => {
		expect(parseChapterNumber('خاص')).toBe(-1);
		expect(parseChapterNumber(undefined)).toBe(-1);
	});

	it('تفضّل رقم المصدر على الاسم حين يضبطه', () => {
		expect(chapterNumberOf({ name: 'Chapter 5', chapterNumber: 7 })).toBe(7);
	});

	it('تتجاهل ‎-1 الافتراضية وتعود إلى الاسم', () => {
		// ‎-1 هي قيمة `SChapterImpl` الابتدائية، لا رقم فصل
		expect(chapterNumberOf({ name: 'Chapter 5', chapterNumber: -1 })).toBe(5);
	});

	it('تقبل الفصل صفر فصلًا صحيحًا', () => {
		expect(chapterNumberOf({ name: 'مقدمة', chapterNumber: 0 })).toBe(0);
	});
});

describe('سؤال كل المصادر معًا', () => {
	it('يبقي نتائج الناجحين حين يسقط أحدهم', async () => {
		const { ok, failed } = await gather(['a', 'b', 'c'], async (source) => {
			if (source === 'b') throw new Error('محجوب');
			return `${source}!`;
		});
		expect(ok.map((r) => r.value)).toEqual(['a!', 'c!']);
		expect(failed).toHaveLength(1);
		expect(failed[0].source).toBe('b');
		expect(failed[0].error.message).toBe('محجوب');
	});

	it('يعيد كل الإخفاقات حين يسقط الجميع، ولا يرمي', async () => {
		const { ok, failed } = await gather(['a', 'b'], async () => {
			throw new Error('لا شبكة');
		});
		expect(ok).toEqual([]);
		expect(failed).toHaveLength(2);
	});
});

describe('جمع الأعمال', () => {
	it('يجعل العمل الواحد بطاقةً واحدة مهما تعدّدت مصادره', () => {
		const works = groupWorks([
			entry('teamx', 'Nano machine'),
			entry('swat', 'Nano Machine'),
			entry('azora', 'Apotheosis'),
		]);
		expect(works).toHaveLength(2);
		expect(works[0].editions.map((e) => e.sourceId)).toEqual(['teamx', 'swat']);
		expect(works[1].editions).toHaveLength(1);
	});

	it('يأخذ الغلاف من أول نسخة تحمل واحدًا', () => {
		const works = groupWorks([
			entry('teamx', 'Nano machine'),
			entry('swat', 'Nano Machine', { thumbnailUrl: 'https://x/cover.jpg' }),
		]);
		expect(works[0].thumbnailUrl).toBe('https://x/cover.jpg');
	});

	it('يتخطّى ما لا عنوان له بدل أن يجمعه تحت مفتاح فارغ', () => {
		expect(groupWorks([{ sourceId: 'a', manga: { url: '/x' } }])).toEqual([]);
	});
});

describe('الفهرس على دفعات', () => {
	it('يقول عن كل عمل أجديد هو، فتُرسم البطاقة مرة واحدة', () => {
		const index = createWorkIndex();
		expect(index.add(entry('teamx', 'Nano machine')).isNew).toBe(true);
		expect(index.add(entry('swat', 'Nano Machine')).isNew).toBe(false);
		expect(index.list()).toHaveLength(1);
	});

	it('يكمل الغلاف الناقص من دفعة لاحقة', () => {
		const index = createWorkIndex();
		const first = index.add(entry('teamx', 'Nano machine')).work;
		expect(first.thumbnailUrl).toBeNull();
		index.add(entry('swat', 'Nano Machine', { thumbnailUrl: 'https://x/c.jpg' }));
		expect(first.thumbnailUrl).toBe('https://x/c.jpg');
	});

	it('يعيد null لما لا عنوان له بدل أن يرمي', () => {
		expect(createWorkIndex().add({ sourceId: 'a', manga: {} })).toBeNull();
	});
});

describe('اتحاد الفصول', () => {
	const short = {
		sourceId: 'mangalek',
		label: 'Mangalek',
		manga: manga('Apotheosis'),
		chapters: [chapter('Chapter 1200'), chapter('Chapter 1199')],
	};
	const long = {
		sourceId: 'teamx',
		label: 'Team X',
		manga: manga('Apotheosis'),
		chapters: [chapter('Chapter 1300'), chapter('Chapter 1200'), chapter('Chapter 1199')],
	};

	it('يبلغ بالقارئ آخر فصل موجود عند أي مصدر', () => {
		// هذا هو سبب الميزة كلها: مصدرٌ واقف عند ١٢٠٠ وآخر بالغ ١٣٠٠
		const merged = mergeChapters([short, long]);
		expect(merged[0].number).toBe(1300);
		expect(merged.map((row) => row.number)).toEqual([1300, 1200, 1199]);
	});

	it('لا يكرّر فصلًا موجودًا عند أكثر من مصدر', () => {
		expect(mergeChapters([short, long])).toHaveLength(3);
	});

	it('يرجّح المصدر الأكثر فصولًا عند التكرار', () => {
		// الأطول يتابعه صاحبه، فترجمته أحدث
		const merged = mergeChapters([short, long]);
		expect(merged.find((row) => row.number === 1200).sourceId).toBe('teamx');
	});

	it('يحسم التساوي بترتيب المصادر كما وردت، فالنتيجة ثابتة', () => {
		const a = { sourceId: 'a', label: 'a', manga: manga('X'), chapters: [chapter('1')] };
		const b = { sourceId: 'b', label: 'b', manga: manga('X'), chapters: [chapter('1')] };
		expect(mergeChapters([a, b])[0].sourceId).toBe('a');
		expect(mergeChapters([b, a])[0].sourceId).toBe('b');
	});

	it('يحمل مع كل فصل مصدرَه وعملَه، فالقراءة تعرف أين تطلب الصفحات', () => {
		const row = mergeChapters([long])[0];
		expect(row.sourceId).toBe('teamx');
		expect(row.manga).toBe(long.manga);
		expect(row.chapter).toBe(long.chapters[0]);
	});

	it('يذيّل ما لا رقم له ولا يخلطه بالمرقَّم', () => {
		const withLoose = {
			sourceId: 'a',
			label: 'a',
			manga: manga('X'),
			chapters: [chapter('Chapter 5'), chapter('خاص')],
		};
		const merged = mergeChapters([withLoose]);
		expect(merged.map((row) => row.number)).toEqual([5, -1]);
	});

	it('ينقّي غير المرقَّم من التكرار بالاسم', () => {
		const one = { sourceId: 'a', label: 'a', manga: manga('X'), chapters: [chapter('خاص')] };
		const two = { sourceId: 'b', label: 'b', manga: manga('X'), chapters: [chapter('خاصّ')] };
		expect(mergeChapters([one, two])).toHaveLength(1);
	});

	it('يصمد أمام نسخة بلا فصول', () => {
		expect(mergeChapters([{ sourceId: 'a', label: 'a', manga: manga('X') }])).toEqual([]);
	});
});

describe('titlesMatch — نفس العمل في مصدر آخر', async () => {
	const { titlesMatch } = await import('./catalog.js');
	it('يطابق نفس العنوان بصيغ مختلفة', () => {
		expect(titlesMatch('WISTORIA: WAND AND SWORD', 'Wistoria: Wand and Sword')).toBe(true);
		expect(titlesMatch('One-Punch Man', 'One Punch Man')).toBe(true);
		expect(titlesMatch('OnePunch Man', 'One Punch Man')).toBe(true);
		expect(titlesMatch('Solo Leveling (مانهوا)', 'solo leveling')).toBe(true);
		expect(titlesMatch('وان بيس', 'ون بيس')).toBe(false);
		// كما في المصادر فعلًا: العاشق ومانجا ليك وسبارك وستارز
		expect(titlesMatch('WISTORIA: WAND AND SWORD', 'Wistoria’s Wand and Sword')).toBe(true);
		expect(titlesMatch('The Beginning After The End', 'Beginning After the End')).toBe(true);
	});
	it('لا يدمج عملين مختلفين', () => {
		expect(titlesMatch('Solo Leveling', 'Solo Leveling: Ragnarok')).toBe(false);
		expect(titlesMatch('Naruto', 'Boruto')).toBe(false);
		expect(titlesMatch('The Beginning After the End', 'The End')).toBe(false);
		expect(titlesMatch('', 'x')).toBe(false);
	});
});

describe('rankListing', () => {
	const w = (key) => ({ key });
	it('is the same whatever order sources answered in', () => {
		const works = [w('a'), w('b'), w('c')];
		const pos = new Map([
			['a', [{ pos: 5, len: 10 }]],
			['b', [{ pos: 0, len: 10 }, { pos: 1, len: 10 }]],
			['c', [{ pos: 0, len: 10 }]],
		]);
		const one = rankListing(works, pos).map((x) => x.key);
		const two = rankListing([...works].reverse(), pos).map((x) => x.key);
		expect(one).toEqual(['b', 'c', 'a']);
		expect(two).toEqual(one);
	});
	it('latest ranks by the freshest position anywhere', () => {
		const pos = new Map([
			['old', [{ pos: 8, len: 10 }, { pos: 7, len: 10 }]],
			['new', [{ pos: 0, len: 20 }]],
		]);
		expect(rankListing([w('old'), w('new')], pos, 'latest').map((x) => x.key)).toEqual(['new', 'old']);
	});
});
