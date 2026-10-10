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

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };

/**
 * عنوانٌ نُسخ من HTML كما هو: «Don&#039;t Breathe». يُفكّ قبل العرض وقبل المطابقة،
 * وإلا صار مفتاحه «don 039 t breathe» فانفصل عن العمل نفسه من مصدر آخر (بطاقة
 * مكررة بلا غلاف). مرتان تكفيان لما رُمّز مرتين («&amp;#039;»).
 */
export function decodeEntities(raw) {
	if (typeof raw !== 'string' || !raw.includes('&')) return raw;
	let text = raw;
	for (let i = 0; i < 2 && text.includes('&'); i++) {
		text = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
			if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
			const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
			return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
		});
	}
	return text;
}

/**
 * مفتاح مطابقة عملٍ عبر المصادر.
 *
 * وحدُّه معروف ومقصود: المطابقة على الحروف، فعملٌ يسمّيه مصدرٌ
 * `Solo Leveling` وآخر «سولو ليفلنج» يبقى عملين. نقلُ الأسماء بين
 * الأبجديتين تخمينٌ يدمج أعمالًا مختلفة أكثر مما يجمع المتشابهة، وخطؤه
 * يظهر للقارئ فصولًا من عملٍ آخر — وهذا أسوأ من بطاقتين.
 */
/**
 * وسم فريق الترجمة في أول العنوان أو آخره: «(WAN) Blue Lock»، «Hajime No Ippo
 * (BAKI)». أحرف لاتينية كبيرة قصيرة بين قوسين، في الطرف فقط — اسم الفريق لا العمل.
 */
const GROUP_TAG = /^\s*[([]\s*[A-Z]{2,6}\s*[)\]]\s*|\s*[([]\s*[A-Z]{2,6}\s*[)\]]\s*$/g;

