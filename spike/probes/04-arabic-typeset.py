#!/usr/bin/env python3
"""
اختبار typesetting العربي داخل بالون — يجيب على D-04 بالبكسل لا بالافتراض.

يرسم نفس النص بمحركين:
  BASIC : بلا HarfBuzz/FriBidi  → الحروف منفصلة والاتجاه مقلوب
  RAQM  : HarfBuzz + FriBidi + libraqm → عربي سليم

ويطبّق ملء البالون: wrap + autosize حتى يدخل النص في الصندوق.

    pip install Pillow          # الويل يشحن raqm جاهزًا
    python3 04-arabic-typeset.py
"""
from PIL import Image, ImageDraw, ImageFont, features

FONT = "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf"

# نصوص من صفحة حقيقية (Nano Machine ch.1، Azora)
SAMPLES = [
    "تحذير! تحذير!",
    "كشف جسم طائر على بعد 2 كم.",
    "جسم طائر...؟",
    "من أنت؟ ولماذا تتبعني منذ البارحة؟",
]


def fit_text(draw, text, box, font_path, engine, max_size=64, min_size=10):
    """أصغر تقليل ممكن للحجم مع التفاف يجعل النص يدخل الصندوق.

    ترجع (font, lines, total_h) أو None إذا لم يدخل حتى عند min_size.
    """
    bw, bh = box
    for size in range(max_size, min_size - 1, -1):
        font = ImageFont.truetype(font_path, size, layout_engine=engine)
        words, lines, cur = text.split(), [], ""
        for w in words:
            trial = f"{cur} {w}".strip()
            if draw.textlength(trial, font=font) <= bw:
                cur = trial
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        # ارتفاع السطر = ascent+descent مع تباعد 1.25
        a, d = font.getmetrics()
        lh = int((a + d) * 1.25)
        if lines and max(draw.textlength(l, font=font) for l in lines) <= bw \
                and lh * len(lines) <= bh:
            return font, lines, lh * len(lines), lh
    return None


def draw_bubble(img, draw, box_xy, text, engine, label):
    x, y, w, h = box_xy
    # البالون
    draw.rounded_rectangle([x, y, x + w, y + h], radius=18,
                           fill="white", outline="black", width=3)
    fitted = fit_text(draw, text, (w - 24, h - 24), FONT, engine)
    if not fitted:
        draw.text((x + 12, y + 12), "!!! لا يدخل", fill="red",
                  font=ImageFont.truetype(FONT, 14, layout_engine=engine))
        return False
    font, lines, total_h, lh = fitted
    cy = y + (h - total_h) // 2
    # direction/language يرفعان KeyError بلا libraqm — وهذا نصف الإجابة على D-04
    rtl = {"direction": "rtl", "language": "ar"} \
        if engine == ImageFont.Layout.RAQM else {}
    for line in lines:
        # العربية تُركّز أفقيًا؛ anchor="ma" = وسط أعلى السطر
        draw.text((x + w // 2, cy), line, fill="black", font=font,
                  anchor="ma", **rtl)
        cy += lh
    draw.text((x, y - 18), label, fill="#0a7",
              font=ImageFont.truetype(FONT, 13, layout_engine=engine))
    return True


def main():
    print("raqm available:", features.check("raqm"),
          "| version:", features.version("raqm"))
    print("freetype:", features.version("freetype2"))

    engines = [
        ("BASIC  (بلا HarfBuzz/FriBidi)", ImageFont.Layout.BASIC),
        ("RAQM   (HarfBuzz+FriBidi+libraqm)", ImageFont.Layout.RAQM),
    ]

    W, H = 1100, 260 + 200 * len(SAMPLES)
    img = Image.new("RGB", (W, H), "#e8e8e8")
    draw = ImageDraw.Draw(img)

    title = ImageFont.truetype(FONT, 26, layout_engine=ImageFont.Layout.RAQM)
    draw.text((W // 2, 24), "اختبار typesetting العربي داخل بالون",
              fill="black", font=title, anchor="ma",
              direction="rtl", language="ar")

    col_w, box_w, box_h = W // 2, 420, 130
    for ci, (name, engine) in enumerate(engines):
        cx = ci * col_w + (col_w - box_w) // 2
        draw.text((ci * col_w + col_w // 2, 74), name, fill="#333",
                  font=ImageFont.truetype(FONT, 17,
                                          layout_engine=ImageFont.Layout.RAQM),
                  anchor="ma")
        for si, text in enumerate(SAMPLES):
            y = 130 + si * 200
            ok = draw_bubble(img, draw, (cx, y, box_w, box_h), text, engine,
                             f"#{si + 1}")
            if ci == 1:
                print(f"  sample {si + 1}: fitted={ok}  \"{text[:38]}\"")

    out = "arabic-typeset-test.png"
    img.save(out)
    print("saved:", out, img.size)

    # قياس: هل الشكل يختلف فعلًا بين المحركين؟
    print("\n--- عرض النص بالبكسل لكل محرك (الاختلاف = الـshaping يعمل) ---")
    for text in SAMPLES:
        ws = []
        for _, engine in engines:
            f = ImageFont.truetype(FONT, 32, layout_engine=engine)
            ws.append(round(draw.textlength(text, font=f), 1))
        delta = ws[0] - ws[1]
        print(f'  BASIC={ws[0]:>7}  RAQM={ws[1]:>7}  Δ={delta:>7}  "{text[:30]}"')


if __name__ == "__main__":
    main()
