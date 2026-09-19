/**
 * تصفّح المصادر وقراءتها.
 *
 * أربع شاشات متسلسلة: المصادر ← مصدر ← عمل ← قراءة. ولا خادم محتوى في
 * الطريق: كل نداء يذهب إلى محرّك الإضافات في الطبقة الأصلية، وهو يحمّل
 * إضافة Keiyoushi من ملف ويشغّلها في نفس العملية.
 *
 * قاعدةٌ تحكم الملف كله: **كائنات العمل والفصل تُمرَّر كما جاءت**. عقد
 * lib 1.6 يعطي كل عمل حالةً خاصة بالمصدر (`memo`) يحتاجها حين يُسأل عن
 * تفاصيله أو فصوله، وإرسال الرابط وحده يعني أن المصدر يستقبل عملًا لا
 * يعرفه — والعطل يظهر بعد خطوتين من موضعه. فلا تُعاد بناء هذه الكائنات
 * هنا أبدًا، ولا تُختصر إلى معرّف.
 */

import engine from '../lib/extension-engine.js';

const el = (tag, className, text) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

/**
 * الخطأ يُعرض بنصّه كما جاء من المحرّك.
 *
 * «تعذّر التحميل» لا يقول شيئًا، ورسالة المحرّك تقول أي خطوة سقطت وبأي
 * استثناء — وهي الفرق بين تشخيصٍ في دقيقة وتخمينٍ في ساعة.
 */
function errorBox(error, onRetry) {
	const box = el('div', 'state state--error');
	box.append(el('p', null, String(error?.message ?? error)));
	if (onRetry) {
		const retry = el('button', 'btn btn--small', 'أعد المحاولة');
		retry.type = 'button';
		retry.addEventListener('click', onRetry);
		box.append(retry);
	}
	return box;
}

const busy = (text) => el('div', 'state', text);

/** بطاقة عمل من مصدر. الغلاف قد يغيب، والبطاقة تبقى قابلة للنقر. */
function mangaCard(manga, onOpen) {
	const card = el('button', 'tile');
	card.type = 'button';
	const shot = el('div', 'tile__shot');
	const cover = el('img', 'tile__cover');
	cover.loading = 'lazy';
	cover.decoding = 'async';
	cover.alt = '';
	if (manga.thumbnailUrl) {
		cover.src = manga.thumbnailUrl;
		cover.addEventListener('error', () => shot.classList.add('tile__shot--blank'), { once: true });
	} else {
		shot.classList.add('tile__shot--blank');
	}
	shot.append(cover);
	card.append(shot, el('div', 'tile__title', manga.title || '—'));
	card.addEventListener('click', () => onOpen(manga));
	return card;
}

// ───────────────────────────── ١) المصادر ─────────────────────────────

export async function screenSources({ mount, topbar, bottomNav, go, setScreen }) {
	setScreen?.('EXPLORE');
	const wrap = el('main', 'page');
	wrap.append(topbar({ title: 'المصادر', back: () => go({ name: 'home' }) }));
	const body = el('div', 'page__body');
	wrap.append(body, bottomNav('explore'));
	mount(wrap);

	// لا بديل وهمي على الويب: شاشةٌ تعرض بيانات تشبه الحقيقية تجعل
	// المكسور يبدو سليمًا، وهذا أسوأ من قول «غير متاح» صراحة.
	if (!engine.isAvailable()) {
		body.append(
			el('div', 'state', 'المصادر تعمل داخل تطبيق أندرويد فقط — محرّك الإضافات ليس في المتصفح.'),
		);
		return;
	}

	const loading = busy('جارٍ قراءة بيان المصادر…');
	body.append(loading);
	try {
		const list = await engine.sources();
		const rows = el('div', 'list');
		for (const source of list) {
			const row = el('button', 'list__row');
			row.type = 'button';
			row.append(el('span', null, source.label));
			row.append(el('span', 'pill', source.ready ? 'جاهز' : `lib ${source.lib}`));
			row.addEventListener('click', () =>
				go({ name: 'source', sourceId: source.id, label: source.label }),
			);
			rows.append(row);
		}
		loading.replaceWith(rows);
	} catch (error) {
		loading.replaceWith(
			errorBox(error, () => void screenSources({ mount, topbar, bottomNav, go })),
		);
	}
}

