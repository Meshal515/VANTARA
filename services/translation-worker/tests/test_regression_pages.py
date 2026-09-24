"""الصفحات الحقيقية التي فشل عليها النظام القديم — اختبارات انحدار إلزامية.

إحدى عشرة صفحة من قارئ VANTARA (لقطات جهاز مشعل، 1080×2316): فقاعات كلام وتفكير،
فقاعتان ملتصقتان، صناديق سرد، نص أبيض فوق مطر ودخان وشعاع، مؤثر كوري ضخم،
ومؤثرات CLANG/STEP. ما يُثبَت هنا ليس «رُسم شيء» بل القواعد الصلبة:

  * كل فقاعة حوار حقيقية تُكتشف وتُترجم (بمترجم ثابت) وتُبيَّض بالكامل.
  * حدود الفقاعة والرسم حولها لا تتغير بكسلًا.
  * المؤثرات الصوتية لا تُمس.
  * لا بكسل يتغير خارج قناع المسح وحدود العربي.
  * العربي داخل الفقاعة لا يخرج من مضلّعها.

تحتاج الأوزان (`python -m vantara_worker.cli models`). بدونها تُتخطى محليًّا،
وفي CI يُلزم وجودها بـ`VANTARA_REQUIRE_MODELS=1`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import cv2
import numpy as np
import pytest

from vantara_worker import models

PAGES = Path(__file__).parent / "pages"
HAVE_MODELS = all(models.is_present(n) for n in models.CORE)
if not HAVE_MODELS and os.environ.get("VANTARA_REQUIRE_MODELS") == "1":
    raise RuntimeError("VANTARA_REQUIRE_MODELS=1 but model weights are missing")

pytestmark = pytest.mark.skipif(not HAVE_MODELS, reason="model weights not downloaded")

# الترجمة الثابتة: النص الأصلي كما يقرؤه OCR (بعد تطبيع) → العربي. null = مؤثر لا يُترجم
TABLE: dict[str, str | None] = {
    "ONLY OUR MAGICIAN KNOWS THE TRUTH.": "ساحرنا وحده يعرف الحقيقة.",
    "IF YOU ENJOYED THE SHOW..": "إن أعجبكم العرض…",
    "IF YOU ENJOYED THE SHOW...": "إن أعجبكم العرض…",
    "EVEN THE SMALLEST COIN WILL BE A BIG HELP, HAHA!": "فحتى أصغر قطعة نقدية ستساعدنا كثيرًا، هاها!",
    "CLANG": None,
    "THIS IS THE VILLAGE WHERE YURIA LIVES.": "هذه هي القرية التي تعيش فيها يوريا.",
    "GOSH, I COULDN'T RUN ANOTHER FOOT EVEN IF YOU THREATENED TO KILL ME.": "يا إلهي، لن أستطيع الركض خطوة أخرى حتى لو هددتني بالقتل.",
    "I SWEAR, WHY IS YOUR STAMINA SO BAD?": "أقسم، لماذا لياقتك بهذا السوء؟",
    "YOU REALLY NEED TO WORK ON THAT.": "عليك حقًا أن تحسّنها.",
    "STEP": None,
    "THE WAR THAT BEGAN TOGETHER WITH THE WORLD HAD CONTINUED ON,": "الحرب التي بدأت مع بداية العالم ظلّت مستمرة،",
    "THE MAJORITY OF BLOOD SPILLED ON THE BATTLEFIELD WAS THAT OF HUMANS.": "ومعظم الدماء التي سُفكت في ساحة المعركة كانت دماء البشر.",
    "THE WARRIORS": "المحاربون",
    "AND HEROES": "والأبطال",
    "OF COUNTLESS": "في معارك",
    "BATTLES,": "لا تُحصى،",
    "WITHOUT REACHING THE DARK LORD EVEN ONCE,": "دون أن يبلغوا سيد الظلام ولو مرة واحدة،",
    "HAD JUST... FADED AWAY, AS IT WERE.": "قد تلاشوا… ببساطة، كأن لم يكونوا.",
    # The Breaker — صفحتان كثيفتان (17 و13 منطقة)
    "BRAAAAP~": "بررراااع~",
    "OY- YOU SURE YOU DON'T WANT ONE?": "أوي~ أمتأكد أنك لا تريد واحدة؟",
    "NO, I DON'T WANT ONE!!": "لا، لا أريد!!",
    "THIS BEER'S PEALY": "هذه الجعة لذيذة حقًا…",
    "AND WHO BRINGS BEER WHILE VISITING A MINOF IN THE HOSPITALI": "ومن يجلب الجعة وهو يزور قاصرًا في المستشفى!",
    "WHAT HAPPENED THAT DAY...": "ما حدث ذلك اليوم…",
    "GOOMOON- RYONG PROBABLY DID IT FOR YOUR SAKE.": "غومون ريونغ فعله على الأرجح من أجلك.",
    "NOW, IF HE GOES OFF AND LEAVES YOU BEHIND,": "والآن، إن رحل وتركك خلفه،",
    "HUH?": "ماذا؟",
    "DO YOU THINK THE MURIM WOULD LET YOU OFF? NO, THEY WOULD COME AFTER YOU, THE DISCIPLE, IN ORDER TO AVENGE THEIR DEFEAT.": "أتظن أن الموريم سيتركونك وشأنك؟ لا، سيلاحقونك أنت، التلميذ، لينتقموا لهزيمتهم.",
    "THINK FOR A SEC.": "فكّر لحظة.",
    "AH... COME TO THINK OF IT...": "آه… حين أفكر في الأمر…",
    "GOOMOON- RYONG AND YOU, HIS DISCIPLE, INVADED THE MARTIAL ARTS ALLIANCE THAT DAY.": "غومون ريونغ وأنت، تلميذه، اقتحمتما تحالف الفنون القتالية ذلك اليوم.",
    "EVEN YESTERDAY...": "حتى البارحة…",
    "ULTIMATELY, GOOMOONRYONG PUSHED YOU OUT OF THE MURIM, IN ORDER TO SAVE YOU.": "في النهاية، أخرجك غومون ريونغ من الموريم لينقذك.",
    "'CUZ THE MURIM'S RULES APPLY ONLY TO THOSE WHO BELONG IN THE MURIM.": "لأن قواعد الموريم لا تسري إلا على من ينتمي إليه.",
    "THAT'S RIGHT. AND SO HE HAS BECOME THE PERFECT DESTROYER OF THIS MURIM.": "صحيح. وهكذا صار المدمّر الأمثل لهذا الموريم.",
    "IN THE END, GOOMOONRYONG'S REVENGE SUCCEEDED SPECTACULARLY.": "في النهاية، نجح انتقام غومون ريونغ نجاحًا باهرًا.",
    "HE HAS DESTROYED THE HEART OF THE MURIM. NAMELY ITS PRIDE AND DIGNITY, AS GUARDED BY THE ALLIANCE. IT WILL NOT BE EASY TO RECOVER FROM THOSE LOSSES.": "لقد حطّم قلب الموريم: كبرياءه وكرامته اللذين كان التحالف يحرسهما. ولن يكون تعويض تلك الخسائر سهلًا.",
    "THE ALLIANCE CHIEF'S POSITION MIGHT HAVE GONE TO KANGSUNG, BUT GOOMOONRYONG'S ASCENT AS THE STRONGEST AMONG THE MURIM MASTERS MEANS THAT NO ONE ELSE'S AUTHORITY WILL EASILY BE ACCEPTED.": "قد يكون منصب زعيم التحالف آل إلى كانغسونغ، لكن صعود غومون ريونغ كأقوى أسياد الموريم يعني أن سلطة أي أحد غيره لن تُقبل بسهولة.",
    "AFTER BEING SHATTERED TO PIECES, THE MURIM WILL FACE A TIME FRAUGHT WITH GREATER DANGER AND MORE TURBULENCE THAN EVER BEFORE.": "بعد أن تحطّم إلى أشلاء، سيواجه الموريم زمنًا أشد خطرًا واضطرابًا من أي وقت مضى.",
    "THEN, WAS THE DECISION TO ACCEPT THAT BOY IN PREPARATION FOR THE HARD TIMES AHEAD?": "إذن، هل كان قبول ذلك الفتى استعدادًا للأيام العصيبة القادمة؟",
    "BUT, ELDER KWON. THERE IS A RUMOR GOING AROUND THAT THE BOY IS UNABLE TO LEARN ANY MARTIAL ARTS, DUE TO HIS KI-CENTER'S DESTRUCTION.": "لكن يا شيخ كوون، ثمة شائعة تقول إن الفتى عاجز عن تعلّم أي فن قتالي بسبب تدمير مركز الكي لديه.",
    "ELDER MIN! THAT BOY HAS THE MANDATE TO BECOME THE SUNWOO CLAN'S SUCCESSOR.": "يا شيخ مين! ذلك الفتى يحمل تفويض خلافة عشيرة سونوو.",
    "DID YOU KNOW ABOUT THAT?": "هل كنت تعلم بذلك؟",
    "ISN'T THAT THE ONLY IMPORTANT THINGS FOR US, AS ELDERS OF THE SUNWOO CLAN?": "أليس هذا وحده ما يهمّنا نحن شيوخ عشيرة سونوو؟",
    "BUT WOULDN'T THAT MAKE HIM MORE VALUABLE TO US?": "لكن ألا يجعله ذلك أثمن لنا؟",
    "WHAT WE, THE SUNWOO CLAN, NEED RIGHT NOW IS NOT A HOPPING MAD DRAGON, BUT AN OBEDIENT PARROT THAT WILL SIT QUIETLY IN ITS CAGE.": "ما تحتاجه عشيرة سونوو الآن ليس تنينًا هائجًا، بل ببغاء مطيعًا يجلس بهدوء في قفصه.",
}

# لكل صفحة: الفقاعات/النصوص التي يجب أن تُترجم (صندوق تقريبي x1,y1,x2,y2 بالبكسل) والمؤثرات التي يجب ألا تُمس
EXPECTED: dict[str, dict] = {
    "p1_magician": {"translate": [(172, 613, 513, 763)], "untouched": []},
    "p2_skeleton": {"translate": [(111, 646, 390, 797), (342, 948, 664, 1149)], "untouched": [(13, 1911, 295, 2038)]},
    "p3_village": {"translate": [(203, 845, 532, 999), (525, 1105, 936, 1355)], "untouched": []},
    "p4_stamina": {"translate": [(304, 687, 655, 842), (473, 948, 792, 1098)], "untouched": [(132, 1124, 383, 1244), (760, 1990, 1060, 2120)]},
    "p5_rain": {"translate": [(172, 1040, 908, 1190)], "untouched": []},
    "p6_smoke": {"translate": [(211, 1362, 873, 1592)], "untouched": []},
    "p7_captions": {"translate": [(69, 287, 247, 387), (325, 718, 478, 826), (562, 1211, 786, 1258), (824, 1631, 1017, 1713)], "untouched": []},
    "p8_darklord": {"translate": [(170, 956, 912, 1175)], "untouched": []},
    "p9_sfx": {"translate": [(178, 1918, 902, 2153)], "untouched": [(60, 330, 760, 1560)]},
    "p10_breaker1": {
        "translate": [(844, 221, 1004, 268), (840, 449, 997, 561), (438, 434, 550, 535), (907, 729, 1032, 806), (73, 738, 249, 865), (236, 955, 409, 1058), (955, 973, 1032, 1010), (39, 1057, 289, 1250), (932, 1189, 1045, 1242), (432, 1300, 541, 1395), (738, 1320, 893, 1494), (74, 1598, 199, 1648), (854, 1785, 1033, 1917), (307, 2009, 489, 2155)],
        "untouched": [(590, 640, 740, 700)],  # CHIIK
    },
    "p11_breaker2": {
        "translate": [(329, 353, 515, 514), (836, 369, 1042, 465), (294, 652, 506, 901), (30, 845, 257, 1017), (813, 1158, 1001, 1292), (187, 1373, 336, 1579), (703, 1391, 843, 1566), (189, 1648, 325, 1721), (373, 1716, 543, 1869), (839, 2015, 1007, 2109), (43, 2049, 361, 2250)],
        "untouched": [(770, 820, 900, 1050)],  # المؤثر الكوري وCLIP
    },
}
# لقطات الشاشة تحمل زرّ «ترجم» وتنبيهًا في الأسفل: خارج نطاق التقييم
UI_CHROME_TOP = 2100


@pytest.fixture(scope="module")
def pipeline():
    from vantara_worker.pipeline import Pipeline

    return Pipeline()


@pytest.fixture(scope="module")
def results(pipeline):
    from vantara_worker.translate_client import FakeTranslator, PageMeta

    translator = FakeTranslator(TABLE)
    out = {}
    for name in EXPECTED:
        data = (PAGES / f"{name}.jpg").read_bytes()
        rgb, _ = pipeline.decode(data)
        res = pipeline.run(data, PageMeta(page_hash="", series_ref="test"), translator)
        out[name] = (rgb, res)
    return out


def _iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua else 0.0


@pytest.mark.parametrize("name", list(EXPECTED))
def test_every_dialogue_is_detected_and_translated(results, name):
    _rgb, res = results[name]
    translated = [r for r in res.regions if r.status == "translated"]
    for box in EXPECTED[name]["translate"]:
        match = max(translated, key=lambda r: _iou(r.box, box), default=None)
        assert match is not None and _iou(match.box, box) > 0.5, f"{name}: dialogue at {box} not translated; regions={[(r.box, r.status, r.source) for r in res.regions]}"
        assert match.arabic and match.layout, f"{name}: region {match.id} has no Arabic layout"


@pytest.mark.parametrize("name", list(EXPECTED))
def test_source_glyphs_are_gone_from_flat_bubbles(results, name):
    """في الفقاعة المسطّحة لا يبقى حبر داكن حيث كانت الحروف (خارج العربي المرسوم)."""
    _rgb, res = results[name]
    for r in res.regions:
        if r.status != "translated" or r.clean_mode != "fill" or r.layout is None:
            continue
        x1, y1, x2, y2 = r.box
        out = res.image[y1:y2, x1:x2]
        lx1, ly1, lx2, ly2 = r.layout["bounds"]
        # داخل الفقاعة وحده (حدّها وتظليل الرسم حولها ليسا حروفًا)، خارج العربي المرسوم
        bubble_mask = r.bubble.mask if r.bubble is not None else None
        if bubble_mask is None:
            continue
        probe = cv2.erode(bubble_mask, np.ones((11, 11), np.uint8))[y1:y2, x1:x2] > 0
        # نستثني حدود العربي (مع هامش) ونفحص بقية صندوق النص الأصلي
        pad = r.layout["size"] // 2
        probe[max(0, ly1 - pad - y1) : ly2 + pad - y1, max(0, lx1 - pad - x1) : lx2 + pad - x1] = False
        if probe.sum() < 200:
            continue
        fill = np.array(r.notes[0].split("fill ")[-1].strip("()").split(", "), dtype=np.int16) if "fill" in (r.notes[0] if r.notes else "") else None
        if fill is None:
            continue
        deviant = (np.abs(out.astype(np.int16) - fill).max(axis=2) > 40)[probe].mean()
        assert deviant < 0.02, f"{name}: {r.id} still has source ink ({deviant:.1%}) after fill"


@pytest.mark.parametrize("name", list(EXPECTED))
def test_bubble_outline_and_art_are_untouched(results, name):
    """حلقة رفيعة على حدّ كل فقاعة (وخارجه) لا يتغير فيها بكسل."""
    rgb, res = results[name]
    for r in res.regions:
        if r.status != "translated" or r.bubble is None:
            continue
        ring = cv2.dilate(r.bubble.mask, np.ones((7, 7), np.uint8)) & ~cv2.erode(r.bubble.mask, np.ones((3, 3), np.uint8))
        sel = ring > 0
        diff = np.abs(res.image[sel].astype(np.int16) - rgb[sel].astype(np.int16)).max(axis=1)
        assert (diff > 0).mean() < 0.001, f"{name}: {r.id} bubble outline changed ({(diff > 0).mean():.2%})"


@pytest.mark.parametrize("name", list(EXPECTED))
def test_sound_effects_and_art_are_untouched(results, name):
    rgb, res = results[name]
    for box in EXPECTED[name]["untouched"]:
        x1, y1, x2, y2 = box
        assert np.array_equal(res.image[y1:y2, x1:x2], rgb[y1:y2, x1:x2]), f"{name}: pixels changed inside untouched zone {box}"


@pytest.mark.parametrize("name", list(EXPECTED))
def test_nothing_changes_outside_erase_masks_and_arabic(results, name):
    rgb, res = results[name]
    H, W = rgb.shape[:2]
    allowed = np.zeros((H, W), bool)
    for r in res.regions:
        if r.status != "translated":
            continue
        if r.erase_mask is not None:
            allowed |= r.erase_mask > 0
        if r.layout:
            lx1, ly1, lx2, ly2 = r.layout["bounds"]
            pad = r.layout["size"] // 2
            allowed[max(0, ly1 - pad) : min(H, ly2 + pad), max(0, lx1 - pad) : min(W, lx2 + pad)] = True
    changed = np.any(res.image != rgb, axis=2)
    assert not (changed & ~allowed).any(), f"{name}: {int((changed & ~allowed).sum())} pixels changed outside the allowed masks"
    assert "leaked_pixels" not in res.timings, f"{name}: pipeline had to repair {res.timings.get('leaked_pixels')} leaked pixels"


@pytest.mark.parametrize("name", list(EXPECTED))
def test_arabic_stays_inside_its_bubble(results, name):
    _rgb, res = results[name]
    for r in res.regions:
        if r.status != "translated" or r.bubble is None or r.layout is None:
            continue
        # كل سطر بحدوده الفعلية داخل الفقاعة (مع تسامح 3 بكسل على الحافة المتموجة)
        tolerant = cv2.dilate(r.bubble.mask, np.ones((7, 7), np.uint8))
        for lx1, ly1, lx2, ly2 in r.layout["lineBounds"]:
            inside = tolerant[ly1:ly2, lx1:lx2] > 0
            assert inside.mean() > 0.995, f"{name}: {r.id} line {(lx1, ly1, lx2, ly2)} leaves the bubble ({inside.mean():.1%} inside)"


def test_nothing_is_touched_without_a_translation(pipeline):
    """بلا عربي لا تبييض: المترجم الصامت يعيد الصفحة بايتًا بايتًا."""
    from vantara_worker.translate_client import NullTranslator, PageMeta

    data = (PAGES / "p3_village.jpg").read_bytes()
    rgb, _ = pipeline.decode(data)
    res = pipeline.run(data, PageMeta(page_hash="", series_ref="test"), NullTranslator())
    assert res.translated == 0
    assert np.array_equal(res.image, rgb)
    assert all(r.status.startswith("skipped") for r in res.regions)


def test_region_ids_are_stable_across_runs(pipeline):
    from vantara_worker.translate_client import NullTranslator, PageMeta

    data = (PAGES / "p2_skeleton.jpg").read_bytes()
    a = pipeline.run(data, PageMeta(page_hash="", series_ref="test"), NullTranslator())
    b = pipeline.run(data, PageMeta(page_hash="", series_ref="test"), NullTranslator())
    assert [r.id for r in a.regions] == [r.id for r in b.regions]
    assert a.page_hash == b.page_hash


def test_result_json_is_serialisable(results):
    for name, (_, res) in results.items():
        blob = json.dumps(res.to_json(), ensure_ascii=False)
        assert name and '"regions"' in blob
