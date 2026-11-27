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
import { FORMER_BUILTIN_SOURCES, assertChoiceContext, assertVisible, choiceContext, choosePackage, entitlement, isBundled, onEntitlementChange, packageOf, visible, visiblePackages } from './source-entitlement.js';

/**
 * تغيّر المصادر (تثبيت، حذف، تحديث، رجوع، ترحيل، موقع ويب): من يحفظ قائمتها يمسحها فورًا (works.js). كانت قائمة
 * المصادر تُحفظ للجلسة، فإضافة ثُبّتت والتطبيق مفتوح لا تظهر في مصادر أي عمل حتى إعادة التشغيل (بلاغ المالك 21 نوفمبر).
 */
const sourcesListeners = new Set();
export function onSourcesChanged(fn) {
	sourcesListeners.add(fn);
	return () => sourcesListeners.delete(fn);
}
function sourcesChanged() {
	for (const fn of sourcesListeners) { try { fn(); } catch { /* مستمع معطوب لا يوقف الباقي */ } }
	try { globalThis.document?.dispatchEvent?.(new CustomEvent('vantara:addons-changed')); } catch { /* بيئة بلا أحداث */ }
}
/**
 * ما فعله المستخدم بيده على هذا الجهاز (تثبيت/حذف إضافة، إضافة/إزالة مستودع): مزامنة الحساب تكتبه
 * (lib/extension-sync.js). ما تفعله المزامنة نفسها لا يمر من هنا، فلا يرتد.
 */
const localListeners = new Set();
export function onLocalExtensionChange(fn) {
	localListeners.add(fn);
	return () => localListeners.delete(fn);
}
function localChange(change) {
	for (const fn of localListeners) { try { fn(change); } catch { /* مستمع معطوب لا يوقف الباقي */ } }
}
/** نداء يغيّر المصادر: يُبلَّغ بعد نجاحه فقط. */
const changing = (fn) => async (...args) => { const out = await fn(...args); sourcesChanged(); return out; };

/** حزم مثبّتة كإضافات على هذا الجهاز (`user` في بيان المحرك)، من آخر قراءة للبيان. */
const installedPackages = new Set();
function noteInstalled(list) {
	installedPackages.clear();
	for (const source of list ?? []) if (source?.user) installedPackages.add(packageOf(source.id));
}

/**
 * المحرك الأصلي يحمّل عند الإقلاع حزم المصادر الظاهرة لهذا الحساب فقط، فلا يُنزّل حساب جديد
 * حزمًا لم يضفها. تلميح أداء لا قرار ملكية: القرار يبقى هنا (`forSource`).
 */
onEntitlementChange(async (decision) => {
	const plugin = globalThis.Capacitor?.Plugins?.ExtensionEngine;
	if (!plugin) {
		// ويندوز: لا migrateBuiltins أصلي؛ الترحيل نفسه بالتثبيت من Keiyoushi عبر محرك Mihon المحلي
		const desktop = desktopPlugin('ExtensionEngine');
		if (!desktop) return;
		try {
			const { sources: list } = await desktop.sources();
			if (entitlement() !== decision) return;
			// الحزم من جدول المعرّفات القديمة (لا من تعريفات ويب لم تعد في الحزمة)، بقرار الظهور نفسه
			await migrateDesktopBuiltins(desktop, decision, FORMER_BUILTIN_SOURCES.filter((s) => visible(s, decision)).map((s) => s.id), list ?? []);
		} catch { /* يُعاد عند التغيير التالي */ }
		return;
	}
	try {
		const { sources: list } = await plugin.sources();
		noteInstalled(list);
		if (entitlement() !== decision) return;
		const pkgs = visiblePackages(list ?? [], decision);
		if (decision.state !== 'unknown' && typeof plugin.setVisibleBuiltins === 'function') await plugin.setVisibleBuiltins({ pkgs });
		await migrateBuiltins(plugin, decision, pkgs);
	} catch {
		// التلميح والترحيل يُعادان عند التغيير التالي؛ غيابهما يعني تحميلًا عند أول طلب فقط
	}
});

/**
 * المرحلة 2 من «صفر مصادر مدمجة» (docs/audits/ZERO_BUILTIN_MIGRATION_PLAN.md): ما يراه الحساب من المدمجة يصير
 * إضافات مثبّتة على الجهاز (BuiltinMigration.kt)، مرة واحدة وبالمعرّفات نفسها. فقط لفوج معروف: الحساب القديم
 * والجديد و«بلا حساب». حساب لم يصل صفه بعد لا يُرحَّل (يبقى كما هو حتى يصل)، فتأخر المزامنة لا يخفي شيئًا.
 * الحساب القديم و«بلا حساب» يُحفظ لهما مستودع Keiyoushi فيستمر التحديث؛ الجديد لا (قرار المالك 21 نوفمبر).
 */