export function normalizeTitle(raw) {
	if (typeof raw !== 'string') return '';
	const folded = fold(decodeEntities(raw).replace(LANGUAGE_TAG, ' ').replace(GROUP_TAG, ' '));
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

// ───────────────────────── الهوية الواحدة (ZERO DUPLICATE / ZERO WRONG MERGE) ─────────────────────────

/**
 * نطاقات لموقع واحد: نفس قاعدة البيانات ونفس أرقام المنشورات (فُحص حيًّا
 * 2026-10: mangalik.net وstarzmanga.com وsparkmanga.net وlink-manga.net
 * وmanga-lionz.org تعيد نفس الأعمال بنفس الأرقام). هي مصدر واحد في الهوية
 * والطلبات: نسخة واحدة تُسأل، والبقية بدائل.
 */
export const MIRROR_FAMILIES = Object.freeze([['mangalek', 'mangastarz', 'mangaspark', 'mangalink', 'mangalionz']]);
const slugOfSource = (sourceId) => String(sourceId ?? '').split('@')[0].split('.').pop()?.toLowerCase() ?? '';
export function mirrorFamily(sourceId) {
	const slug = slugOfSource(sourceId);
	return MIRROR_FAMILIES.find((f) => f.includes(slug))?.[0] ?? String(sourceId);
}

/** أبجدية الكلمة: لاتينية (وأرقام) أو غيرها (عربي…). */
const scriptOf = (word) => (/[a-z0-9]/.test(word) ? 'latin' : 'other');

/** كلمات المفتاح المميِّزة (بلا حشو): «the magic emperor» ← [magic, emperor]. */
const keyWords = (key) => meaningful(normalizeTitle(key));

/**
 * المفرد للمقارنة فقط (لا للعرض ولا للمفتاح): «machinations» ← «machination»،
 * «mercenarys» (ملكية فقدت فاصلتها في رابط) ← «mercenary»، «witches» ← «witch».
 * كلمة لاتينية من أربعة أحرف فأكثر؛ ما سواها كما هو. لا يُستعمل وحده دليلًا أبدًا:
 * إما داخل اسم بديل قاله المصدر، أو لعنوانين طويلين (ثلاث كلمات مميِّزة فأكثر).
 */
export function singular(word) {
	if (!/^[a-z]{4,}$/.test(word)) return word;
	if (/(?:ch|sh|x|z|ss)es$/.test(word)) return word.slice(0, -2);
	if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`;
	if (/[^su]s$/.test(word)) return word.slice(0, -1);
	return word;
}
const looseJoin = (words) => words.map(singular).join(' ');
/** مفتاح المقارنة المرنة لعنوان: الكلمات المميِّزة بمفردها. */
export const looseKey = (title) => looseJoin(keyWords(title));

/**
 * هل اسم البطاقة `key` من أسماء عملٍ آخر البديلة؟ يرجع الدليل أو null.
 *
 * بعض المصادر تكتب الأسماء البديلة نصًّا واحدًا بلا فاصل («امبراطور السحر
 * الامبراطور الشيطانى ديمونك امبرور Demonic Emperor»)، فلا يكفي التساوي:
 * نقبل المفتاح متتاليةً كاملة داخل الاسم البديل — بشرط كلمتين مميِّزتين
 * فأكثر و٨ أحرف، فكلمة واحدة شائعة («Magic») لا تدمج شيئًا أبدًا. ومفتاح بكلمة
 * واحدة لا يُقبل إلا مساويًا لاسم بديل كامل.
 *
 * والتساوي يقبل اختلاف المفرد والجمع والملكية («Machination» = «Machinations»
 * = «Mercenarys Machinations» في رابط) لاسمٍ من كلمتين مميِّزتين فأكثر: الاسم
 * البديل قاله المصدر نفسه، والفرق إملائي. أما «داخل نص أطول» فحرفيٌّ لا مرونة فيه.
 */
export function aliasEvidence(key, altNames) {
	return evidenceIn(keyWords(key), prepareNames(altNames));
}

const prepareNames = (names, exact = false) =>
	(names ?? []).filter((raw) => typeof raw === 'string').map((raw) => {
		const words = meaningful(normalizeTitle(raw));
		return { raw, words, loose: looseJoin(words), exact };
	});

/** نفس `aliasEvidence` على أسماء مطبَّعة مسبقًا (للفهرس: تُطبَّع مرة لكل عمل). */
function evidenceIn(words, prepared) {
	if (!words.length) return null;
	const joined = words.join(' ');
	const loose = looseJoin(words);
	const script = scriptOf(words[0]);
	for (const { raw, words: alt, loose: altLoose, exact } of prepared ?? []) {
		if (!alt.length) continue;
		if (alt.join(' ') === joined) return `= «${raw}»`;
		if (words.length < 2 || joined.replace(/\s/g, '').length < 8) continue;
		if (altLoose === loose) return `≈ «${raw}»`;
		// اسم من رابط المصدر (slug) يُقبل مساويًا فقط: الرابط قد يُقصّ عند طول ثابت
		if (exact) continue;
		// داخل نص أطول: يُقبل فقط إذا انتهى عند حدّ اسم واضح — أول النص أو آخره، أو
		// تغيّر الأبجدية (عربي↔لاتيني). «Attack on Titan» داخل «Attack on Titan
		// Requiem» يكمل اسمًا آخر بنفس الأبجدية: ليس دليلًا (عمل آخر).
		for (let i = 0; i + words.length <= alt.length; i++) {
			if (!words.every((w, j) => alt[i + j] === w)) continue;
			const before = alt[i - 1];
			const after = alt[i + words.length];
			if ((before === undefined || scriptOf(before) !== script) && (after === undefined || scriptOf(after) !== script)) return `⊂ «${raw}»`;
		}
	}
	return null;
}

const ORIGINAL_SCRIPT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/gu;
/**
 * العنوان الأصلي (هانغل/كانجي/كانا) من اسم بديل، أو null: الأحرف الأصلية وحدها بعد
 * NFKC بلا مسافات ولا ترقيم، أربعة فأكثر وغالبية الاسم. «魔皇大管家» نعم، «魔王» لا.
 * اسم بديل يجمع عدة أسماء في نص واحد («امبراطور السحر … Demonic Emperor») لا يُقرأ عنوانًا أصليًا.
 */
export function originalTitle(raw) {
	const text = String(raw ?? '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
	const chars = text.match(ORIGINAL_SCRIPT) ?? [];
	if (chars.length < 4 || chars.length < text.length * 0.8) return null;
	return chars.join('');
}

/**
 * عنوانان لعمل واحد بلا اسم بديل: نفس الكلمات المميِّزة («Wistoria’s Wand and
 * Sword» = «WISTORIA: WAND AND SWORD»، كلمتان فأكثر)، أو نفسها بفرق مفرد/جمع
 * وملكية فقط («The Regressed Mercenary’s Machinations» = «The Regressed
 * Mercenary's Machination») في عنوان لاتيني من ثلاث كلمات مميِّزة فأكثر و١٢ حرفًا.
 * «The Witch»/«The Witches» و«Solo Leveling»/«Solo Levelings» لا تُدمج، والأرقام
 * (موسم، جزء) جزء من الكلمات فلا يلتقي «Season 2» و«Season 3».
 */
export function titleTwins(a, b) {
	const wa = keyWords(a);
	const wb = keyWords(b);
	if (wa.length !== wb.length || wa.length < 2) return false;
	if (wa.join(' ') === wb.join(' ')) return true;
	if (wa.length < 3 || wa.join('').length < 12) return false;
	if (![...wa, ...wb].every((w) => /^[a-z0-9]+$/.test(w))) return false;
	return wa.every((w, i) => w === wb[i] || singular(w) === singular(wb[i]));
}

/**
 * اسم العمل من رابطه في المصدر، لعنوانٍ غير لاتيني فقط: مانجا تايم يسمّي
 * العمل «المرتزق العائد لديه خطة» ورابطه `/manhwa/the-regressed-mercenarys-machinations#…`.
 * الرابط اسم المصدر نفسه للعمل — دليل يربط العربي بالإنجليزي بلا ترجمة ولا تخمين.
 * ثلاث كلمات مميِّزة فأكثر، ومساويًا فقط (`evidenceIn` بـexact).
 */
export function slugName(manga) {
	const title = String(manga?.title ?? '');
	if (!title || /[a-z]/i.test(title)) return null;
	let memoPath = null;
	try {
		const memo = typeof manga?.memo === 'string' ? JSON.parse(manga.memo) : manga?.memo;
		memoPath = memo?.path ?? null;
	} catch {
		memoPath = null;
	}
	for (const raw of [manga?.url, memoPath]) {
		const path = String(raw ?? '').split(/[?#]/)[0];
		const segments = path.split('/').filter(Boolean).reverse();
		for (const segment of segments) {
			let s;
			try {
				s = decodeURIComponent(segment);
			} catch {
				s = segment;
			}
			if (!/^[a-z0-9]+(?:[-_][a-z0-9]+){2,}$/i.test(s)) continue;
			const words = s.split(/[-_]+/);
			// معرّفات لا أسماء: أرقام أو سلاسل ست عشرية
			if (words.filter((w) => /^[a-z]{2,}$/i.test(w)).length < 3) continue;
			const name = words.join(' ');
			if (meaningful(normalizeTitle(name)).length >= 3) return name;
		}
	}
	return null;
}

/**
 * فهرس الأعمال بالهوية الواحدة (ZERO DUPLICATE / ZERO WRONG MERGE).
 *
 * `aliases`: Map<مفتاح العمل، أسماؤه البديلة> (المشحونة + ما تعلّمه الجهاز من صفحات
 * الأعمال). وكل نسخة قد تحمل أدلتها معها: `manga.altNames` (أسماء MangaDex البديلة في
 * القائمة نفسها) واسمها من رابطها (`slugName`).
 *
 * الأدلة حوافّ بين المفاتيح، والبطاقة مكوّن متصل منها. وتُحسب دفعةً واحدة عند
 * `list()` فالنتيجة لا تتبع ترتيب وصول المصادر:
 *   1. توأم عنوان (`titleTwins`).
 *   2. اسم بديل محفوظ يملكه عمل واحد. اسم يملكه عملان غير متصلين غامض: يُرفض.
 *   3. نسخة تقول «اسمي الآخر X» وX بطاقة: تنضم إليها. وإن أشارت لبطاقتين غير
 *      متصلتين فهي غامضة: تُرفض.
 * وحارسٌ فوق الكل: مصدرٌ (عائلة مرايا) يعرض العنوانين عملين منفصلين فهما عملان —
 * لا دمج أبدًا. دمج عملين مختلفين أسوأ من بطاقتين.
 *
 * مفتاح البطاقة ثابت بقاعدة لا بالترتيب: مالك أسماء محفوظة، وإلا الاسم الذي أشارت
 * إليه نسخ أكثر، وإلا الأطول، وإلا الأسبق أبجديًا.
 */
export function canonicalIndex({ aliases = new Map() } = {}) {
	const entries = [];
	const rejected = [];
	// الأسماء المحفوظة مطبَّعة مرة، وفهرس كلماتها (بالمفرد) فلا يُقارن اسم إلا بمن
	// يشاركه كلماته (آلاف الأعمال بلا كلفة تربيعية)
	const prepared = new Map();
	const byWord = new Map();
	for (const [owner, names] of aliases) {
		const list = prepareNames(names);
		prepared.set(owner, list);
		for (const { words } of list) for (const w of words) {
			const k = singular(w);
			if (!byWord.has(k)) byWord.set(k, new Set());
			byWord.get(k).add(owner);
		}
	}
	const staticClaimers = (key) => {
		const words = keyWords(key);
		let candidates = null;
		for (const w of words) {
			const set = byWord.get(singular(w));
			if (!set) return [];
			candidates = candidates ? new Set([...candidates].filter((o) => set.has(o))) : new Set(set);
		}
		return [...(candidates ?? [])].filter((owner) => owner !== key && evidenceIn(words, prepared.get(owner))).sort();
	};

	let state = null;
	const compute = () => {
		if (state) return state;
		rejected.length = 0;
		const parent = new Map();
		const families = new Map(); // جذر ← Map<عائلة، Set<مفتاح>>
		const nodes = new Set();
		const touch = (k) => {
			if (!nodes.has(k)) {
				nodes.add(k);
				parent.set(k, k);
				families.set(k, new Map());
			}
		};
		const find = (k) => {
			let r = k;
			while (parent.get(r) !== r) r = parent.get(r);
			let c = k;
			while (parent.get(c) !== r) {
				const next = parent.get(c);
				parent.set(c, r);
				c = next;
			}
			return r;
		};
		for (const e of entries) {
			touch(e.own);
			const fam = families.get(e.own);
			if (!fam.has(e.family)) fam.set(e.family, new Set());
			fam.get(e.family).add(e.own);
		}
		/** مصدرٌ يعرض المفتاحين عملين منفصلين؟ */
		const conflict = (ra, rb) => {
			const fa = families.get(ra);
			const fb = families.get(rb);
			for (const [family, keys] of fa) {
				const other = fb.get(family);
				if (other && [...other].some((k) => !keys.has(k))) return family;
			}
			return null;
		};
		const union = (a, b, why) => {
			touch(a);
			touch(b);
			const ra = find(a);
			const rb = find(b);
			if (ra === rb) return true;
			const family = conflict(ra, rb);
			if (family) {
				rejected.push(`«${a}» ≠ «${b}» (${why}): ${family} يعرضهما عملين`);
				return false;
			}
			parent.set(rb, ra);
			for (const [f, keys] of families.get(rb)) {
				if (!families.get(ra).has(f)) families.get(ra).set(f, new Set());
				for (const k of keys) families.get(ra).get(f).add(k);
			}
			families.delete(rb);
			return true;
		};

		const entryKeys = [...new Set(entries.map((e) => e.own))].sort();
		// 1) توائم العناوين: نفس المفتاح المرن
		const byLoose = new Map();
		for (const k of entryKeys) {
			const l = looseKey(k);
			if (!l) continue;
			if (!byLoose.has(l)) byLoose.set(l, []);
			byLoose.get(l).push(k);
		}
		for (const group of byLoose.values()) {
			for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
				if (titleTwins(group[i], group[j])) union(group[i], group[j], 'توأم عنوان');
			}
		}
		// 2) الأسماء المحفوظة: من يملك هذا الاسم؟
		const contested = [];
		const staticOwners = new Set();
		for (const k of entryKeys) {
			if (aliases.has(k)) staticOwners.add(k);
			const owners = staticClaimers(k);
			for (const o of owners) staticOwners.add(o);
			if (owners.length === 1) union(owners[0], k, 'اسم بديل');
			else if (owners.length > 1) contested.push([k, owners]);
		}
		// 3) أدلة النسخ نفسها: «اسمي الآخر X» وX بطاقة
		const pointed = new Map();
		const pointers = new Map();
		for (const e of entries) {
			if (!e.names.length) continue;
			const own = pointers.get(e.own) ?? [];
			pointers.set(e.own, own.concat(e.names));
		}
		const words = new Map(entryKeys.map((k) => [k, keyWords(k)]));
		for (const [from, names] of [...pointers].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
			const targets = new Set();
			for (const l of new Set(names.map((n) => n.loose))) {
				// اسم من كلمتين مميِّزتين فأكثر: «Monster» وحده لا يشير إلى عمل بعينه
				for (const k of byLoose.get(l) ?? []) if (k !== from && words.get(k).length >= 2 && evidenceIn(words.get(k), names)) targets.add(k);
			}
			if (!targets.size) continue;
			const roots = new Set([...targets].map(find));
			roots.delete(find(from));
			if (roots.size > 1) {
				rejected.push(`«${from}» ← ${[...targets].map((t) => `«${t}»`).join(' / ')}`);
				continue;
			}
			for (const t of targets) {
				if (union(t, from, 'اسم من المصدر')) pointed.set(t, (pointed.get(t) ?? 0) + 1);
			}
		}
		// 2ب) اسم يملكه عملان: يُقبل فقط إن كانا عملًا واحدًا بأدلة أخرى
		for (const [k, owners] of contested) {
			const roots = new Set(owners.filter((o) => nodes.has(o)).map(find));
			if (roots.size === 1 && owners.every((o) => nodes.has(o))) union([...roots][0], k, 'اسم بديل');
			else rejected.push(`«${k}» ← ${owners.map((u) => `«${u}»`).join(' / ')}`);
		}

		// 4) العنوان الأصلي المشترك: «세계멸망전» عند MangaDex («World Extinction War») وعند
		// المصدر العربي («World Destruction War»). عنوان كوري/صيني/ياباني من أربعة أحرف فأكثر
		// ومطابق حرفيًا اسمٌ لعمل بعينه لا كلمة عامة؛ وحارس المصدر الواحد يبقى فوقه.
		const byOriginal = new Map();
		const noteOriginal = (k, raw) => {
			const o = originalTitle(raw);
			if (!o) return;
			if (!byOriginal.has(o)) byOriginal.set(o, new Set());
			byOriginal.get(o).add(k);
		};
		for (const k of entryKeys) for (const raw of aliases.get(k) ?? []) noteOriginal(k, raw);
		for (const e of entries) for (const n of e.names) noteOriginal(e.own, n.raw);
		for (const [o, keys] of [...byOriginal].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
			const list = [...keys].sort();
			for (let i = 1; i < list.length; i++) union(list[0], list[i], `عنوان أصلي «${o}»`);
		}

		// البطاقات: مكوّن لكل جذر، بمفتاح ثابت
		const members = new Map();
		for (const k of nodes) {
			const r = find(k);
			if (!members.has(r)) members.set(r, []);
			members.get(r).push(k);
		}
		const repOf = new Map();
		for (const [r, keys] of members) {
			const rank = (k) => [staticOwners.has(k) ? 0 : 1, -(pointed.get(k) ?? 0), -k.length];
			const rep = [...keys].sort((a, b) => {
				const ra = rank(a);
				const rb = rank(b);
				return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2] || (a < b ? -1 : a > b ? 1 : 0);
			})[0];
			repOf.set(r, rep);
		}
		const keyOf = new Map();
		for (const k of nodes) keyOf.set(k, repOf.get(find(k)));
		const works = new Map();
		for (const e of entries) {
			const key = keyOf.get(e.own);
			let work = works.get(key);
			if (!work) {
				work = { key, title: e.entry.manga.title, thumbnailUrl: null, editions: [], aliases: [], keys: [] };
				works.set(key, work);
			}
			work.editions.push(e.entry);
			work.thumbnailUrl ??= e.entry.manga.thumbnailUrl ?? null;
			if (!work.keys.includes(e.own)) work.keys.push(e.own);
		}
		for (const work of works.values()) {
			// اسم العمل الأصلي يظهر أيًّا كان المصدر الذي وصل أولًا؛ والبقية أسماء بديلة
			const main = work.editions.find((ed) => normalizeTitle(ed.manga.title) === work.key);
			if (main) work.title = main.manga.title;
			for (const ed of work.editions) {
				const t = ed.manga.title;
				if (normalizeTitle(t) !== work.key && t !== work.title && !work.aliases.includes(t)) work.aliases.push(t);
			}
		}
		state = { works, keyOf, staticClaimers };
		return state;
	};

	const api = {
		rejected,
		/** المفتاح القانوني لعنوان (لربط مراجع قديمة بالعمل الذي صار جزءًا منه). */
		canonicalOf: (title) => {
			const own = normalizeTitle(title);
			if (!own) return '';
			const { keyOf } = compute();
			if (keyOf.has(own)) return keyOf.get(own);
			const owners = staticClaimers(own);
			if (owners.length === 1) return keyOf.get(owners[0]) ?? owners[0];
			return own;
		},
		/** مفتاح البطاقة التي صار إليها مفتاحُ نسخةٍ (`add` يعيد مفتاح النسخة نفسها). */
		keyOf: (own) => compute().keyOf.get(own) ?? own,
		/** يعيد `null` لما لا عنوان له، وإلا `{ key }` بمفتاح النسخة؛ البطاقة تُعرف عند `list()`. */
		add(entry) {
			const manga = entry?.manga;
			const own = normalizeTitle(manga?.title);
			if (!own) return null;
			const names = prepareNames([...(Array.isArray(manga.altNames) ? manga.altNames : [])].filter((n) => normalizeTitle(n) !== own));
			const slug = slugName(manga);
			if (slug) names.push(...prepareNames([slug], true));
			entries.push({ entry, own, family: mirrorFamily(entry.sourceId), names });
			state = null;
			return {
				key: own,
				get work() {
					return compute().works.get(api.keyOf(own));
				},
			};
		},
		list() {
			return [...compute().works.values()];
		},
	};
	return api;
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
/**
 * عدد الفصول كما يعدّه القارئ: الفصول الصحيحة فقط (128، 129)، والجانبية
 * (128.1، 128.2) والتمهيد (0) إضافات لا تُعدّ فصلًا. بهذا يطابق عددنا العدد
 * الرسمي (AniList) بدل 234 لعمل من 200 فصل. عملٌ بلا أرقام أصلًا يُعدّ بصفوفه.
 */
export function countMainChapters(rows) {
	let main = 0;
	for (const r of rows ?? []) {
		const n = Number(r?.number ?? chapterNumberOf(r));
		if (Number.isInteger(n) && n >= 1) main++;
	}
	return main || (rows?.length ?? 0);
}

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
