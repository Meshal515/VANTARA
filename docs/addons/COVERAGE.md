# مصفوفة تغطية المواصفة

كل بند مهم له requirement ومهمة. **كل مهمة تنفيذية أدناه ما زالت مخططة**، والمصفوفة ليست تقرير نجاح tests.

| بنود SPEC | المتطلبات | المهام |
|---|---|---|
| 1–3: الهدف/core/adapters | AF-01,02,04,18,45 | T1,T4,T7,T8 |
| 4: أنواع الإضافات | AF-02,38,40,41,ST-01–12 | T1,T4,T5,T6,T7 |
| 5: Manifest | AF-03,05,37 | T1,T2 |
| 6: الثقة | AF-05,06 | T1,T2,T3 |
| 7: الواجهة | AF-07–10,33 | T3 |
| 8: شعار المصدر | AF-11 | T2,T3,T4 |
| 9: sidebar القسم | AF-07,08,10,20؛ تعديل المالك: خانة واحدة ثابتة | T3,T4 |
| 10–12: Source Mode/home/search | AF-12–14,19 | T4,T5 |
| 13–14: الهوية/source copies | AF-15,16,18 | T1,T5 |
| 15–16: المانجا والفصل | AF-12,17,18,40,44 | T1,T4,T8 |
| 17–19: الأنمي والسينما | AF-16,19,21,38 | T4,T5 |
| 20–23: streams/quality/first Ready | AF-21–26,28 | T0,T5,T8 |
| 24–25: الترجمات والمطابقة | ST-01–12,AF-15,44 | T5,T6,T7 |
| 26: Scheduler | AF-26,48 | T2,T5 |
| 27–28: Health/breaker | AF-27,28,33 | T1,T2 |
| 29: تفاصيل الإضافة | AF-09,11,37,42 | T3 |
| 30–31: Cloudflare/session | AF-29,30,33 | T2,T4,T7 |
| 32–35: permissions/network/isolation/no JS | AF-04–06,26,30–32,37 | T1,T2,T7 |
| 36: Stremio | AF-38–40 | T5 |
| 37: Aniyomi | AF-01,04,45 | T4,T7 |
| 38: resolver hub | AF-41,43 | T0,T4,T5 |
| 39–40: cache/LKG | AF-34,35 | T2,T5,T8 |
| 41–42: update/domain | AF-35,36 | T2,T8 |
| 43–45: settings/priorities/pin | AF-20,25,37 | T2,T3,T4,T5 |
| 46–48: Back/library/source switching | AF-17–19,44 | T4,T5,T6,T7 |
| 49: failover | AF-44,ST-08,11 | T0,T5,T6,T7 |
| 50–51: runtime/Worker | AF-31,32,40,45,46 | T0,T2,T7 |
| 52–54: states/errors/diagnostics | AF-28,29,33,42,43 | T0,T2,T3,T8 |
| 55: الأداء | AF-23,24,26,48 | T0,T2,T5,T8 |
| 56: Registry/store/install | AF-03,05,06,35,47 | T1,T2,T3,T8 |
| 57–61: أمثلة/مراحل/اختبارات/حدود/نجاح | جميع AF/ST واختبارات المراحل | T0–T8 |
| 62: قرارات المالك | القرارات المقترحة آخر REQUIREMENTS وتعليق حدود التنفيذ في PLAN؛ لم تُفترض موافقة على الخطة الجديدة | مراجعة المالك |
| 63: وثائق ومراجعة قبل التنفيذ | REQUIREMENTS/PLAN/STATUS/COVERAGE/RESEARCH | أُعدت للمراجعة |
| 64: نتائج/اعتمادية/صيانة | AF-01,24,27,42,43,48,ST-04,10 | T0–T8 |

## تغطية تعليمات الترجمة الجديدة

| حالة القبول المطلوبة | متطلب | اختبار مقرر |
|---|---|---|
| no tracks/no addon → no fake UI | ST-01,03,05 | T6/T7 render no-soft-track |
| source Arabic → usable | ST-02,07 | T6 VTT/HLS real track، T7 Media3 |
| hard Arabic only → no controllable track | ST-01 | T6/T7 hard-only |
| addon result progressive، الفيديو لا ينتظر | ST-04,10 | T6/T7 live provider + blocked/slow provider fixture |
| provider fails → الفيديو يستمر | ST-04,11 | T6/T7 provider failure |
| switch → لا tracks قديمة | ST-08 | T6/T7 cancellation/generation/release match |
| APK/PWA same functional behavior | ST-05,09–11,AF-45 | T7 parity ثم T8 device report |
| no autoplay ولا server change للترجمة | ST-11 | T6/T7/T8 session choice preservation |
