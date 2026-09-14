#!/usr/bin/env python3
"""1枚のプレートを、視差をつけられるレイヤーに分解する。

背景と人物を分けておくと、カメラを寄せたときに人物だけが手前として動く。
1枚の絵から複数のカットを作るための下ごしらえで、生成は一切しない。
"""
import os, sys, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "art", "world_rooftop_dawn_C.png")
OUT = os.path.join(HERE, "art")
os.makedirs(OUT, exist_ok=True)
TARGET = (1152, 2048)          # 9:16。compose は 1080x1920 なので少し余白を持たせる


def upscale(im, size):
    """セル画は平坦面と硬い線でできているので、拡大後に軽く輪郭を締める。"""
    im = im.resize(size, Image.LANCZOS)
    return im.filter(ImageFilter.UnsharpMask(radius=2.0, percent=85, threshold=3))


plate = upscale(Image.open(SRC).convert("RGB"), TARGET)
plate.save(os.path.join(OUT, "bg_rooftop_dawn.png"))
W, H = plate.size

# --- 人物の切り抜き -------------------------------------------------------
# 彼女は明るい琥珀の空とコンクリートに対して濃紺〜黒。行ごとの明るさと比べて
# 暗いところを拾えば、しきい値を決め打ちしなくても輪郭が出る。
g = np.asarray(plate.convert("L"), dtype=np.float32)
row_ref = np.percentile(g, 70, axis=1, keepdims=True)     # その行の「地」の明るさ
dark = np.clip((row_ref - g) / 60.0, 0, 1)

band = np.zeros_like(dark)                                 # 電線と街の灯を拾わない範囲
y0, y1 = int(H * 0.36), int(H * 0.99)
x0, x1 = int(W * 0.22), int(W * 0.78)
band[y0:y1, x0:x1] = 1.0
mask = dark * band

m = Image.fromarray((mask * 255).astype(np.uint8))
m = m.filter(ImageFilter.MedianFilter(7))                  # 砂粒を消す
m = m.filter(ImageFilter.MaxFilter(5))                     # 途切れた線をつなぐ

# 地平線の街のシルエットも暗いので、しきい値だけでは彼女と一緒に拾ってしまう。
# つながっている塊に分けて、胴体のある塊だけを残す。
bin_ = np.asarray(m) > 110
lab, n = ndimage.label(ndimage.binary_dilation(bin_, iterations=9))   # 脚とコートを繋ぐ
seed = np.zeros(lab.shape, bool)
seed[int(H * 0.46):int(H * 0.62), int(W * 0.42):int(W * 0.58)] = True   # 胴体のあたり
ids, cnt = np.unique(lab[seed & (lab > 0)], return_counts=True)
if len(ids) == 0:
    sys.exit("胴体の位置に塊が無い。seed の範囲を見直すこと")
keep = ids[cnt.argmax()]
comp = (lab == keep) & ndimage.binary_dilation(bin_, iterations=9)

# 穴は一律に埋めない。白シャツのような小さい穴は埋めたいが、コートの裾と脚の
# 間から見えている床まで埋めると、足元が黒い塊になる。小さい穴だけ塞ぐ。
holes = ndimage.binary_fill_holes(comp) & ~comp
hl, hn = ndimage.label(holes)
solid = comp.copy()
limit = comp.sum() * 0.06
for hid in range(1, hn + 1):
    h = hl == hid
    if h.sum() < limit:
        solid |= h
solid = ndimage.binary_closing(solid, np.ones((9, 9)))

# 裾から下(脚とブーツ)は切り出さない。細くてマスクが塊になるうえ、
# 足は地面に着いていて揺れないので、背景に置いたままのほうが正しい。
solid = ndimage.binary_closing(solid, np.ones((31, 3)))

m = Image.fromarray(np.where(solid, 255, 0).astype(np.uint8))
m = m.filter(ImageFilter.GaussianBlur(1.6))                # 縁を馴染ませる

a = np.asarray(m, dtype=np.float32)
ys, xs = np.where(a > 110)
if len(ys) == 0:
    sys.exit("人物が見つからなかった。band の範囲を見直すこと")
pad = 26
bb = (max(0, xs.min() - pad), max(0, ys.min() - pad),
      min(W, xs.max() + pad), min(H, ys.max() + pad))

