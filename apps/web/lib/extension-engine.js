/**
 * محرّك الإضافات — جهة القارئ.
 *
 * الطبقة الأصلية (`ExtensionEnginePlugin.kt`) تحمّل إضافة Keiyoushi من ملف
 * وتشغّلها في نفس العملية. هذا الملف لا يعرف عن المصادر شيئًا: لا روابط ولا
 * بصمات ولا أسماء مضيفات. بيان المصادر يسكن في `Sources.kt` وحده، ويُقرأ
 * بـ`sources()`.
 *
 * المتصفح لا يستطيع تحميل DEX. فنسخة الويب (PWA) لها جسرها الحقيقي بنفس
 * الواجهة: محركات مصادر ويب عبر جالب الويب (pwa/bridges/manga.js)، لا بيانات
 * تشبه الحقيقية. داخل الـAPK الجسر الأصلي وحده، و`webPlugin()` يرجع null هناك.
 * و`isAvailable()` تُسأل أولًا كما كانت.
 */

import { webPlugin, desktopPlugin } from '../pwa/platform.js';
import { assertVisible, choosePackage, entitlement, isBundled, onEntitlementChange, packageOf, visible, visiblePackages } from './source-entitlement.js';

/**
 * المحرك الأصلي يحمّل عند الإقلاع حزم المصادر الظاهرة لهذا الحساب فقط، فلا يُنزّل حساب جديد
 * حزمًا لم يضفها. تلميح أداء لا قرار ملكية: القرار يبقى هنا (`forSource`).
 */
onEntitlementChange(async (decision) => {
	const plugin = globalThis.Capacitor?.Plugins?.ExtensionEngine;
	if (decision.state === 'unknown' || typeof plugin?.setVisibleBuiltins !== 'function') return;
	try {
		const { sources: list } = await plugin.sources();
		if (entitlement() !== decision) return;
		await plugin.setVisibleBuiltins({ pkgs: visiblePackages(list ?? [], decision) });
	} catch {
		// التلميح يُعاد عند التغيير التالي؛ غيابه يعني تحميلًا عند أول طلب فقط
	}
});

/** الجسر الأصلي، أو جسر الـPWA في المتصفح، أو `null`. يُقرأ عند كل نداء. */
function bridge() {
	return globalThis.Capacitor?.Plugins?.ExtensionEngine ?? webPlugin('ExtensionEngine') ?? desktopPlugin('ExtensionEngine');
}

/** هل المحرّك موجود أصلًا؟ تُسأل قبل عرض أي واجهة مصادر. */
export function isAvailable() {
	return bridge() !== null;
}

/**
 * مصدر مدمج سابقًا غير مضاف لهذا الحساب لا يُطلب من المحرك (lib/source-entitlement.js):
 * يُرمى خطأ «أضف مصدرًا» (`SOURCE_NOT_ADDED`) قبل أي شبكة أو تنزيل حزمة.
 */
function forSource(sourceId) {
	assertVisible({ id: sourceId });
	return required();
}

function required() {
	const plugin = bridge();
	if (!plugin) {
		throw new Error('محرّك الإضافات غير متاح — هذه الشاشة تعمل داخل التطبيق فقط');
	}
	return plugin;
}

/**
 * بيان المصادر: `{ id, label, lib, version, warning, names, ready }`.
 *
 * `ready` يقول إن المصدر محمَّل في الذاكرة الآن، فالنداء التالي عليه فوري.
 * `warning` تصنيف الفهرس كما هو: `SAFE` أو `MIXED` (MangaDex). المحظور
 * بالسياسة لا يصل إلى هنا أصلًا.
 */
export async function sources() {
	const { sources: list } = await required().sources();
	return (list ?? []).filter((source) => visible(source));
}

/**
 * تنزيل ⇒ تحقّق بصمة ⇒ تحميل. يُنادى مرة قبل تصفّح مصدر.
 *
 * أول نداء يلمس الشبكة وقد يطول (تنزيل حزمة ~٦٠ كيلوبايت ثم فكّ DEX)، وما
 * بعده يُخدَم من الذاكرة. فالواجهة تُظهر «جارٍ فتح المصدر» على هذا وحده.
 */
export async function prepare(sourceId) {
	return forSource(sourceId).prepare({ sourceId });
}

/**
 * الكتالوج كاملًا لمصدر، صفحةً صفحة. `{ mangas, hasNextPage, page }`.
 *
 * هذا ما يتصفّحه «استكشاف»، لا `popular`: الرائج في Dilar عشرة أعمال من
 * تسعة آلاف، وفي MangaDex كل اللغات لا العربي.
 */
export async function catalogue(sourceId, page = 1) {
	return forSource(sourceId).catalogue({ sourceId, page });
}

/** الرائج — الواجهة الأولى عند فتح مصدر. `{ mangas, hasNextPage, page }`. */
export async function popular(sourceId, page = 1) {
	return forSource(sourceId).popular({ sourceId, page });
}