export async function migrateBuiltins(plugin, decision, pkgs) {
	if (typeof plugin?.migrateBuiltins !== 'function' || !pkgs.length) return null;
	if (decision.state === 'unknown' && !decision.standalone) return null;
	// الحساب القديم قبل معرفة استعماله (المزامنة لم تكتمل): لا ترحيل، وإلا ثُبّت كل المدمج («لا 19 جاهزة»)
	if (decision.state === 'legacy' && !decision.used) return null;
	const out = await plugin.migrateBuiltins({ pkgs, keepRepository: decision.state === 'legacy' || decision.standalone === true });
	for (const pkg of out?.migrated ?? []) installedPackages.add(String(pkg));
	if (out?.migrated?.length) sourcesChanged();
	// آلية الترحيل الآمنة (قرار المالك 27 نوفمبر): حزمة تعذّر ترحيلها بنسختها المثبّتة (Keiyoushi يحذف الإصدارات القديمة)
	// تُثبَّت بأحدث إصدار موقّع من المستودع نفسه، ويُعاد كل 10 دقائق حتى تنجح. لا يُحذف شيء، والمعرّف القديم يبقى.
	const failed = (out?.failed ?? []).map(String).filter((pkg) => !installedPackages.has(pkg));
	if (failed.length && typeof plugin.installExtension === 'function' && typeof plugin.addRepo === 'function') {
		const rescue = await migrateDesktopBuiltins(plugin, decision, failed, [], Date.now()).catch(() => null);
		return { ...out, rescued: rescue?.migrated ?? [], failed: rescue?.failed ?? failed };
	}
	return out;
}

/** مستودع Keiyoushi الرسمي وبصمة توقيعه (BuiltinSourceRefresh.kt): المصدر الوحيد للحزم المدمجة سابقًا. */
export const KEIYOUSHI = Object.freeze({ url: 'https://raw.githubusercontent.com/keiyoushi/extensions/repo', fingerprint: '9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2' });
const desktopRetryAt = new Map();
/**
 * «صفر مصادر مدمجة» في ويندوز (قرار المالك 27 نوفمبر): ما يستعمله الحساب من المدمجة (visiblePackages بعد
 * usedPackagesFrom) يُثبَّت إضافة Mihon من Keiyoushi بالمعرّف نفسه، والجسر (desktop/boot.js) يقدّمها بمعرّفها القديم
 * فلا يُكتب صف واحد في المكتبة. فوج معروف فقط. فشل حزمة لا يوقف غيرها ولا يخفيها (تبقى على محرك الويب) ويُعاد بعد 10 دقائق.
 */
