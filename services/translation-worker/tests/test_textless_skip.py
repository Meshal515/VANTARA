"""صفحة بلا نص تتخطى نماذج الحروف والفقاعات وOCR، والنتيجة نفسها تمامًا.

كل منطقة تبدأ من صندوق نص بثقة ≥ MIN_DET_SCORE؛ هذا الاختبار يثبت الشرط من
الجهتين: بلا صندوق كهذا لا نداء للنماذج الثقيلة، ومعه (ولو صندوق واحد ضعيف فوق
الحد، كجريدة في المشهد) يمرّ الخط كاملًا.
"""

import numpy as np
import pytest

from vantara_worker.pipeline import MIN_DET_SCORE, Pipeline
from vantara_worker.vision.detect import Detection


class Boom:
    def __call__(self, *_a, **_k):
        raise AssertionError("heavy model must not run on a page without text")


def stub(dets):
    p = object.__new__(Pipeline)
    p.detector = lambda _rgb: dets
    p.glyphs = Boom()
    p.bubbles = Boom()
    p.manga_ocr = None
    p.latin = Boom()
    return p


RGB = np.full((200, 120, 3), 255, np.uint8)


def test_no_text_box_skips_every_heavy_model():
    regions, _ = stub([]).analyze(RGB, "h")
    assert regions == []
    # فقاعة فارغة، ونص تحت الحد: لا منطقة كانت ستولد منهما أصلًا
    regions, _ = stub([Detection((10, 10, 100, 60), 0.9, "bubble"), Detection((10, 70, 100, 90), MIN_DET_SCORE - 0.01, "text_free")]).analyze(RGB, "h")
    assert regions == []


@pytest.mark.parametrize("label", ["text_bubble", "text_free"])
def test_any_text_box_at_the_threshold_runs_the_full_pipeline(label):
    with pytest.raises(AssertionError, match="heavy model"):
        stub([Detection((10, 10, 100, 60), MIN_DET_SCORE, label)]).analyze(RGB, "h")
