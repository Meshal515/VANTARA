"""comic-text-detector للجوال: رأس `seg` (قناع الحروف) وحده.

الجوال يقرأ من النموذج خرج `seg` فقط، لكن ONNX Runtime يحسب الرسم كله مهما
طُلب منه (طلب `seg` وحده لا يوفّر شيئًا)، فرأسا `blk` و`det` كانا يأكلان
نحو 40% من زمن كل مربع 1024 بلا فائدة. هنا يُحذفان من الرسم مع كل عقدة ومُهيّئ
لا يغذّي `seg`. ما يبقى هو العقد نفسها بالأوزان نفسها وبالترتيب نفسه: خرج
`seg` مطابق للأصل.

    python tools/ctd_seg_only.py comictextdetector.onnx comictextdetector-seg.onnx
"""

from __future__ import annotations

import sys

import onnx


def keep_outputs(model: onnx.ModelProto, names: set[str]) -> int:
    """يُبقي مخرجات الرسم المطلوبة وحدها، ويحذف كل عقدة ومُهيّئ لا يغذّيها."""
    g = model.graph
    needed = set(names)
    kept: list[onnx.NodeProto] = []
    for n in reversed(list(g.node)):
        if any(o in needed for o in n.output):
            kept.append(n)
            needed.update(i for i in n.input if i)
    kept.reverse()
    removed = len(g.node) - len(kept)
    outs = [o for o in g.output if o.name in names]
    del g.node[:]
    g.node.extend(kept)
    del g.output[:]
    g.output.extend(outs)
    inits = [i for i in g.initializer if i.name in needed]
    del g.initializer[:]
    g.initializer.extend(inits)
    vis = [v for v in g.value_info if v.name in needed]
    del g.value_info[:]
    g.value_info.extend(vis)
    return removed


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    model = onnx.load(src)
    print(f"seg only: removed {keep_outputs(model, {'seg'})} nodes of the blk/det heads")
    onnx.checker.check_model(model)
    onnx.save(model, dst)
    print(dst)


if __name__ == "__main__":
    main()
