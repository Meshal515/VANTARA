# إشعارات الترخيص — VANTARA

حقوق النشر © 2026 مالك مشروع VANTARA والمساهمون فيه.

كود VANTARA مرخّص بموجب **رخصة GNU Affero العامة، الإصدار 3** (AGPL-3.0-only)، ونصها الكامل في [LICENSE](LICENSE).
يحق لك استعمال الكود ودراسته وتعديله وإعادة توزيعه بشروطها. ومن أهمها: من يوزّع نسخة معدّلة، أو يشغّلها خدمة
يستعملها الناس عبر الشبكة، يلزمه إتاحة مصدرها الكامل بالرخصة نفسها.

الرخصة تشمل الكود وحده. **اسم VANTARA وشعاره وهويته البصرية ليست مرخّصة بها**، وتحكمها [سياسة العلامة](TRADEMARKS.md).

> VANTARA is licensed under the GNU Affero General Public License v3.0 only (see `LICENSE`). The VANTARA name, logo and
> visual identity are not licensed under it; see `TRADEMARKS.md`. Third-party components below keep their own licenses.

## إذن إضافي (البند 7 من AGPL-3.0)

يمنح مالك مشروع VANTARA، بصفته صاحب حقوق كوده، إذنًا إضافيًا بدمج كود VANTARA وتوزيعه مع مكتبة الحركة **GSAP**
(`apps/web/vendor/gsap.esm.js`) بشروط رخصتها، دون أن تخضع GSAP نفسها لـ AGPL. هذا الإذن يخص كود VANTARA وحده، ويجوز
لمن يعدّل الكود حذفه من نسخته. GSAP مؤقتة وتُستبدل لاحقًا بحركات مكتوبة في VANTARA.

## مكوّنات من أطراف أخرى (تحتفظ برخصها)

| المكوّن | الموضع | الرخصة |
| --- | --- | --- |
| واجهة المصادر لـ Mihon/Tachiyomi وAniyomi (مكيّفة للتوافق مع الإضافات) | `android/app/src/main/kotlin/eu/kanade/` | Apache-2.0 |
| jlibtorrent / libtorrent | `android/app/src/main/assets/notices/` | MIT / BSD |
| OpenSSL | `android/app/src/main/assets/notices/` | Apache-2.0 |
| hls.js | `apps/web/vendor/hls*.js` | Apache-2.0 |
| gifenc | `apps/web/vendor/gifenc.js` | MIT |
| GSAP | `apps/web/vendor/gsap.esm.js` | GSAP Standard "No Charge" License (انظر الإذن الإضافي أعلاه) |
| الخطوط العربية (Cairo وTajawal وAmiri وNoto وغيرها) | `android/app/src/main/assets/fonts/` | SIL Open Font License 1.1 (ملف OFL بجانب كل خط) |
| AndroidX وMedia3 وOkHttp وOkio وKotlin وkotlinx وjsoup وJackson وRxJava وInjekt وQuickJS وONNX Runtime | تبعيات Gradle | Apache-2.0 / MIT |
| تبعيات npm للويب والأدوات | `package.json` | MIT / ISC / BSD / Apache-2.0 وما يماثلها |

أدوات التطوير في `.claude/` (مهارات ووكلاء) ليست جزءًا من التطبيق الموزَّع، وتحتفظ كل منها برخصتها في مجلدها.

## مصدر الكود

مصدر VANTARA الكامل متاح للعموم على GitHub. أي نسخة موزَّعة أو مشغّلة خدمةً يجب أن تتيح لمستخدميها رابطًا لمصدر
نسختها نفسها (البند 13 من AGPL-3.0).
