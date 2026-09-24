/**
 * الكتالوج الموحّد: خمسة مصادر تُقرأ كمكتبة واحدة.
 *
 * القارئ لا يختار مصدرًا ولا يعرف أنه موجود. يبحث مرة، فيُسأل الجميع معًا،
 * وما رجع يُجمَّع: العمل الواحد الذي تحمله ثلاثة مصادر يصير بطاقةً واحدة،
 * وفصوله اتحادُ ما عند الثلاثة. وهذا هو الكسب كله — مصدرٌ يقف عند الفصل
 * ١٢٠٠ وآخر يبلغ ١٣٠٠، والقارئ يرى ١٣٠٠ بلا أن يعرف من أين جاء أيّها.
 *
 * كل ما في هذا الملف دوالّ خالصة أو تأخذ ما تناديه حقنًا، فيُختبر بلا جهاز
 * ولا شبكة. ونداء المحرّك نفسه يسكن في الشاشات.
 */

// ───────────────────────── مطابقة العناوين ─────────────────────────

/** تشكيل وتطويل: زينةٌ إملائية تختلف بين المصادر ولا تغيّر العمل. */
const DIACRITICS = /[ً-ْٰـ]/g;

/**
 * توحيد الحروف التي تُكتب بأكثر من صورة.
 *
 * «الآلة» و«الالة»، و«نانومشين» و«نانومشين» — المصادر لا تتفق على الهمزة
 * ولا على التاء المربوطة، ومطابقةٌ حرفية تجعل العمل الواحد عملين.
 */
const LETTER_FOLD = new Map([
	['أ', 'ا'],
	['إ', 'ا'],
	['آ', 'ا'],
	['ٱ', 'ا'],
	['ة', 'ه'],
	['ى', 'ي'],
	['ؤ', 'و'],
	['ئ', 'ي'],
]);