/** آخر التحديثات — ومنه يأتي «الجلب التلقائي» للفصول الجديدة. */
export async function latest(sourceId, page = 1) {
	return forSource(sourceId).latest({ sourceId, page });
}

/** أعمال تصنيف بفلتر المصدر. `names`: أسماء التصنيف بكل صيغها (عربي وإنجليزي). */
export async function genre(sourceId, names, page = 1) {
	return forSource(sourceId).genre({ sourceId, names, page });
}

export async function search(sourceId, query, page = 1) {
	return forSource(sourceId).search({ sourceId, query, page });
}

/**
 * تفاصيل عمل وفصوله معًا: `{ manga, chapters }`.
 *
 * نداءٌ واحد لا اثنان، وهذا شرط صحة لا تحسين: إضافات lib 1.6 ترمي
 * `getMangaUpdate must not be called concurrently for same manga` حين يصلها
 * طلبان لنفس العمل في وقت واحد. فلا تُشطر هذه إلى نداءين متوازيين ثانيةً.
 *
 * ويأخذ كائن العمل كاملًا لا رابطه: عقد lib 1.6 يعطي كل عمل حالةً خاصة
 * بالمصدر (`memo`) يحتاجها حين يُسأل عنه، وإرسال الرابط وحده يعني أن
 * المصدر يستقبل عملًا لا يعرفه. فمرّر ما جاءك كما جاءك.
 */
/**
 * مجسّ الفصول: كل فصول يجلبها أي مسار (Latest، البحث، صفحة العمل، الزحف،
 * التحديث) تمرّ على `Update Engine`. لا يغيّر ما يرجع للمستدعي ولا يؤخّره.
 */
let chapterSink = null;
export function onChapters(fn) {
	chapterSink = fn;
}
function sense(sourceId, manga, list) {
	try {
		chapterSink?.(sourceId, manga, list);
	} catch {
		// المجسّ لا يكسر القراءة أبدًا
	}
}

export async function series(sourceId, manga) {
	const out = await forSource(sourceId).series({ sourceId, manga });
	sense(sourceId, out.manga ?? manga, out.chapters ?? []);
	return { manga: out.manga, chapters: out.chapters ?? [] };
}

/** فصول عمل. نفس قاعدة `memo`: مرّر كائن العمل كما جاءك من البحث أو الرائج. */
export async function chapters(sourceId, manga) {
	const { chapters: list } = await forSource(sourceId).chapters({ sourceId, manga });
	sense(sourceId, manga, list ?? []);
	return list ?? [];
}

/** صفحات فصل. مرّر كائن الفصل كما جاءك من `chapters()`. */
export async function pages(sourceId, chapter) {
	const { pages: list } = await forSource(sourceId).pages({ sourceId, chapter });
	return list ?? [];
}

/**
 * رابط صورة صفحة، جاهزًا لـ`<img src>`.
 *
 * الطبقة الأصلية تنزّل بعميل المصدر وترويساته — مضيفات الصور تردّ 403 بلا
 * `Referer` الصحيح — ثم تكتب الملف في كاش التطبيق وترجع مساره. و
 * `convertFileSrc` يحوّله إلى رابط يقرؤه الـWebView من خادم Capacitor
 * المحلي، فلا تمرّ بايتات الصورة عبر جسر JSON ولا تسكن ذاكرة الصفحة.
 */
export async function pageImage(sourceId, page) {
	const result = await required().image({ sourceId, page });
	const convert = globalThis.Capacitor?.convertFileSrc;
	return {
		...result,
		src: convert ? convert(result.path) : result.dataUrl ?? result.path,
	};
}

/** إفراغ كاش الصفحات. يُنادى من «امسح التنزيلات» أو عند ضيق التخزين. */
/**
 * غلاف عمل بعميل مصدره، محفوظ على الجهاز. يرجع رابطًا يقرؤه `<img>`.
 * `sourceId` اختياري: بدونه يُجلب بعميل عام (أفضل من لا شيء).
 */
export async function cover(sourceId, url) {
	const result = await required().cover({ sourceId: sourceId ?? null, url });
	const convert = globalThis.Capacitor?.convertFileSrc;
	return convert ? convert(result.path) : result.path;
}

export async function clearImageCache() {
	return required().clearImageCache();
}

/**
 * مستودعات المانجا التي يضيفها المستخدم (صيغة Mihon/Keiyoushi). داخل التطبيق وحده:
 * الإضافة كود DEX يعمل في الجهاز، والمتصفح لا يشغّله. `null` حيث لا تتوفر.
 */