fig = plate.convert("RGBA").crop(bb)
fa = np.asarray(m.crop(bb), dtype=np.float32)
foot = int(fa.shape[0] * 0.10)   # 裾を背景の脚に溶かす                    # 最下端のわずかな帯
fade = np.ones(fa.shape[0], dtype=np.float32)
fade[-foot:] = np.linspace(1.0, 0.0, foot)
fig.putalpha(Image.fromarray((fa * fade[:, None]).astype(np.uint8)))
fig.save(os.path.join(OUT, "fig_c_back.png"))

# 人物を別レイヤーにするので、背景からは消しておく。消さないと寄ったときに
# 背景の彼女と手前の彼女がずれて二重になる。空も床も横方向にほぼ一様なので、
# 左右の無事な画素から行ごとに渡してやれば埋まる。
# 背景から消す範囲は、輪郭をなぞらずに矩形で取る。輪郭に沿って消すと、
# マスクから漏れたブーツの外側などが必ず残り、寄ったときに欠片として見える。
# 空も床も横方向にほぼ一様なので、多めに消しても埋め戻せる。
solid_a = np.zeros((H, W), bool)
solid_a[max(0, bb[1] - 40):min(H, bb[3] + 12), max(0, bb[0] - 40):min(W, bb[2] + 40)] = True
# 消した所を埋める。彼女がいた列を行ごとの中央値で潰してから、その結果だけを
# 大きくぼかして戻す。空も床も横方向にほぼ一様なので、ぼかしても帯の形は崩れない。
# 借りてくる方式(同じ行の離れた場所から貼る)は元画像から本人を拾って失敗した。
clean = np.asarray(plate, dtype=np.float32).copy()
for y in range(bb[1], bb[3]):
    row = solid_a[y]
    if not row.any():
        continue
    good = ~row
    if good.sum() < 8:
        continue
    for c in range(3):
        clean[y, row, c] = np.median(clean[y, good, c])
clean_im = Image.fromarray(clean.astype(np.uint8))

# 中央値で潰した跡は平坦な矩形に見えるので、その領域を広くぼかして境目を消す。
# 羽根を太くしないと、ぼかした四角の輪郭がそのまま出る。
soft = clean_im.filter(ImageFilter.GaussianBlur(28))
feather = Image.fromarray((ndimage.binary_dilation(solid_a, iterations=10) * 255)
                          .astype(np.uint8)).filter(ImageFilter.GaussianBlur(34))
clean_im = Image.composite(soft, clean_im, feather)
clean_im.save(os.path.join(OUT, "bg_rooftop_dawn_clean.png"))

# 人物が画面のどこにいるか。shots.json の x / y / w はこれを見て決める
cx = (bb[0] + bb[2]) / 2 / W
cy = (bb[1] + bb[3]) / 2 / H
fw = (bb[2] - bb[0]) / W
# 位置を書き出す。build_shots.py がこれを読むので、座標を2箇所で持たない
import json as _json
_json.dump({"x": round(cx, 4), "y": round(cy, 4), "w": round(fw, 4)},
           open(os.path.join(OUT, "figure.json"), "w"), indent=1)
print(f"figure bbox={bb} center=({cx:.3f},{cy:.3f}) width={fw:.3f} 被覆率={(a > 110).mean() * 100:.1f}%")


# --- 琥珀の線 -------------------------------------------------------------
def draw_line(path, bend=0.0, thick=14):
    """手で引いた線。定規の直線にはしない。bend は「少し曲がった線でいい」の分。"""
    line = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(line)
    y = H * 0.52
    pts = []
    for i in range(0, W + 1, 6):
        u = i / W
        wobble = 5 * math.sin(u * 7.3) + 3 * math.sin(u * 19.1 + 1.1)   # 手の震え
        pts.append((i, y + wobble + bend * math.sin(u * math.pi) * H * 0.13))
    for i in range(len(pts) - 1):
        u = i / len(pts)
        t = thick * (0.55 + 0.45 * math.sin(u * math.pi))               # 入り抜きで細くなる
        d.line([pts[i], pts[i + 1]], fill=(255, 196, 120, 255), width=max(2, int(t)))
    glow = line.filter(ImageFilter.GaussianBlur(16))
    glow.putalpha(glow.getchannel("A").point(lambda v: int(v * 0.85)))
    out = Image.alpha_composite(glow, line)
    out.save(os.path.join(OUT, path))


draw_line("line_straight.png", bend=0.0)      # NOT YOUR MEDICINE「線を引いて」
draw_line("line_bent.png", bend=1.0, thick=16)  # PAPER PLANE ROYALTY「少し曲がった線でいい」
print("wrote bg_rooftop_dawn.png / fig_c_back.png / line_straight.png / line_bent.png")
