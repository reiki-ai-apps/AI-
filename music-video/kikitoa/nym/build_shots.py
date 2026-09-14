#!/usr/bin/env python3
"""カット割りから shots.json を組み立てる。

手で 14 個のカットを書くと調整が効かなくなるので、
「どの framing を、いつからいつまで」だけを CUTS に書いて、
レイヤーと効果はここで一括して付ける。
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
FIG = json.load(open(os.path.join(HERE, "art", "figure.json")))   # prep_layers.py が書く
CUT = (187.43, 238.28)
LINE_FROM, LINE_TO = 195.0, 198.4      # 「With a line / 線を引いて」
DAWN_FROM = 212.7                       # ここから朝

# framing: プレートのどこを見るか。zoom と y で 1 枚の中を切り取って別カットにする
FRAMING = {
    "wide":  {"zoom": (1.00, 1.05), "y": (0.000, 0.000)},
    "mid":   {"zoom": (1.22, 1.30), "y": (-0.020, -0.028)},
    "tight": {"zoom": (1.52, 1.62), "y": (-0.052, -0.058)},
    "sky":   {"zoom": (1.14, 1.06), "y": (0.085, 0.060)},    # 上を向く。人物は外れる
    "low":   {"zoom": (1.30, 1.22), "y": (-0.090, -0.078)},  # 足元から見上げる
}

# (開始, framing)。終わりは次のカットの開始。歌詞の切れ目に合わせてある
CUTS = [
    (187.43, "mid"),    (189.40, "wide"),   (192.10, "low"),
    (195.00, "wide"),   (197.90, "mid"),    (201.30, "sky"),
    (205.40, "mid"),    (209.10, "tight"),  (212.70, "wide"),
    (217.10, "mid"),    (221.30, "low"),    (225.20, "wide"),
    (230.00, "mid"),    (235.20, "wide"),
]


# 人物を別レイヤーにするのは「揺らすため」であって、視差のためではない。
# この絵は空と地面しかなく手前に置くものが無いので、depth を変えると
# 切り出したコートと、背景に残した脚が離れてしまう。全部 depth 0 で揃える。
def layers(start, end, framing):
    out = [{"file": "art/bg_rooftop_dawn_clean.png", "fit": "cover", "depth": 0.0}]
    if end > LINE_FROM:
        ln = {"file": "art/line_straight.png", "fit": "cover", "depth": 0.0}
        if start < LINE_TO:                      # 引いている最中のカットだけ描き進める
            ln["reveal"] = {"from_t": LINE_FROM, "to_t": LINE_TO, "dir": "lr"}
        out.append(ln)
    if framing != "sky":                          # 空を向いているカットに人物は写らない
        out.append({"file": "art/fig_c_back.png", "x": FIG["x"], "y": FIG["y"], "w": FIG["w"],
                    "depth": 0.0, "sway": {"amp": 20.0, "freq": 0.38,
                                            "phase": round(start % 6.28, 2)}})
    return out


shots = []
for i, (start, framing) in enumerate(CUTS):
    end = CUTS[i + 1][0] if i + 1 < len(CUTS) else CUT[1]
    f = FRAMING[framing]
    dawn = start >= DAWN_FROM
    fx = ["wind:70", "dof:6" if framing != "tight" else "dof:10", "bloom",
          "vignette:%d" % (86 if dawn else 96), "grain:%.1f" % (0.8 if dawn else 0.9)]
    if 212.7 <= start < 222.0:
        fx.insert(0, "light_sweep:213.0,222.0,0.75")
    shots.append({
        "name": "%02d %s" % (i + 1, framing),
        "start": round(start, 2), "end": round(end, 2),
        "grade": "dawn" if dawn else "night",
        "subtitle_y": 470,
        "cut_punch": 0.018,
        "camera": {"from": {"zoom": f["zoom"][0], "y": f["y"][0]},
                   "to":   {"zoom": f["zoom"][1], "y": f["y"][1]}},
        "layers": layers(start, end, framing),
        "fx": fx,
    })

spec = {
    "_comment": ("屋上のプレート1枚から組む。framing でプレートの別の場所を切り取って別カットにし、"
                 "人物は sway で風に揺らす。カット割りは build_shots.py で生成する(直接編集しない)。"),
    "cut": {"start": CUT[0], "end": CUT[1], "lead": 0.0},
    "lyrics": "../../not-your-medicine/lyrics_timing.json",
    "lyric_lead": 0.25, "lyric_style": "kinetic",
    "accent": [255, 176, 84], "grade": "night",
    "shots": shots,
}
json.dump(spec, open(os.path.join(HERE, "shots.json"), "w"), ensure_ascii=False, indent=2)
print("%d カット  平均 %.1f 秒" % (len(shots), (CUT[1] - CUT[0]) / len(shots)))