// ───────────────────────────── ٢) مصدر واحد ─────────────────────────────

/**
 * تصفّح مصدر: الرائج افتراضًا، والبحث يستبدله.
 *
 * أول فتح ينزّل الحزمة ويتحقق من بصمتها ويفكّ الـDEX، وقد يطول بضع ثوانٍ؛
 * وما بعده من الذاكرة. فسطر الانتظار يقول «جارٍ فتح المصدر» في الصفحة
 * الأولى وحدها، و«جارٍ جلب المزيد» فيما بعدها.
 */
export async function screenSource({ mount, topbar, bottomNav, go, setScreen, sourceId, label }) {
	setScreen?.('EXPLORE');
	const wrap = el('main', 'page');
	wrap.append(topbar({ title: label ?? 'مصدر', back: () => go({ name: 'sources' }) }));
	const body = el('div', 'page__body');

	const form = el('form', 'search');
	const input = el('input', 'search__input');
	input.type = 'search';
	input.placeholder = 'ابحث في هذا المصدر…';
	const submit = el('button', 'search__go', 'بحث');
	submit.type = 'submit';
	form.append(input, submit);

	const status = el('div');
	const results = el('div', 'tiles');
	const footer = el('div', 'tiles__more');
	body.append(form, status, results, footer);
	wrap.append(body, bottomNav('explore'));
	mount(wrap);

	let mode = { kind: 'popular', query: '' };
	let page = 1;
	let loading = false;

	async function fetchPage(reset) {
		if (loading) return;
		loading = true;
		footer.replaceChildren();
		if (reset) {
			results.replaceChildren();
			page = 1;
		}
		status.replaceChildren(busy(page === 1 ? 'جارٍ فتح المصدر…' : 'جارٍ جلب المزيد…'));
		try {
			const result =
				mode.kind === 'search'
					? await engine.search(sourceId, mode.query, page)
					: await engine.popular(sourceId, page);
			const mangas = result.mangas ?? [];
			status.replaceChildren();
			for (const manga of mangas) {
				results.append(
					mangaCard(manga, (chosen) => go({ name: 'extSeries', sourceId, label, manga: chosen })),
				);
			}
			if (mangas.length === 0 && page === 1) {
				status.replaceChildren(el('div', 'state', 'لا نتائج.'));
			}
			if (result.hasNextPage) {
				const more = el('button', 'btn btn--ghost', 'المزيد');
				more.type = 'button';
				more.addEventListener('click', () => {
					page += 1;
					void fetchPage(false);
				});
				footer.append(more);
			}
		} catch (error) {
			status.replaceChildren(errorBox(error, () => void fetchPage(reset)));
		} finally {
			loading = false;
		}
	}

	form.addEventListener('submit', (event) => {
		event.preventDefault();
		const query = input.value.trim();
		mode = query ? { kind: 'search', query } : { kind: 'popular', query: '' };
		void fetchPage(true);
	});

	await fetchPage(true);
}

// ───────────────────────────── ٣) عمل واحد ─────────────────────────────