export function repositories() {
	const plugin = bridge();
	if (typeof plugin?.addRepo !== 'function') return null;
	// حزمة كانت مدمجة تظهر في مستودعها (Keiyoushi) كأي إضافة: «تثبيتها» يضيفها لحسابك بمعرّفها
	// القديم نفسه (لا نسخة ثانية ولا معرّف جديد)، و«حذفها» يزيلها من حسابك دون مسّ المكتبة.
	const formerlyBundled = new Set();
	return {
		list: () => plugin.repos(),
		add: (url) => plugin.addRepo({ url }),
		remove: (url) => plugin.removeRepo({ url }),
		extensions: async (url) => ((await plugin.repoIndex({ url })).extensions ?? []).map((ext) => {
			if (!ext?.builtin) return ext;
			formerlyBundled.add(ext.pkg);
			const added = visible({ id: ext.pkg });
			return { ...ext, builtin: false, formerlyBundled: true, installed: added ? ext.installed ?? ext.version : null, update: false };
		}),
		install: (repo, pkg) => formerlyBundled.has(pkg) ? installFormer(plugin, pkg) : plugin.installExtension({ repo, pkg }),
		uninstall: (pkg) => formerlyBundled.has(pkg) ? removeFormer(plugin, pkg) : plugin.uninstallExtension({ pkg }),
	};
}

/**
 * «مصادر جاهزة»: مصادر المانجا التي كانت تُشحن داخل التطبيق، بصيغة مستودع يقرؤه مدير الإضافات
 * (addons-v7.js) على كل المنصات. الإضافة والإزالة اختيار متزامن في حسابك
 * (lib/source-entitlement.js)، والمعرّف هو نفسه دائمًا، فلا تتكرر المصادر ولا تنقطع المكتبة.
 */
/**
 * حزمة كانت مدمجة، بعد فصلها، تُثبَّت كأي إضافة فعلًا: تُضاف لحسابك ثم تُنزَّل موثّقة وتُحمَّل الآن
 * (يظهر شعارها ويُعرف فشلها فورًا). فشل التحميل يرجع الاختيار كما كان ويُعرض سببه.
 */
async function installFormer(plugin, pkg) {
	await choosePackage(pkg, true);
	const id = ((await plugin.sources()).sources ?? []).map((s) => s.id).find((sid) => packageOf(sid) === pkg && !String(sid).includes('#'));
	try { if (id) await plugin.prepare({ sourceId: id }); }
	catch (error) { await choosePackage(pkg, false).catch(() => {}); throw error; }
}

/** حذف حقيقي: من حسابك ومن الجهاز (نسختها المحفوظة)، فإعادة التثبيت تنزّلها من Keiyoushi. المكتبة والتقدم باقيان. */
async function removeFormer(plugin, pkg) {
	await choosePackage(pkg, false);
	if (typeof plugin.removeBuiltin === 'function') await plugin.removeBuiltin({ pkg });
}

export const READY_REPOSITORY = 'vantara:ready-sources';
export function readySources() {
	if (!bridge()) return null;
	const items = async () => {
		const { sources: list } = await required().sources();
		const byPackage = new Map();
		for (const source of list ?? []) {
			if (!isBundled(source) || source.filler) continue;
			const pkg = packageOf(source.id);
			if (byPackage.has(pkg)) continue;
			const added = visible(source);
			byPackage.set(pkg, {
				pkg, name: source.label ?? pkg, version: String(source.version ?? ''), lang: source.lang ?? 'ar',
				arabic: String(source.lang ?? 'ar').toLowerCase() === 'ar', nsfw: false, anime: false,
				installed: added ? String(source.version ?? true) : null, update: false, formerlyBundled: true,
				sources: source.names ?? [source.label ?? pkg], ...(source.iconUrl ? { iconUrl: source.iconUrl } : {}),
			});
		}
		return [...byPackage.values()];
	};
	return {
		list: async () => ({
			repos: [{ url: READY_REPOSITORY, name: 'مصادر جاهزة' }],
			installed: (await items()).filter((x) => x.installed).map((x) => ({ ...x, repo: READY_REPOSITORY })),
		}),
		add: async () => { throw new Error('هذا المستودع جزء من التطبيق'); },
		remove: async () => { throw new Error('هذا المستودع جزء من التطبيق'); },
		extensions: () => items(),
		// مثل مستودعها الأصلي: التثبيت يُنزّل ويحمّل فعلًا، والحذف يمحو نسختها من الجهاز
		install: (_repo, pkg) => installFormer(required(), pkg),
		uninstall: (pkg) => removeFormer(required(), pkg),
	};
}

/**
 * مواقع مانجا يضيفها المستخدم برابطها (الويب والويندوز، حيث لا تعمل إضافات Mihon):
 * يُكتشف قالب الموقع ويُفحص قبل الإضافة. `null` حيث لا تتوفر (التطبيق له المستودعات).
 */
export function sites() {
	const plugin = bridge();
	if (typeof plugin?.addSite !== 'function') return null;
	return {
		list: async () => (await plugin.sites()).sites ?? [],
		add: (url) => plugin.addSite({ url }),
		remove: (id) => plugin.removeSite({ id }),
	};
}

export default {
	cover,
	repositories,
	readySources,
	sites,
	isAvailable,
	sources,
	prepare,
	catalogue,
	popular,
	latest,
	genre,
	search,
	series,
	chapters,
	pages,
	pageImage,
	clearImageCache,
};