export async function migrateDesktopBuiltins(plugin, decision, pkgs, list = [], now = Date.now()) {
	if (typeof plugin?.installExtension !== 'function' || typeof plugin?.addRepo !== 'function' || !pkgs.length) return null;
	if (decision.state === 'unknown' && !decision.standalone) return null;
	if (decision.state === 'legacy' && !decision.used) return null;
	const installed = new Set((list ?? []).filter((s) => s?.user).map((s) => packageOf(s.id)));
	const todo = pkgs.filter((pkg) => !installed.has(pkg) && (desktopRetryAt.get(pkg) ?? 0) <= now);
	if (!todo.length) return null;
	try { await plugin.addRepo({ url: KEIYOUSHI.url, fingerprint: KEIYOUSHI.fingerprint }); }
	catch (error) { if (!/exist|موجود|مضاف/i.test(String(error?.message ?? ''))) { for (const pkg of todo) desktopRetryAt.set(pkg, now + 10 * 60_000); return { migrated: [], failed: todo }; } }
	const migrated = [], failed = [];
	for (const pkg of todo) {
		try { await plugin.installExtension({ repo: KEIYOUSHI.url, pkg }); migrated.push(pkg); installedPackages.add(pkg); }
		catch { failed.push(pkg); desktopRetryAt.set(pkg, now + 10 * 60_000); }
	}
	if (migrated.length) sourcesChanged();
	return { migrated, failed };
}

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
	// مصدر حزمة مثبّتة كإضافة (رُحّلت أو ثُبّتت من مستودع) يظهر بمعرّفه القديم: التثبيت نفسه هو الإذن
	if (!installedPackages.has(packageOf(sourceId))) assertVisible({ id: sourceId });
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
let recoveredSaid = false;
export async function sources() {
	const { sources: list, stateRecovered } = await required().sources();
	noteInstalled(list);
	// ES1: ملف الإضافات كان تالفًا فنُقل جانبًا والتطبيق أقلع بحالة فارغة: يُقال مرة في الجلسة
	if (stateRecovered && !recoveredSaid) {
		recoveredSaid = true;
		try { globalThis.dispatchEvent?.(new CustomEvent('vantara:extensions-recovered')); } catch { /* بيئة بلا أحداث */ }
	}
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

// WB1: `fresh` = فتح صريح من المستخدم: الويب وويندوز يتجاوزان كاش قائمة الفصول (30 دقيقة) فيظهر الفصل الجديد. المحرك
// الأصلي (الـAPK) يتجاهل الحقل كما يتجاهل أي حقل لا يعرفه.
export async function series(sourceId, manga, { fresh = false } = {}) {
	const out = await forSource(sourceId).series({ sourceId, manga, ...(fresh ? { fresh: true } : {}) });
	sense(sourceId, out.manga ?? manga, out.chapters ?? []);
	return { manga: out.manga, chapters: out.chapters ?? [] };
}

/** فصول عمل. نفس قاعدة `memo`: مرّر كائن العمل كما جاءك من البحث أو الرائج. */
export async function chapters(sourceId, manga, { fresh = false } = {}) {
	const { chapters: list } = await forSource(sourceId).chapters({ sourceId, manga, ...(fresh ? { fresh: true } : {}) });
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
export async function cover(sourceId, url, { budgetMs = null } = {}) {
	// `budgetMs`: مهلة أطول لمحاولة صبورة بعد فشل (covers.js)؛ المحرك يحصرها بين ست ثوانٍ وعشرين
	const result = await required().cover({ sourceId: sourceId ?? null, url, ...(Number.isFinite(budgetMs) ? { budgetMs } : {}) });
	const convert = globalThis.Capacitor?.convertFileSrc;
	return convert ? convert(result.path) : result.path;
}

export async function clearImageCache() {
	return required().clearImageCache();
}

/** Account selection and verified APK storage are independent of runtime readiness. */
function legacyInstallation(source, selected) {
	const artifactPresent = source?.artifactPresent;
	const known = typeof artifactPresent === 'boolean';
	const installedVersion = source?.installedVersion;
	return {
		selected,
		installed: selected && artifactPresent === true ? installedVersion ?? true : null,
		pendingRestore: selected && artifactPresent !== true,
		...(known ? { artifactPresent } : {}),
		...(installedVersion != null ? { installedVersion } : {}),
		installationEvidence: known ? 'confirmed' : 'unknown',
	};
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
		add: async (url) => {
			const out = await plugin.addRepo({ url });
			if (out?.repo?.url) localChange({ type: 'repo', on: true, url: out.repo.url, name: out.repo.name, fingerprint: out.repo.fingerprint ?? null });
			return out;
		},
		remove: async (url) => {
			const out = await plugin.removeRepo({ url });
			localChange({ type: 'repo', on: false, url });
			return out;
		},
		extensions: async (url) => {
			const extensions = (await plugin.repoIndex({ url })).extensions ?? [];
			const list = extensions.some(ext => ext?.builtin) ? (await plugin.sources()).sources ?? [] : [];
			return extensions.map((ext) => {
				if (!ext?.builtin) return ext;
				formerlyBundled.add(ext.pkg);
				const source = list.find(s => isBundled(s) && !s.filler && packageOf(s.id) === ext.pkg);
				return { ...ext, builtin: false, formerlyBundled: true, ...legacyInstallation(source, visible({ id: ext.pkg })), update: false };
			});
		},
		install: changing(async (repo, pkg) => {
			if (formerlyBundled.has(pkg)) return installFormer(plugin, pkg);
			const out = await plugin.installExtension({ repo, pkg });
			localChange({ type: 'ext', on: true, pkg, repo });
			return out;
		}),
		uninstall: changing(async (pkg) => {
			if (formerlyBundled.has(pkg)) return removeFormer(plugin, pkg);
			const out = await plugin.uninstallExtension({ pkg });
			localChange({ type: 'ext', on: false, pkg });
			return out;
		}),
		// التحديث الذاتي الآمن (قرار المالك 20 نوفمبر): حالة التحديث، والرجوع لآخر إصدار سليم محفوظ على الجهاز
		updateState: typeof plugin.updateState === 'function' ? (pkg) => plugin.updateState({ pkg }) : null,
		rollback: typeof plugin.rollbackExtension === 'function' ? changing((pkg) => plugin.rollbackExtension({ pkg })) : null,
	};
}

/**
 * «مصادر جاهزة»: مصادر المانجا التي كانت تُشحن داخل التطبيق، بصيغة مستودع يقرؤه مدير الإضافات
 * (addons-v7.js) على كل المنصات. الإضافة والإزالة اختيار متزامن في حسابك
 * (lib/source-entitlement.js)، والمعرّف هو نفسه دائمًا، فلا تتكرر المصادر ولا تنقطع المكتبة.
 */
/**
 * حزمة كانت مدمجة، بعد فصلها، تُنزَّل موثّقة وتُحمَّل أولًا ثم تُضاف لحسابك بمعرّفها القديم.
 * فشل الاستعادة لا يغيّر اختيار الحساب السابق ولا يخفي مصادره أثناء انقطاع الشبكة.
 */
async function installFormer(plugin, pkg) {
	const context = choiceContext();
	const id = ((await plugin.sources()).sources ?? []).map((s) => s.id).find((sid) => packageOf(sid) === pkg && !String(sid).includes('#'));
	assertChoiceContext(context);
	if (!id) throw Object.assign(new Error('لم يعلن المحرك مصدرًا لهذه الإضافة؛ لم تُثبّت.'), { code: 'SOURCE_NOT_DECLARED' });
	const prepared = await plugin.prepare({ sourceId: id });
	assertChoiceContext(context);
	if (prepared?.ok !== true) throw Object.assign(new Error('لم يؤكد المحرك تجهيز الإضافة؛ لم يتغير اختيار حسابك.'), { code: 'SOURCE_PREPARE_UNCONFIRMED' });
	await choosePackage(pkg, true, context);
}

/** حذف حقيقي: من حسابك ومن الجهاز (نسختها المحفوظة)، فإعادة التثبيت تنزّلها من Keiyoushi. المكتبة والتقدم باقيان. */
async function removeFormer(plugin, pkg) {
	await choosePackage(pkg, false);
	if (typeof plugin.removeBuiltin === 'function') await plugin.removeBuiltin({ pkg });
}

/**
 * منفّذ مزامنة قائمة الإضافات (lib/extension-sync.js): نداءات المحرك نفسها، تبلّغ صفحات الأعمال بتغيّر المصادر، ولا
 * تمر بـonLocalExtensionChange (ما تطبّقه المزامنة لا يُكتب للحساب من جديد). `null` حيث لا مستودعات (الويب).
 */
export function syncTarget() {
	const plugin = bridge();
	if (typeof plugin?.addRepo !== 'function' || typeof plugin?.installExtension !== 'function' || typeof plugin?.repos !== 'function') return null;
	return {
		list: () => plugin.repos(),
		addRepo: ({ url, fingerprint = null }) => plugin.addRepo({ url, ...(fingerprint ? { fingerprint } : {}) }),
		removeRepo: ({ url }) => plugin.removeRepo({ url }),
		install: changing(({ pkg, repo }) => plugin.installExtension({ repo, pkg })),
		uninstall: changing(({ pkg }) => plugin.uninstallExtension({ pkg })),
	};
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
			byPackage.set(pkg, {
				pkg, name: source.label ?? pkg, version: String(source.version ?? ''), lang: source.lang ?? 'ar',
				arabic: String(source.lang ?? 'ar').toLowerCase() === 'ar', nsfw: false, anime: false,
				...legacyInstallation(source, visible(source)), update: false, formerlyBundled: true,
				sources: source.names ?? [source.label ?? pkg], ...(source.iconUrl ? { iconUrl: source.iconUrl } : {}),
			});
		}
		return [...byPackage.values()];
	};
	return {
		list: async () => {
			const catalog = await items();
			const installed = catalog.filter((x) => x.installed).map((x) => ({ ...x, repo: READY_REPOSITORY }));
			const pending = catalog.filter((x) => x.pendingRestore).map((x) => ({ ...x, repo: READY_REPOSITORY }));
			const state = typeof bridge()?.repos === 'function' ? await required().repos() : {};
			return {
				repos: !state.readyCatalogDismissed && catalog.some(x => x.selected || x.installed || x.pendingRestore) ? [{ url: READY_REPOSITORY, name: 'مصادر جاهزة' }] : [],
				installed, pending,
			};
		},
		// This is a legacy catalogue, never an importer for external repository URLs.
		remove: async (url) => {
			if (url !== READY_REPOSITORY) throw new Error('معرّف القائمة غير صالح');
			const plugin = required();
			if (typeof plugin.removeReadySources !== 'function') throw new Error('حدّث التطبيق لإزالة هذه القائمة');
			await plugin.removeReadySources();
		},
		extensions: () => items(),
		// مثل مستودعها الأصلي: التثبيت يُنزّل ويحمّل فعلًا، والحذف يمحو نسختها من الجهاز
		install: changing((_repo, pkg) => installFormer(required(), pkg)),
		uninstall: changing((pkg) => removeFormer(required(), pkg)),
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
		add: changing((url) => plugin.addSite({ url })),
		remove: changing((id) => plugin.removeSite({ id })),
	};
}

export default {
	onSourcesChanged,
	onLocalExtensionChange,
	syncTarget,
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