export async function screenExtSeries({ mount, topbar, bottomNav, go, setScreen, sourceId, label, manga }) {
	setScreen?.('SERIES');
	const wrap = el('main', 'page');
	wrap.append(
		topbar({
			title: manga.title || 'عمل',
			back: () => go({ name: 'source', sourceId, label }),
		}),
	);
	const body = el('div', 'page__body');

	const head = el('section', 'work');
	const cover = el('img', 'work__cover');
	cover.alt = '';
	if (manga.thumbnailUrl) cover.src = manga.thumbnailUrl;
	const meta = el('div', 'work__meta');
	meta.append(el('h1', 'work__title', manga.title || '—'));
	const description = el('p', 'work__desc', manga.description ?? '');
	meta.append(description);
	head.append(cover, meta);

	const status = el('div');
	const list = el('ul', 'chapters');
	body.append(head, status, list);
	wrap.append(body, bottomNav('explore'));
	mount(wrap);

	// التفاصيل والفصول نداءان منفصلان بقصد: الفصول هي ما جاء القارئ لأجله،
	// وربطُها بنجاح التفاصيل يجعل عملًا وصفُه مكسور عملًا لا يُقرأ.
	void engine
		.details(sourceId, manga)
		.then((full) => {
			if (full?.description) description.textContent = full.description;
		})
		.catch(() => {});

	status.replaceChildren(busy('جارٍ جلب الفصول…'));
	try {
		const chapters = await engine.chapters(sourceId, manga);
		if (chapters.length === 0) {
			status.replaceChildren(el('div', 'state', 'لا فصول في هذا العمل.'));
			return;
		}
		status.replaceChildren(el('div', 'state', `${chapters.length} فصل`));
		for (const chapter of chapters) {
			const item = el('li');
			const row = el('button', 'chapter');
			row.type = 'button';
			row.append(el('span', 'chapter__name', chapter.name || '—'));
			if (chapter.scanlator) row.append(el('span', 'pill', chapter.scanlator));
			row.addEventListener('click', () =>
				go({ name: 'extReader', sourceId, label, manga, chapter }),
			);
			item.append(row);
			list.append(item);
		}
	} catch (error) {
		status.replaceChildren(
			errorBox(error, () =>
				void screenExtSeries({ mount, topbar, bottomNav, go, sourceId, label, manga }),
			),
		);
	}
}

// ───────────────────────────── ٤) القراءة ─────────────────────────────

/** كم صفحة تُجلب معًا. ثلاثٌ تكفي للتمرير المتصل بلا أن تخنق شبكة الجوال. */
const PAGE_CONCURRENCY = 3;

export async function screenExtReader({ mount, topbar, go, setScreen, sourceId, label, manga, chapter }) {
	setScreen?.('READER');
	const wrap = el('main', 'page');
	wrap.append(
		topbar({
			title: chapter.name || 'قراءة',
			back: () => go({ name: 'extSeries', sourceId, label, manga }),
		}),
	);
	const shell = el('div', 'reader');
	const flow = el('div', 'reader__flow');
	const status = el('div');
	shell.append(status, flow);
	wrap.append(shell);
	mount(wrap);

	status.replaceChildren(busy('جارٍ جلب الصفحات…'));
	let pages;
	try {
		pages = await engine.pages(sourceId, chapter);
	} catch (error) {
		status.replaceChildren(
			errorBox(error, () =>
				void screenExtReader({ mount, topbar, go, sourceId, label, manga, chapter }),
			),
		);
		return;
	}

	if (pages.length === 0) {
		status.replaceChildren(el('div', 'state', 'الفصل بلا صفحات.'));
		return;
	}
	status.replaceChildren();

	// الإطارات تُبنى كلها أولًا فيصير للتمرير طولٌ من البداية، ثم تُملأ.
	// وبلا ذلك يقفز المحتوى تحت الإصبع كلما وصلت صورة.
	const slots = pages.map((page) => {
		const frame = el('div', 'reader__frame');
		flow.append(frame);
		return { page, frame };
	});

	let next = 0;
	async function worker() {
		while (next < slots.length) {
			const slot = slots[next];
			next += 1;
			try {
				const image = await engine.pageImage(sourceId, slot.page);
				const img = el('img', 'reader__image');
				img.alt = '';
				img.decoding = 'async';
				img.src = image.src;
				slot.frame.replaceChildren(img);
			} catch (error) {
				// صفحة تسقط لا تُسقط الفصل: يُعرض سببها في مكانها، وتُعاد
				// محاولتها وحدها — وما بعدها يبقى يُجلب.
				slot.frame.classList.add('reader__frame--error');
				slot.frame.replaceChildren(
					errorBox(error, () => {
						slot.frame.classList.remove('reader__frame--error');
						slot.frame.replaceChildren();
						void retry(slot);
					}),
				);
			}
		}
	}

	async function retry(slot) {
		try {
			const image = await engine.pageImage(sourceId, slot.page);
			const img = el('img', 'reader__image');
			img.alt = '';
			img.decoding = 'async';
			img.src = image.src;
			slot.frame.replaceChildren(img);
		} catch (error) {
			slot.frame.classList.add('reader__frame--error');
			slot.frame.replaceChildren(errorBox(error, () => void retry(slot)));
		}
	}

	await Promise.all(Array.from({ length: PAGE_CONCURRENCY }, () => worker()));
}