/** أرقام عربية-هندية وفارسية إلى لاتينية، فـ«الفصل ٣٣٠» و«Chapter 330» رقمٌ واحد. */
function foldDigits(text) {
	return text
		.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
		.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

function fold(text) {
	return foldDigits(text.normalize('NFKC').toLowerCase())
		.replace(DIACRITICS, '')
		.replace(/[أإآٱةىؤئ]/gu, (c) => LETTER_FOLD.get(c) ?? c)
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/**
 * كلماتٌ يضيفها بعض المصادر إلى العنوان ولا تخصّ العمل.
 *
 * تُطوى بنفس دالة الطيّ التي تعالج العناوين، وإلا لم تطابق ما تريد حذفه —
 * «مترجمة» تصير «مترجمه» بعد الطيّ، ومجموعةٌ مكتوبة يدويًّا تفوتها.
 */
const NOISE = new Set(
	['manga', 'manhwa', 'manhua', 'webtoon', 'مانجا', 'مانهوا', 'مترجم', 'مترجمة', 'اون لاين']
		.flatMap((word) => fold(word).split(' '))
		.filter(Boolean),
);

/**
 * لغة النسخة بين قوسين: «One Piece (English)» و«One Piece (French)» عند بعض
 * المصادر هي One Piece نفسه، لا أعمال أخرى. تُحذف من مفتاح المطابقة وحده،
 * والعنوان المعروض لا يتغيّر. القوسان شرط: «English Teacher» عنوان لا لغة.
 */
const LANGUAGE_TAG =
	/[([【]\s*(?:english|eng|en|french|fr|français|francais|arabic|ar|spanish|español|espanol|portuguese|pt-br|indonesian|vietnamese|raw|عربي|العربية|عربية|انجليزي|إنجليزي|الإنجليزية|الانجليزية|فرنسي|الفرنسية)(?:\s+(?:version|ver|translation|نسخة|ترجمة))?\s*[)\]】]/giu;

/**
 * مفتاح مطابقة عملٍ عبر المصادر.
 *
 * وحدُّه معروف ومقصود: المطابقة على الحروف، فعملٌ يسمّيه مصدرٌ
 * `Solo Leveling` وآخر «سولو ليفلنج» يبقى عملين. نقلُ الأسماء بين
 * الأبجديتين تخمينٌ يدمج أعمالًا مختلفة أكثر مما يجمع المتشابهة، وخطؤه
 * يظهر للقارئ فصولًا من عملٍ آخر — وهذا أسوأ من بطاقتين.
 */
export function normalizeTitle(raw) {
	if (typeof raw !== 'string') return '';
	const folded = fold(raw.replace(LANGUAGE_TAG, ' '));
	const kept = folded
		.split(' ')
		.filter((word) => word && !NOISE.has(word))
		.join(' ');
	// عنوانٌ كله كلماتُ حشو يعود كما هو: مفتاحٌ فارغ يجمع كل هؤلاء في عمل واحد.
	return kept || folded;
}

/**
 * هل العنوانان لعمل واحد؟ أصرم من «يشبه»: دمجُ عملين مختلفين يخلط فصولهما، وهذا
 * أسوأ من نسخة لم تُدمج.
 *
 * نفس العنوان بعد التطبيع، أو نفسه بلا مسافات («one punch man» = «onepunch man»)،
 * أو كلماتٌ متطابقة ٨٠٪ فأكثر (Jaccard) في عنوانين من كلمتين فصاعدًا.
 * «Solo Leveling» و«Solo Leveling: Ragnarok» ليسا عملًا واحدًا (٦٧٪).
 */
// كلمات لا تميّز عملًا: «Wistoria’s Wand and Sword» عند مانجا ليك هو
// «WISTORIA: WAND AND SWORD» عند العاشق — الفرق ’s و«and» لا غير
const FILLER = new Set(['s', 'the', 'a', 'an', 'of', 'and', '&']);
const meaningful = (normalized) => normalized.split(' ').filter((w) => w && !FILLER.has(w));

export function titlesMatch(a, b) {
	const na = normalizeTitle(a);
	const nb = normalizeTitle(b);
	if (!na || !nb) return false;
	if (na === nb) return true;
	if (na.replace(/\s+/g, '') === nb.replace(/\s+/g, '')) return true;
	const wa = meaningful(na);
	const wb = meaningful(nb);
	if (wa.length && wa.join('') === wb.join('')) return true;
	const ta = new Set(wa);
	const tb = new Set(wb);
	if (Math.min(ta.size, tb.size) < 2) return false;
	let shared = 0;
	for (const t of ta) if (tb.has(t)) shared += 1;
	return shared / new Set([...ta, ...tb]).size >= 0.8;
}

// ───────────────────────── أرقام الفصول ─────────────────────────

/**
 * رقم الفصل من اسمه.
 *
 * أول عدد في النص: «Chapter 330 - القوات الخاصة» ← 330، و«1288.5» ←
 * 1288.5، و«الفصل ٣٣٠» ← 330 بعد طيّ الأرقام.
 */
export function parseChapterNumber(name) {
	if (typeof name !== 'string') return -1;
	const match = foldDigits(name.normalize('NFKC')).match(/\d+(?:\.\d+)?/);
	return match ? Number(match[0]) : -1;
}

/**
 * رقم الفصل: ما قاله المصدر، وإلا ما يُقرأ من الاسم.
 *
 * `chapterNumber` يصل ‎-1 حين لا يضبطه المحلّل، وهي القيمة الافتراضية في
 * `SChapterImpl` لا رقمًا حقيقيًّا. والصفر فصلٌ صحيح (مقدّمة) فلا يُرفض.
 */
export function chapterNumberOf(chapter) {
	const given = Number(chapter?.chapterNumber);
	if (Number.isFinite(given) && given >= 0) return given;
	return parseChapterNumber(chapter?.name);
}

// ───────────────────────── جمع النتائج ─────────────────────────

/**
 * يسأل كل المصادر معًا ويعيد ما ردّ وما سقط.
 *
 * `allSettled` لا `all`: مصدرٌ محجوب أو بطيء لا يجوز أن يمسح نتائج الأربعة
 * الباقين — والقارئ يفضّل أربعة مصادر على شاشة خطأ.
 */
export async function gather(sources, ask) {
	const settled = await Promise.allSettled(sources.map((source) => ask(source)));
	const ok = [];
	const failed = [];
	settled.forEach((result, index) => {
		if (result.status === 'fulfilled') ok.push({ source: sources[index], value: result.value });
		else failed.push({ source: sources[index], error: result.reason });
	});
	return { ok, failed };
}

/**
 * فهرسٌ يُبنى على دفعات.
 *
 * المصادر الخمسة لا تردّ معًا: أولها من الذاكرة في جزء من ثانية، وآخرها قد
 * ينزّل حزمته ويفكّ الـDEX فيتأخّر ثوانيَ. وانتظارُ الجميع قبل عرض شيء
 * يجعل الشاشة فارغةً طوال أبطأ مصدر. فالفهرس يبتلع كل دفعة عند وصولها،
 * ويقول عن كل عمل: أجديدٌ هو فتُرسم له بطاقة، أم نسخةٌ أخرى من عملٍ معروض؟
 *
 * `editions` هي نسخ العمل الواحد عند المصادر المختلفة، مرتّبةً كما وردت.
 * والغلاف يُؤخذ من أول نسخة تحمل واحدًا: مصدرٌ بلا غلاف لا يجعل البطاقة
 * فارغة وغيرُه يحمله.
 */
export function createWorkIndex() {
	const works = new Map();
	return {
		/** يعيد `null` لما لا عنوان له، وإلا `{ work, isNew }`. */
		add(entry) {
			const manga = entry?.manga;
			const key = normalizeTitle(manga?.title);
			if (!key) return null;
			const found = works.get(key);
			if (found) {
				found.editions.push(entry);
				found.thumbnailUrl ??= manga.thumbnailUrl ?? null;
				return { work: found, isNew: false };
			}
			const work = {
				key,
				title: manga.title,
				thumbnailUrl: manga.thumbnailUrl ?? null,
				editions: [entry],
			};
			works.set(key, work);
			return { work, isNew: true };
		},
		list() {
			return [...works.values()];
		},
	};
}

/**
 * ترتيب قائمةٍ مدموجة من عدة مصادر، ثابت لا يتبع أيّ مصدر ردّ أولًا.
 *
 * كل مصدر يعطي ترتيبه هو (الأول عنده أول). الدرجة:
 *   - `popular`: مجموع (1 − الموضع/الطول) عبر المصادر — العمل الرائج في
 *     مصادر كثيرة وفي أعلاها يسبق.
 *   - `latest`: أقرب موضع نسبي في أي مصدر — الأحدث تحديثًا في أي مكان يسبق،
 *     والتعادل بعدد المصادر.
 *   - غيرهما (الكتالوج، البحث): مثل `popular`.
 * والتعادل الأخير بالعنوان المطبَّع، فالنتيجة واحدة في كل تشغيل.
 *
 * @param {Array<{ key: string }>} works
 * @param {Map<string, Array<{ pos: number, len: number }>>} positions
 */
export function rankListing(works, positions, kind = 'popular') {
	const score = (w) => {
		const seen = positions.get(w.key) ?? [];
		if (!seen.length) return { a: 0, b: 0 };
		if (kind === 'latest') {
			const best = Math.min(...seen.map((p) => p.pos / Math.max(1, p.len)));
			return { a: -best, b: seen.length };
		}
		const sum = seen.reduce((t, p) => t + (1 - p.pos / Math.max(1, p.len)), 0);
		return { a: sum, b: seen.length };
	};
	const scored = works.map((w) => ({ w, s: score(w) }));
	scored.sort((x, y) => y.s.a - x.s.a || y.s.b - x.s.b || (x.w.key < y.w.key ? -1 : x.w.key > y.w.key ? 1 : 0));
	return scored.map((x) => x.w);
}

/** يجمع نتائج المصادر في أعمال، كلُّ عمل ونسخُه. */
export function groupWorks(entries) {
	const index = createWorkIndex();
	for (const entry of entries) index.add(entry);
	return index.list();
}

/**
 * اتحاد فصول العمل عبر مصادره.
 *
 * فصلان برقم واحد يفوز أحدهما، والمرجَّح هو فصل المصدر الأكثر فصولًا لهذا
 * العمل: المصدر الذي بلغ ١٣٠٠ يتابعه صاحبُه، والذي وقف عند ١٢٠٠ هجره —
 * وترجيحُ الأول يعطي أحدث الترجمات لا أقدمها. والتساوي يُحسم بترتيب
 * المصادر كما وردت، فالنتيجة ثابتة لا تتبدّل بين تشغيلين.
 *
 * وما لا رقم له يُذيَّل بلا دمج عددي — يُنقّى من التكرار بالاسم وحده، إذ لا
 * سبيل إلى ترتيب فصلٍ لا يقول أين موضعه.
 */
export function mergeChapters(editions, { rank = null } = {}) {
	const byNumber = new Map();
	const loose = new Map();
	// `rank` (اختياري): أولوية المصدر، الأصغر أولًا — المصادر الموثوقة تفوز بالفصل
	// حين تملكه، والبقية تكمل ما ينقصها. التساوي بعدد الفصول كما كان.
	const tier = (e) => (rank ? rank(e.sourceId) : 0);
	const ranked = [...editions].sort((a, b) => tier(a) - tier(b) || (b.chapters?.length ?? 0) - (a.chapters?.length ?? 0));

	for (const edition of ranked) {
		for (const chapter of edition.chapters ?? []) {
			const number = chapterNumberOf(chapter);
			const row = {
				number,
				chapter,
				sourceId: edition.sourceId,
				label: edition.label,
				manga: edition.manga,
			};
			if (number < 0) {
				const key = normalizeTitle(chapter?.name);
				if (!loose.has(key)) loose.set(key, row);
			} else if (!byNumber.has(number)) {
				byNumber.set(number, row);
			}
		}
	}

	const numbered = [...byNumber.values()].sort((a, b) => b.number - a.number);
	return [...numbered, ...loose.values()];
}

export default {
	normalizeTitle,
	parseChapterNumber,
	chapterNumberOf,
	gather,
	createWorkIndex,
	groupWorks,
	mergeChapters,
	rankListing,
};
