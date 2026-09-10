#!/usr/bin/env python3
"""「PAPER PLANE ROYALTY」演出プラン「折って、飛ばす。」のアニマティック(プレビズ)生成。

実写・AI生成素材が無い段階で、演出の骨格(カット割り・拍同期・色のルール・歌詞の出し方・ループ)を
動画として確認するためのもの。すべてプログラム描画。Suno 自動生成ジャケットは使わない。

使い方:
  python3 animatic.py --song PAPER_PLANE_ROYALTY.mp3 --out animatic.mp4
  python3 animatic.py --song ... --stills 0.2,3.5,8.5 --out-dir stills/   # 静止画で確認
"""
import argparse
import json
import math
import os
import random
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

W, H = 1080, 1920
FPS = 30
FONT = "/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf"

# ---- パレット(視覚ルール: 世界は灰色、紙だけ白、飛んだ瞬間だけ色) ----
GRAY_DESK = (118, 122, 128)
PAPER = (246, 244, 238)
PAPER_BACK = (238, 235, 228)
INK = (66, 68, 74)
FORM = (150, 152, 156)
PINK = (255, 79, 163)
WHITE = (255, 255, 255)
HAND_GRAY = (164, 166, 172)
HAND_EDGE = (128, 130, 136)
HAND_COLOR = (226, 194, 172)
HAND_COLOR_EDGE = (190, 150, 128)
WOOD = (214, 190, 156)
SKY_GRAY = (188, 190, 194)
SKY_BLUE = (122, 192, 255)

PAPER_W, PAPER_H = 620, 880  # 紙の座標系(中心原点)

# ---------------------------------------------------------------- 幾何
def A_translate(tx, ty):
    return np.array([[1, 0, tx], [0, 1, ty], [0, 0, 1]], float)


def A_rotate(theta):
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], float)


def A_scale(k):
    return np.array([[k, 0, 0], [0, k, 0], [0, 0, 1]], float)


def A_fold(P, u, s):
    """折り線(P, 方向u)に対して法線成分を s 倍する変換。s=-1 で鏡映(折り完了)。"""
    ux, uy = u
    nx, ny = -uy, ux
    A = np.array([[ux * ux + s * nx * nx, ux * uy + s * nx * ny],
                  [ux * uy + s * nx * ny, uy * uy + s * ny * ny]])
    t = np.array(P, float) - A @ np.array(P, float)
    M = np.eye(3)
    M[:2, :2] = A
    M[:2, 2] = t
    return M


def apply(M, pts):
    return [(M[0, 0] * x + M[0, 1] * y + M[0, 2], M[1, 0] * x + M[1, 1] * y + M[1, 2]) for x, y in pts]


def clip_poly(poly, P, n):
    """半平面 (p-P)・n >= 0 で凸多角形を切る。"""
    out = []
    k = len(poly)
    for i in range(k):
        a, b = poly[i], poly[(i + 1) % k]
        da = (a[0] - P[0]) * n[0] + (a[1] - P[1]) * n[1]
        db = (b[0] - P[0]) * n[0] + (b[1] - P[1]) * n[1]
        if da >= 0:
            out.append(a)
        if (da >= 0) != (db >= 0):
            t = da / (da - db)
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out if len(out) >= 3 else None


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_color(c1, c2, t):
    return tuple(int(round(lerp(a, b, t))) for a, b in zip(c1, c2))


def centroid(poly):
    return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))


# ---------------------------------------------------------------- 紙(折り)
class Paper:
    def __init__(self):
        w, h = PAPER_W, PAPER_H
        self.facets = [dict(poly=[(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)],
                            M=np.eye(3), side=0, layer=0, moving=False)]
        self.states = []  # 折りごとの facets(moving に M_old 付き)
        self.folds = []

    def fold(self, P, u, S):
        u = np.array(u, float)
        u /= np.linalg.norm(u)
        n = np.array([-u[1], u[0]])
        if np.dot(np.array(S, float) - np.array(P, float), n) < 0:
            n = -n
        R = A_fold(P, u, -1.0)
        new = []
        for f in self.facets:
            Minv = np.linalg.inv(f["M"])
            Pl = apply(Minv, [P])[0]
            nl = Minv[:2, :2] @ n
            keep = clip_poly(f["poly"], Pl, -nl)
            move = clip_poly(f["poly"], Pl, nl)
            if keep:
                new.append(dict(poly=keep, M=f["M"], side=f["side"], layer=f["layer"], moving=False))
            if move:
                new.append(dict(poly=move, M=R @ f["M"], M_old=f["M"], side=1 - f["side"],
                                layer=f["layer"] + 1, moving=True))
        self.facets = new
        self.states.append([dict(f) for f in new])
        self.folds.append((tuple(P), (float(u[0]), float(u[1]))))
        return new


def facet_draw_matrix(f, fold, a):
    """折り k の進行 a(0..1) における facet の紙→紙平面 変換。"""
    if f.get("moving") and a < 1.0:
        P, u = fold
        return A_fold(P, u, math.cos(math.pi * a)) @ f["M_old"]
    return f["M"]


def build_paper():
    """始末書 → 紙飛行機(ダート型)の5折り。座標は紙中心原点、y下向き。"""
    w, h = PAPER_W, PAPER_H
    p = Paper()
    T = (0, -h / 2)
    r2 = math.sqrt(0.5)
    a22 = math.radians(22.5)
    p.fold(T, (-r2, r2), (-w / 2, -h / 2))                     # 左上角を中心線へ
    p.fold(T, (r2, r2), (w / 2, -h / 2))                       # 右上角を中心線へ
    p.fold(T, (-math.sin(a22), math.cos(a22)), (-w * 0.48, -h * 0.1))  # 左斜辺をもう一度中心へ
    p.fold(T, (math.sin(a22), math.cos(a22)), (w * 0.48, -h * 0.1))    # 右斜辺
    p.fold((0, 0), (0, 1), (-w * 0.3, 0))                      # 半分に折る
    return p


# ---------------------------------------------------------------- テクスチャ
_font_cache = {}


def font(size):
    if size not in _font_cache:
        _font_cache[size] = ImageFont.truetype(FONT, size)
    return _font_cache[size]


def wrap_chars(draw, text, f, max_w):
    lines, cur = [], ""
    for ch in text:
        if draw.textlength(cur + ch, font=f) <= max_w:
            cur += ch
        else:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines


def make_front_texture():
    """始末書(印刷物)。"""
    w, h = PAPER_W, PAPER_H
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    d.text((w / 2, 96), "始 末 書", font=font(46), fill=INK, anchor="mm")
    d.text((w - 44, 150), "2026年9月10日", font=font(18), fill=INK, anchor="rm")
    d.text((44, 190), "営業部長　殿", font=font(20), fill=INK, anchor="lm")
    d.text((w - 44, 232), "営業部　　　　　　　　　㊞", font=font(19), fill=INK, anchor="rm")
    body = ("この度は、私の不注意により取引先への納期報告を誤り、関係各位に多大なるご迷惑を"
            "おかけしましたことを深くお詫び申し上げます。今後はこのようなことのないよう、"
            "確認を徹底し、業務に精励いたします。")
    y = 290
    for line in wrap_chars(d, body, font(21), w - 88):
        d.text((44, y), line, font=font(21), fill=INK, anchor="lm")
        y += 36
    for k in range(6):
        yy = 520 + k * 48
        d.line([(44, yy), (w - 44, yy)], fill=FORM, width=1)
    d.text((44, 500), "再発防止策", font=font(19), fill=INK, anchor="lm")
    d.rectangle([w - 150, h - 150, w - 60, h - 60], outline=(120, 122, 128), width=2)
    d.text((w - 105, h - 105), "印", font=font(28), fill=(120, 122, 128), anchor="mm")
    d.rectangle([0, 0, w - 1, h - 1], outline=(214, 211, 204), width=1)
    return im


def handwriting(text, size, color, tilt_seed=1):
    """手書き風(1文字ずつ微妙に傾ける)。透明レイヤーを返す。"""
    rng = random.Random(tilt_seed)
    f = font(size)
    tmp = ImageDraw.Draw(Image.new("L", (1, 1)))
    widths = [tmp.textlength(ch, font=f) for ch in text]
    total = int(sum(widths) + size * 0.06 * len(text)) + size
    layer = Image.new("RGBA", (total, int(size * 1.9)), (0, 0, 0, 0))
    x = size * 0.4
    for ch, cw in zip(text, widths):
        g = Image.new("RGBA", (int(size * 1.6), int(size * 1.6)), (0, 0, 0, 0))
        ImageDraw.Draw(g).text((size * 0.8, size * 0.8), ch, font=f, fill=color, anchor="mm")
        g = g.rotate(rng.uniform(-6, 6), resample=Image.BICUBIC)
        layer.alpha_composite(g, (int(x - size * 0.8 + cw / 2), int(size * 0.15 + rng.uniform(-2, 2))))
        x += cw + size * 0.06
    return layer


LYRICS_ON_PAPER = ["Fold it,", "flip it", "Send it to", "the ceiling", "Catch it, kiss it"]


def make_back_textures(paper):
    """裏面テクスチャ: 折り k が終わった時点で、めくれた面に歌詞 k が書いてある。"""
    w, h = PAPER_W, PAPER_H
    base = Image.new("RGBA", (w, h), PAPER_BACK + (255,))
    ImageDraw.Draw(base).rectangle([0, 0, w - 1, h - 1], outline=(212, 208, 200), width=1)
    textures = [base.copy()]
    tex = base.copy()
    Lw = 1600
    for k, state in enumerate(paper.states):
        moving = [f for f in state if f.get("moving")]
        # 折った後の位置(紙平面座標)で一番大きい面の内接円中心に、収まるサイズで歌詞を置く
        polys_plane = [apply(f["M"], f["poly"]) for f in moving]
        big = max(polys_plane, key=lambda p: abs(sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1]
                                                     for i in range(len(p)))))
        cx, cy = centroid(big)
        r_in = min(abs((q[0] - p[0]) * (cy - p[1]) - (q[1] - p[1]) * (cx - p[0])) / math.hypot(q[0] - p[0], q[1] - p[1])
                   for p, q in zip(big, big[1:] + big[:1]))
        size = 34
        tmp = ImageDraw.Draw(Image.new("L", (1, 1)))
        while size > 22 and tmp.textlength(LYRICS_ON_PAPER[k], font=font(size)) > 1.7 * r_in:
            size -= 2
        text_layer = handwriting(LYRICS_ON_PAPER[k], size, INK + (255,), tilt_seed=k + 3)
        L = Image.new("RGBA", (Lw, Lw), (0, 0, 0, 0))
        L.alpha_composite(text_layer, (int(Lw / 2 + cx - text_layer.width / 2),
                                       int(Lw / 2 + cy - text_layer.height / 2)))
        # 紙テクスチャ座標 → 紙平面座標(M) → レイヤー座標
        for f in moving:
            C = A_translate(Lw / 2, Lw / 2) @ f["M"] @ A_translate(-w / 2, -h / 2)
            warped = L.transform((w, h), Image.AFFINE,
                                 (C[0, 0], C[0, 1], C[0, 2], C[1, 0], C[1, 1], C[1, 2]),
                                 resample=Image.BILINEAR)
            mask = Image.new("L", (w, h), 0)
            ImageDraw.Draw(mask).polygon([(x + w / 2, y + h / 2) for x, y in f["poly"]], fill=255)
            warped.putalpha(Image.fromarray(np.minimum(np.array(warped.getchannel("A")), np.array(mask))))
            tex.alpha_composite(warped)
        textures.append(tex.copy())
    return textures


# ---------------------------------------------------------------- 描画部品
def draw_paper(img, paper, k, a, S, front, backs, shade_moving=True):
    """紙を描く。k=完了した折り数(0..5)、a=折り k(1始まり)の進行。S=紙平面→画面 変換。"""
    if k == 0:
        facets = [dict(poly=[(-PAPER_W / 2, -PAPER_H / 2), (PAPER_W / 2, -PAPER_H / 2),
                             (PAPER_W / 2, PAPER_H / 2), (-PAPER_W / 2, PAPER_H / 2)],
                       M=np.eye(3), side=0, layer=0, moving=False)]
        fold = None
        back = backs[0]
    else:
        facets = paper.states[k - 1]
        fold = paper.folds[k - 1]
        back = backs[k]  # 折り始めた瞬間から裏面に歌詞 k が書いてある
    # 影
    shadow = Image.new("L", (W // 4, H // 4), 0)
    sd = ImageDraw.Draw(shadow)
    items = []
    for f in facets:
        Md = facet_draw_matrix(f, fold, a) if fold else f["M"]
        Mfull = S @ Md
        poly_s = apply(Mfull, f["poly"])
        items.append((f, Mfull, poly_s))
        sd.polygon([((x + 10) / 4, (y + 16) / 4) for x, y in poly_s], fill=110)
    shadow = shadow.filter(ImageFilter.GaussianBlur(3)).resize((W, H), Image.BILINEAR)
    img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), shadow)
    # 面
    s_val = math.cos(math.pi * a) if fold else 1.0
    for f, Mfull, poly_s in sorted(items, key=lambda it: (it[0]["layer"], it[0].get("moving", False))):
        xs = [p[0] for p in poly_s]
        ys = [p[1] for p in poly_s]
        bx, by = int(max(0, min(xs)) - 2), int(max(0, min(ys)) - 2)
        ex, ey = int(min(W, max(xs)) + 2), int(min(H, max(ys)) + 2)
        bw, bh = ex - bx, ey - by
        if bw <= 1 or bh <= 1:
            continue
        inv = np.linalg.inv(Mfull)
        C = A_translate(PAPER_W / 2, PAPER_H / 2) @ inv @ A_translate(bx, by)
        side = f["side"]
        if f.get("moving") and fold and a < 1.0 and s_val > 0:
            side = 1 - side  # 折りの前半は元の面が見えている
        tex = front if side == 0 else back
        tile = tex.convert("RGB").transform((bw, bh), Image.AFFINE,
                                            (C[0, 0], C[0, 1], C[0, 2], C[1, 0], C[1, 1], C[1, 2]),
                                            resample=Image.BILINEAR)
        if f.get("moving") and fold and a < 1.0 and shade_moving:
            tile = ImageEnhance.Brightness(tile).enhance(0.72 + 0.28 * abs(s_val))
        elif f["layer"] > 0:
            tile = ImageEnhance.Brightness(tile).enhance(0.985)
        mask = Image.new("L", (bw, bh), 0)
        ImageDraw.Draw(mask).polygon([(x - bx, y - by) for x, y in poly_s], fill=255)
        img.paste(tile, (bx, by), mask)
        ImageDraw.Draw(img).polygon(poly_s, outline=(206, 203, 196))


def draw_hand(img, tip, angle=0.0, scale=1.0, colored=False, alpha=255):
    """手(指先=tip)。指は上向き、手首は下。角度は時計回り(ラジアン)。"""
    fill = HAND_COLOR if colored else HAND_GRAY
    edge = HAND_COLOR_EDGE if colored else HAND_EDGE
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c, s = math.cos(angle), math.sin(angle)

    def tr(x, y):
        x, y = x * scale, y * scale
        return (tip[0] + x * c - y * s, tip[1] + x * s + y * c)

    def capsule(p0, p1, wdt, col):
        a, b = tr(*p0), tr(*p1)
        d.line([a, b], fill=col, width=int(wdt * scale))
        r = wdt * scale / 2
        for q in (a, b):
            d.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill=col)

    fingers = [((0, 0), (12, 150), 54), ((62, -18), (70, 140), 56), ((122, -2), (128, 145), 52),
               ((178, 34), (182, 160), 46)]
    for p0, p1, wd in fingers:
        capsule(p0, p1, wd + 8, edge)
    palm = [tr(-30, 120), tr(215, 130), tr(230, 330), tr(-20, 340)]
    d.polygon(palm, fill=edge)
    palm_in = [tr(-24, 126), tr(209, 136), tr(224, 324), tr(-14, 334)]
    d.polygon(palm_in, fill=fill)
    for p0, p1, wd in fingers:
        capsule(p0, p1, wd, fill)
    capsule((-95, 200), (-30, 260), 66, edge)
    capsule((-95, 200), (-30, 260), 58, fill)
    # 薬指の爪(ピンク) ― 灰色の世界で唯一の色
    nx, ny = tr(122, 6)
    r = 15 * scale
    d.ellipse([nx - r, ny - r * 1.25, nx + r, ny + r * 1.25], fill=PINK)
    if alpha < 255:
        layer.putalpha(Image.fromarray((np.array(layer.getchannel("A")) * (alpha / 255)).astype(np.uint8)))
    img.alpha_composite(layer) if img.mode == "RGBA" else img.paste(layer, (0, 0), layer)


def plane_side_polys(scale=1.0, angle=0.0, pos=(540, 1000)):
    c, s = math.cos(angle), math.sin(angle)

    def tr(x, y):
        x, y = x * scale, y * scale
        return (pos[0] + x * c - y * s, pos[1] + x * s + y * c)

    body = [tr(170, 0), tr(-170, -20), tr(-150, 6), tr(-170, 30)]
    wing = [tr(90, -8), tr(-170, -70), tr(-160, -22)]
    keel = [tr(40, 4), tr(-150, 6), tr(-170, 30)]
    return body, wing, keel, tr


_glow_cache = {}


def glow_sprite(radius, color):
    key = (radius, color)
    if key not in _glow_cache:
        sz = radius * 4
        g = Image.new("RGBA", (sz, sz), color + (0,))
        d = ImageDraw.Draw(g)
        for i in range(6):
            r = radius * (1.0 - i * 0.14)
            d.ellipse([sz / 2 - r, sz / 2 - r, sz / 2 + r, sz / 2 + r], fill=color + (int(28 + i * 26),))
        _glow_cache[key] = g.filter(ImageFilter.GaussianBlur(radius * 0.45))
    return _glow_cache[key]


def draw_plane_side(img, pos, angle=0.0, scale=1.0, glow=0.0, colored=False, wing_text=None):
    body, wing, keel, tr = plane_side_polys(scale, angle, pos)
    if glow > 0:
        r = int(90 * scale * (0.5 + glow))
        g = glow_sprite(max(8, r), PINK)
        g = g.copy()
        g.putalpha(Image.fromarray((np.array(g.getchannel("A")) * min(1.0, glow)).astype(np.uint8)))
        nose = tr(170, 0)
        img.paste(g, (int(nose[0] - g.width / 2), int(nose[1] - g.height / 2)), g)
    d = ImageDraw.Draw(img)
    d.polygon(keel, fill=(214, 211, 204), outline=(190, 187, 180))
    d.polygon(body, fill=PAPER, outline=(200, 197, 190))
    d.polygon(wing, fill=(236, 234, 228), outline=(200, 197, 190))
    if glow > 0:
        nose = tr(170, 0)
        rr = 6 * scale
        d.ellipse([nose[0] - rr, nose[1] - rr, nose[0] + rr, nose[1] + rr], fill=PINK)
    if wing_text:
        t = handwriting(wing_text, int(26 * scale), INK + (255,), tilt_seed=9).rotate(
            -math.degrees(angle) + 14, resample=Image.BICUBIC, expand=True)
        cx, cy = tr(-60, -32)
        img.paste(t, (int(cx - t.width / 2), int(cy - t.height / 2)), t)


def draw_plane_top_small(d, pos, angle, size, colored=True):
    c, s = math.cos(angle), math.sin(angle)

    def tr(x, y):
        return (pos[0] + (x * c - y * s) * size, pos[1] + (x * s + y * c) * size)

    d.polygon([tr(1.0, 0), tr(-0.8, -0.55), tr(-0.5, 0), tr(-0.8, 0.55)], fill=PAPER, outline=(205, 202, 196))
    if colored:
        d.ellipse([tr(1.0, 0)[0] - size * 0.12, tr(1.0, 0)[1] - size * 0.12,
                   tr(1.0, 0)[0] + size * 0.12, tr(1.0, 0)[1] + size * 0.12], fill=PINK)


# ---------------------------------------------------------------- 背景
def noise_image(w, h, seed=7, amount=10):
    rng = np.random.default_rng(seed)
    return rng.integers(-amount, amount + 1, size=(h, w, 1), dtype=np.int16)


_bg_cache = {}


def desk_background(colored=False):
    key = ("desk", colored)
    if key not in _bg_cache:
        base = np.array(Image.new("RGB", (W, H), WOOD if colored else GRAY_DESK), dtype=np.int16)
        base = np.clip(base + noise_image(W, H, seed=3, amount=6), 0, 255).astype(np.uint8)
        im = Image.fromarray(base)
        if colored:
            d = ImageDraw.Draw(im)
            for i in range(0, H, 140):  # 木目
                d.line([(0, i), (W, i + 30)], fill=(200, 176, 140), width=2)
        im = im.filter(ImageFilter.GaussianBlur(0.6))
        _bg_cache[key] = im
    return _bg_cache[key].copy()


def vignette(strength=120):
    """中心 0、四隅 strength の周辺減光マスク。"""
    key = ("vig", strength)
    if key not in _bg_cache:
        ys, xs = np.mgrid[0:H // 4, 0:W // 4]
        nx = (xs / (W / 8) - 1.0)
        ny = (ys / (H / 8) - 1.0)
        d = np.sqrt(nx * nx + ny * ny) / math.sqrt(2)
        a = np.clip((d - 0.45) / 0.55, 0, 1) ** 1.5 * strength
        m = Image.fromarray(a.astype(np.uint8)).resize((W, H), Image.BILINEAR)
        _bg_cache[key] = m
    return _bg_cache[key]


def apply_vignette(img, strength=120):
    img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), vignette(strength))


def sky_image(colored):
    key = ("sky", colored)
    if key not in _bg_cache:
        top = (108, 178, 250) if colored else (176, 178, 182)
        bot = (200, 232, 255) if colored else (206, 207, 210)
        arr = np.zeros((H, W, 3), dtype=np.uint8)
        for y in range(H):
            t = y / H
            arr[y, :, :] = [int(lerp(a, b, t)) for a, b in zip(top, bot)]
        _bg_cache[key] = Image.fromarray(arr)
    return _bg_cache[key].copy()


def make_buildings(seed=11, span=3200):
    rng = random.Random(seed)
    layers = []
    for depth, (hmin, hmax, tone_lo, tone_hi) in enumerate([(220, 520, 150, 170), (380, 820, 112, 138)]):
        x = -400
        bl = []
        while x < span:
            w = rng.randint(70, 170)
            h = rng.randint(hmin, hmax)
            tone = rng.randint(tone_lo, tone_hi)
            hue = rng.choice([(255, 196, 214), (190, 226, 255), (255, 238, 178), (204, 250, 222), (226, 206, 255)])
            wins = [(wx, wy) for wx in range(10, w - 12, 18) for wy in range(14, h - 12, 24) if rng.random() < 0.55]
            bl.append(dict(x=x, w=w, h=h, tone=tone, hue=hue, wins=wins))
            x += w + rng.randint(6, 26)
        layers.append(bl)
    return layers


BUILDINGS = make_buildings()


def draw_city(img, offset=0.0, colored=0.0, horizon=1180, scale=1.0, window_frame=False):
    """街。colored は 0(灰)〜1(色)。"""
    d = ImageDraw.Draw(img)
    for depth, bl in enumerate(BUILDINGS):
        par = 0.45 if depth == 0 else 1.0
        for b in bl:
            x0 = (b["x"] - offset * par) * scale
            w = b["w"] * scale
            if x0 + w < -10 or x0 > W + 10:
                continue
            h = b["h"] * scale * (0.85 if depth == 0 else 1.0)
            gray = (b["tone"] - 20 * depth,) * 3
            col = lerp_color(gray, b["hue"], colored) if colored > 0 else gray
            d.rectangle([x0, horizon - h, x0 + w, horizon + 400], fill=col)
            wcol = lerp_color((b["tone"] + 34,) * 3, (255, 250, 230), colored)
            for wx, wy in b["wins"]:
                if wy * scale < h - 10:
                    d.rectangle([x0 + wx * scale, horizon - h + wy * scale,
                                 x0 + wx * scale + 5 * scale, horizon - h + wy * scale + 7 * scale], fill=wcol)
    ground = lerp_color((120, 122, 126), (150, 184, 150), colored)
    d.rectangle([0, horizon + 60, W, H], fill=ground)
    if window_frame:
        fr = (58, 60, 64)
        d.rectangle([0, 0, W, 70], fill=fr)
        d.rectangle([0, H - 380, W, H], fill=fr)
        d.rectangle([0, 0, 60, H], fill=fr)
        d.rectangle([W - 60, 0, W, H], fill=fr)
        d.rectangle([W / 2 - 14, 0, W / 2 + 14, H], fill=fr)
        d.rectangle([0, 620, W, 648], fill=fr)
        d.rectangle([60, H - 400, W - 60, H - 380], fill=(90, 92, 96))  # 窓枠の棚


# ---------------------------------------------------------------- テロップ
_cap_cache = {}


def caption_layer(text, size, style="hook", max_w=W - 2 * 96):
    key = (text, size, style)
    if key in _cap_cache:
        return _cap_cache[key]
    f = font(size)
    tmp = ImageDraw.Draw(Image.new("L", (1, 1)))
    if tmp.textlength(text, font=f) <= max_w:
        lines = [text]
    elif " " in text:  # 英語は単語単位で折り返す
        lines, cur = [], ""
        for wd in text.split(" "):
            cand = (cur + " " + wd) if cur else wd
            if tmp.textlength(cand, font=f) <= max_w:
                cur = cand
            else:
                lines.append(cur)
                cur = wd
        lines.append(cur)
    else:
        lines = wrap_chars(tmp, text, f, max_w)
    lh = int(size * 1.35)
    layer = Image.new("RGBA", (W, lh * len(lines) + 60), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i, line in enumerate(lines):
        y = 30 + lh * i + lh / 2
        if style == "hook":
            d.text((W / 2, y), line, font=f, fill=(0, 0, 0, 255), anchor="mm", stroke_width=10, stroke_fill=(0, 0, 0, 255))
            d.text((W / 2, y), line, font=f, fill=WHITE + (255,), anchor="mm", stroke_width=2, stroke_fill=WHITE + (255,))
        else:
            sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
            ImageDraw.Draw(sh).text((W / 2 + 2, y + 6), line, font=f, fill=(0, 0, 0, 170), anchor="mm",
                                    stroke_width=3, stroke_fill=(0, 0, 0, 170))
            layer.alpha_composite(sh.filter(ImageFilter.GaussianBlur(6)))
            d = ImageDraw.Draw(layer)
            d.text((W / 2, y), line, font=f, fill=WHITE + (255,), anchor="mm", stroke_width=1, stroke_fill=WHITE + (255,))
    _cap_cache[key] = layer
    return layer


def put_caption(img, text, y, size, style="hook", alpha=1.0, scale=1.0):
    layer = caption_layer(text, size, style)
    if scale != 1.0:
        layer = layer.resize((int(layer.width * scale), int(layer.height * scale)), Image.BILINEAR)
    if alpha < 1.0:
        layer = layer.copy()
        layer.putalpha(Image.fromarray((np.array(layer.getchannel("A")) * max(0.0, alpha)).astype(np.uint8)))
    img.paste(layer, (int(W / 2 - layer.width / 2), int(y - layer.height / 2)), layer)


# ---------------------------------------------------------------- 拍グリッド
def analyze_grid(song):
    import librosa
    y, sr = librosa.load(song, sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    bt = np.array(beats)
    rms = librosa.feature.rms(y=y, hop_length=512)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=512)
    per = []
    for i in range(len(bt) - 1):
        m = (times >= bt[i]) & (times < bt[i + 1])
        per.append(float(rms[m].mean()) if m.any() else 0.0)
    per = np.array(per)
    best = None
    for i in range(2, len(per) - 2):
        if 69 <= bt[i] <= 75:
            sc = per[i:i + 2].mean() - per[i - 2:i].mean()
            if best is None or sc > best[0]:
                best = (sc, i)
    iA = best[1]
    return bt, iA, float(np.atleast_1d(tempo)[0])


class Grid:
    def __init__(self, bt, iA):
        self.bt = bt
        self.iA = iA
        self.iB = iA + 24   # ブリッジ頭(6小節後)
        self.iC = iA + 60   # 最終サビ頭(15小節後)
        self.iEnd = iA + 92  # サビ8小節の終わり
        self.t0 = float(bt[iA])
        self.dur = float(bt[self.iEnd] - bt[iA])

    def at(self, t_rel):
        T = self.t0 + t_rel
        k = int(np.searchsorted(self.bt, T, side="right") - 1)
        k = max(0, min(len(self.bt) - 2, k))
        phase = (T - self.bt[k]) / (self.bt[k + 1] - self.bt[k])
        return k - self.iA, float(max(0.0, min(1.0, phase)))

    def beat_time(self, b):
        return float(self.bt[self.iA + b] - self.t0)


# ---------------------------------------------------------------- シーン
BRIDGE_LINES = ["正解ばかり探してたら", "笑い方まで固くなる", "少し曲がった線でいい", "その方が遠くへ飛べる"]
CHORUS_LINES = ["I'm paper plane royalty", "Flying over every worry", "I turn the ordinary",
                "Into something bright and blurry", "I don't need a golden crown", "I don't need a perfect sign",
                "I'm paper plane royalty", "Flying over every worry"]
HOOK = "始末書、紙飛行機にしてみた。"


class Animatic:
    def __init__(self, grid):
        self.g = grid
        self.paper = build_paper()
        self.front = make_front_texture()
        self.backs = make_back_textures(self.paper)
        self.fold_starts = [grid.beat_time(4 + 2 * k) for k in range(5)]
        self.fold_dur = 0.34

    # --- 紙の状態 (完了折り数 k, 進行 a)
    def paper_state(self, t):
        k, a = 0, 1.0
        for i, st in enumerate(self.fold_starts):
            if t >= st:
                k = i + 1
                a = min(1.0, (t - st) / self.fold_dur)
        return k, ease(a) if a < 1.0 else 1.0

    def S_desk(self, theta_deg=-6, scale=1.0, center=(540, 1000)):
        return A_translate(*center) @ A_rotate(math.radians(theta_deg)) @ A_scale(scale)

    # --- 各シーン
    def scene_desk_intro(self, img, t, b, phase):
        img.paste(desk_background(False))
        S = self.S_desk()
        draw_paper(img, self.paper, 0, 1.0, S, self.front, self.backs)
        # 手: 下から入って紙の右側をなでる(タイトルは隠さない)
        prog = ease(min(1.0, t / 1.3))
        y = lerp(2050, 1080, prog) - 120 * ease(max(0.0, (t - 1.0) / 0.7))
        draw_hand(img, (690, y), angle=math.radians(-6), scale=1.05)
        apply_vignette(img, 80)
        self.hook_caption(img, t)

    def hook_caption(self, img, t):
        t_end = self.g.beat_time(8)
        if t > t_end + 0.3:
            return
        alpha = 1.0 if t < t_end else 1.0 - (t - t_end) / 0.3
        pop = 1.0 + 0.12 * (1 - ease(min(1.0, t / 0.18)))
        put_caption(img, HOOK, 520, 60, "hook", alpha=alpha, scale=pop)

    def scene_fold(self, img, t, b, phase):
        img.paste(desk_background(False))
        k, a = self.paper_state(t)
        theta, scale, center = -6.0, 1.0, (540, 1000)
        press = 0.0
        if b in (5, 7, 9, 11, 13) and phase < 0.35:
            press = (1 - phase / 0.35)
        if b >= 13:  # 折り終わった飛行機を持ち上げて回す
            u = ease((t - self.g.beat_time(13)) / (self.g.beat_time(16) - self.g.beat_time(13)))
            theta = lerp(-6.0, -24.0, u)
            scale = lerp(1.0, 1.12, u)
            center = (540 + 40 * u, 1000 - 60 * u)
        S = self.S_desk(theta, scale * (1 - 0.015 * press), center)
        draw_paper(img, self.paper, k, a, S, self.front, self.backs)
        # 手: 折っている角を追う
        if k >= 1 and a < 1.0:
            P, u = self.paper.folds[k - 1]
            state = self.paper.states[k - 1]
            moving = [f for f in state if f.get("moving")]
            pts = []
            for f in moving:
                Md = facet_draw_matrix(f, (P, u), a)
                pts += apply(S @ Md, f["poly"])
            tip = max(pts, key=lambda p: -p[1] + 0.35 * abs(p[0] - 540)) if pts else (540, 1000)
            draw_hand(img, (tip[0] - 10, tip[1] + 4), angle=math.radians(-10 if tip[0] < 540 else 10), scale=1.0)
        elif b >= 13:
            draw_hand(img, (640, 1160), angle=math.radians(-22), scale=1.05)
        else:
            # 押さえる(次の折りの角の近くで待つ)
            draw_hand(img, (760, 1180 + 20 * press), angle=math.radians(-12), scale=1.0)
        apply_vignette(img, 80)
        self.hook_caption(img, t)
        self.glitch(img, phase, b)

    def glitch(self, img, phase, b, strength=1.0):
        if phase < 0.08:
            rng = random.Random(b)
            for _ in range(3):
                y = rng.randint(0, H - 40)
                hgt = rng.randint(8, 34)
                dx = rng.randint(-26, 26)
                band = img.crop((0, y, W, y + hgt))
                img.paste(band, (dx, y))

    def wall_background(self, img, flicker=0.0):
        arr = np.zeros((H, W, 3), dtype=np.uint8)
        for y in range(H):
            t = y / H
            c = lerp_color((156, 159, 164), (116, 119, 124), t)
            arr[y, :, :] = c
        img.paste(Image.fromarray(arr))
        d = ImageDraw.Draw(img)
        # 天井の縁と蛍光灯
        d.rectangle([0, 0, W, 240], fill=(140, 143, 148))
        d.line([(0, 240), (W, 240)], fill=(118, 121, 126), width=3)
        lit = lerp_color((214, 216, 212), (250, 252, 246), min(1.0, flicker))
        d.rectangle([250, 90, W - 250, 150], fill=lit, outline=(150, 152, 156), width=3)
        g = glow_sprite(160, (255, 255, 250)).copy()
        g.putalpha(Image.fromarray((np.array(g.getchannel("A")) * (0.25 + 0.5 * flicker)).astype(np.uint8)))
        img.paste(g, (int(W / 2 - g.width / 2), int(120 - g.height / 2)), g)

    def scene_lift(self, img, t, b, phase):
        flick = math.exp(-phase * 5.0)
        self.wall_background(img, flicker=flick)
        u = ease((t - self.g.beat_time(16)) / (self.g.beat_time(20) - self.g.beat_time(16)))
        y = lerp(1300, 900, u)
        glow = 0.15 + 0.85 * u
        # 手が下から支え、その上に飛行機(手は飛行機を隠さない)
        draw_hand(img, (430, y + 210), angle=math.radians(-34), scale=1.15)
        draw_plane_side(img, (560, y), angle=math.radians(-26), scale=1.7, glow=glow, wing_text="Small wings")
        apply_vignette(img, 70)
        self.glitch(img, phase, b)

    def scene_launch(self, img, t, b, phase):
        t_start = self.g.beat_time(20)
        t_end = self.g.beat_time(24)
        u = (t - t_start) / (t_end - t_start)
        flick = math.exp(-phase * 5.0)
        self.wall_background(img, flicker=flick)
        # 天井タイルが紙のようにめくれて空が見える
        d = ImageDraw.Draw(img)
        cols, rows = 6, 3
        peel = ease(min(1.0, u * 1.25))
        for r in range(rows):
            for c in range(cols):
                x0, x1 = c * W / cols, (c + 1) * W / cols
                y0, y1 = r * 80, (r + 1) * 80
                dist = math.hypot((c + 0.5 - cols / 2) / cols, (r + 0.5 - rows / 2) / rows)
                p = ease(min(1.0, max(0.0, (peel * 1.6 - dist * 1.2))))
                d.rectangle([x0, y0, x1, y1], fill=SKY_BLUE)
                d.rectangle([x0 + 2, y0 + 2, x1 - 2, y0 + 2 + (y1 - y0 - 4) * (1 - p)], fill=(124, 127, 132),
                            outline=(108, 111, 116))
        # 飛行機の上昇(最初ゆっくり→加速)、残像
        yy = lerp(900, -260, u * u)
        if u < 0.25:
            draw_hand(img, (430, 1110), angle=math.radians(-34), scale=1.15)
        for i in range(5, 0, -1):
            yb = yy + i * 52
            draw_plane_side(img, (560 + i * 3, yb), angle=math.radians(-72), scale=1.4, glow=0.0)
        draw_plane_side(img, (560, yy), angle=math.radians(-72), scale=1.5, glow=1.0)
        apply_vignette(img, 70)
        self.glitch(img, phase, b)
        # 最後の拍で黒へ
        if b == 23 and phase > 0.55:
            k = (phase - 0.55) / 0.45
            img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), Image.new("L", (W, H), int(255 * ease(k))))

    def city_scene(self, img, t, colored=0.0, offset=0.0, window=True, zoom=1.0):
        img.paste(sky_image(colored >= 0.5) if colored in (0.0, 1.0) else
                  Image.blend(sky_image(False), sky_image(True), colored))
        draw_city(img, offset=offset, colored=colored, horizon=1180, scale=zoom, window_frame=window)

    def scene_bridge_a(self, img, t, b, phase):
        t_start = self.g.beat_time(24)
        u = t - t_start
        self.city_scene(img, t, colored=0.0, offset=40 * u, window=True)
        # 滑空する飛行機
        x = lerp(120, 960, ease(u / (self.g.beat_time(40) - t_start)))
        y = 760 + 40 * math.sin(u * 1.4)
        d = ImageDraw.Draw(img)
        draw_plane_top_small(d, (x, y), angle=math.radians(-12 + 10 * math.sin(u)), size=58, colored=False)
        apply_vignette(img, 70)
        bar = (b - 24) // 4
        line = BRIDGE_LINES[0] if bar < 2 else BRIDGE_LINES[1]
        self.lyric_fade(img, line, t, self.g.beat_time(24 if bar < 2 else 32), self.g.beat_time(32 if bar < 2 else 40), 1240, 74)
        # 黒からのフェードイン
        if u < 0.5:
            img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), Image.new("L", (W, H), int(255 * (1 - ease(u / 0.5)))))

    def lyric_fade(self, img, text, t, t_in, t_out, y, size):
        a = min(1.0, (t - t_in) / 0.35, max(0.0, (t_out - t) / 0.3))
        if a <= 0:
            return
        put_caption(img, text, y, size, "lyric", alpha=a)

    def scene_bridge_b(self, img, t, b, phase):
        bar = (b - 40) // 4
        if bar < 2:
            # マクロ: 少し曲がった折り線
            img.paste(desk_background(False))
            u = t - self.g.beat_time(40)
            S = self.S_desk(-32 + 2 * u, 1.9, (540, 1080 - 30 * u))
            draw_paper(img, self.paper, 5, 1.0, S, self.front, self.backs)
            d = ImageDraw.Draw(img)
            pts = apply(S, [(0, -PAPER_H / 2), (6, -PAPER_H * 0.2), (-4, PAPER_H * 0.2), (0, PAPER_H / 2)])
            for i in range(len(pts) - 1):
                x0, y0 = pts[i]
                x1, y1 = pts[i + 1]
                n = 14
                for j in range(0, n, 2):
                    d.line([(lerp(x0, x1, j / n), lerp(y0, y1, j / n)), (lerp(x0, x1, (j + 1) / n), lerp(y0, y1, (j + 1) / n))],
                           fill=PINK, width=6)
            apply_vignette(img, 90)
            self.lyric_fade(img, BRIDGE_LINES[2], t, self.g.beat_time(40), self.g.beat_time(48), 1500, 74)
        else:
            # ビルの横を傾いて抜ける
            u = t - self.g.beat_time(48)
            self.city_scene(img, t, colored=0.0, offset=520 * u, window=False, zoom=1.6)
            draw_plane_side(img, (520, 900 - 30 * u), angle=math.radians(-28), scale=2.1, glow=0.35)
            apply_vignette(img, 80)
            if b < 56:
                self.lyric_fade(img, BRIDGE_LINES[3], t, self.g.beat_time(48), self.g.beat_time(56), 1420, 74)
            else:
                # 9小節目: 空へ抜けて一呼吸
                pass

    def scene_pre_chorus(self, img, t, b, phase):
        u = t - self.g.beat_time(56)
        img.paste(sky_image(False))
        d = ImageDraw.Draw(img)
        draw_plane_top_small(d, (540 + 60 * u, 1200 - 260 * u), angle=math.radians(-40), size=70 + 30 * u, colored=False)
        apply_vignette(img, 60)

    def particles(self, d, t, colored=True):
        for j in range(60, min(84, int(60 + (t - self.g.beat_time(60)) / 0.44) + 1)):
            ts = self.g.beat_time(j)
            if t < ts:
                continue
            rng = random.Random(1000 + j)
            for i in range(9):
                age = t - ts - rng.uniform(0, 0.3)
                if age < 0 or age > 3.2:
                    continue
                ox = rng.uniform(40, W - 40)
                oy = rng.uniform(560, 1160)
                vx = rng.uniform(60, 220)
                vy = -rng.uniform(140, 360)
                x = ox + vx * age
                y = oy + vy * age + 12 * math.sin(age * 5 + i)
                if -60 < x < W + 60 and -60 < y < H:
                    draw_plane_top_small(d, (x, y), angle=math.atan2(vy, vx), size=rng.uniform(14, 30), colored=colored)

    def scene_chorus_city(self, img, t, b, phase):
        u = t - self.g.beat_time(60)
        colored = ease(min(1.0, u / 0.45))
        gray = Image.new("RGB", (W, H))
        self.city_scene(gray, t, colored=1.0, offset=1200 + 30 * u, window=False, zoom=1.15)
        if colored < 1.0:
            g = ImageOps.grayscale(gray).convert("RGB")
            img.paste(Image.blend(g, gray, colored))
        else:
            img.paste(gray)
        d = ImageDraw.Draw(img)
        self.particles(d, t)
        apply_vignette(img, 60)
        bar = (b - 60) // 4
        self.lyric_fade(img, CHORUS_LINES[bar], t, self.g.beat_time(60 + 4 * bar), self.g.beat_time(64 + 4 * bar), 1400, 80)

    def fireworks(self, img, t):
        d = ImageDraw.Draw(img, "RGBA")
        for j in range(66, 76):
            ts = self.g.beat_time(j)
            age = t - ts
            if age < 0 or age > 1.6:
                continue
            rng = random.Random(500 + j)
            cx, cy = rng.uniform(200, W - 200), rng.uniform(300, 900)
            col = rng.choice([(255, 150, 200), (150, 230, 255), (255, 240, 150), (200, 255, 210)])
            r = 560 * (1 - math.exp(-3.2 * age))
            alpha = int(255 * max(0.0, 1 - age / 1.5))
            for i in range(30):
                ang = i / 30 * 2 * math.pi + j
                px, py = cx + r * math.cos(ang), cy + r * math.sin(ang) + 120 * age * age
                rr = 14 * (1 - age / 1.9)
                d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=col + (alpha,))
                d.line([(cx + r * 0.65 * math.cos(ang), cy + r * 0.65 * math.sin(ang) + 120 * age * age), (px, py)],
                       fill=col + (alpha // 2,), width=5)
            d.ellipse([cx - r * 0.98, cy - r * 0.98, cx + r * 0.98, cy + r * 0.98], outline=col + (alpha // 2,), width=6)
            core = int(60 * (1 - age / 1.2)) if age < 1.2 else 0
            if core > 0:
                d.ellipse([cx - core, cy - core, cx + core, cy + core], fill=(255, 255, 255, alpha))

    def scene_fireworks(self, img, t, b, phase):
        img.paste(sky_image(True))
        self.fireworks(img, t)
        d = ImageDraw.Draw(img)
        self.particles(d, t)
        u = t - self.g.beat_time(68)
        draw_plane_top_small(d, (200 + 260 * u, 1500 - 220 * u), angle=math.radians(-35), size=90, colored=True)
        bar = (b - 60) // 4
        # 「bright」の瞬間: 白フラッシュ + 彩度
        if b == 72 and phase < 0.12:
            flash = int(255 * (1 - phase / 0.12) * 0.7)
            img.paste(Image.new("RGB", (W, H), WHITE), (0, 0), Image.new("L", (W, H), flash))
        if b >= 72:
            img.paste(ImageEnhance.Color(img).enhance(1.35))
        apply_vignette(img, 40)
        self.lyric_fade(img, CHORUS_LINES[bar], t, self.g.beat_time(60 + 4 * bar), self.g.beat_time(64 + 4 * bar), 1400, 80)

    def draw_crown(self, d, cx, cy, angle=0.0, scale=1.0):
        c, s = math.cos(angle), math.sin(angle)

        def tr(x, y):
            x, y = x * scale, y * scale
            return (cx + x * c - y * s, cy + x * s + y * c)

        pts = [tr(-150, 60), tr(-150, -30), tr(-90, 30), tr(-40, -70), tr(0, 30), tr(40, -70), tr(90, 30), tr(150, -30), tr(150, 60)]
        d.polygon(pts, fill=(238, 220, 150), outline=(190, 168, 100))
        for x, y in [(-150, -30), (-40, -70), (40, -70), (150, -30)]:
            p = tr(x, y)
            d.ellipse([p[0] - 9, p[1] - 9, p[0] + 9, p[1] + 9], fill=(214, 190, 110))

    def scene_crown(self, img, t, b, phase):
        img.paste(desk_background(True))
        d = ImageDraw.Draw(img)
        u = (t - self.g.beat_time(80)) / (self.g.beat_time(84) - self.g.beat_time(80)) if b >= 80 else 0.0
        u = ease(max(0.0, min(1.0, u)))
        crown_x = 540 + 700 * u
        self.draw_crown(d, crown_x, 1000 + 40 * u, angle=math.radians(-8 + 30 * u), scale=1.5)
        # 手が左から入り(指先が右向き、手のひらは左)、王冠を右へ押しのける
        enter = ease(min(1.0, (t - self.g.beat_time(77)) / 1.1))
        hx = lerp(-320, crown_x - 230, enter) if u <= 0 else crown_x - 230
        draw_hand(img, (hx, 1010), angle=math.radians(84), scale=1.1, colored=True)
        apply_vignette(img, 90)
        bar = (b - 60) // 4
        self.lyric_fade(img, CHORUS_LINES[bar], t, self.g.beat_time(60 + 4 * bar), self.g.beat_time(64 + 4 * bar), 1440, 80)

    def scene_fly_to_camera(self, img, t, b, phase):
        img.paste(sky_image(True))
        u = (t - self.g.beat_time(84)) / (self.g.beat_time(88) - self.g.beat_time(84))
        u = max(0.0, min(1.0, u))
        d = ImageDraw.Draw(img)
        self.particles(d, t)
        sc = lerp(0.35, 3.6, u * u * u)
        draw_plane_side(img, (540 + 40 * u, 900 + 200 * u), angle=math.radians(-12 + 8 * u), scale=sc, glow=0.8)
        apply_vignette(img, 40)
        self.lyric_fade(img, CHORUS_LINES[6], t, self.g.beat_time(84), self.g.beat_time(88), 1440, 80)

    def scene_land_unfold(self, img, t, b, phase):
        t0 = self.g.beat_time(88)
        t1 = self.g.beat_time(92)
        u = (t - t0) / (t1 - t0)
        # 色は灰色へ戻る
        colored = 1.0 - ease(min(1.0, u / 0.55))
        col = desk_background(True)
        gray = desk_background(False)
        img.paste(Image.blend(gray, col, colored) if 0 < colored < 1 else (col if colored >= 1 else gray))
        if u < 0.42:
            v = ease(u / 0.42)
            S = self.S_desk(lerp(-40, -6, v), lerp(1.7, 1.0, v), (lerp(700, 540, v), lerp(500, 1000, v)))
            draw_paper(img, self.paper, 5, 1.0, S, self.front, self.backs)
        else:
            # 逆再生で開く: 折り5→1
            w = (u - 0.42) / 0.58
            step = 1.0 / 5
            idx = min(4, int(w / step))
            a = 1.0 - ease((w - idx * step) / step)
            k = 5 - idx
            S = self.S_desk(-6, 1.0, (540, 1000))
            if w >= 1.0:
                draw_paper(img, self.paper, 0, 1.0, S, self.front, self.backs)
            else:
                draw_paper(img, self.paper, k, a, S, self.front, self.backs)
        apply_vignette(img, 80)
        self.lyric_fade(img, CHORUS_LINES[7], t, self.g.beat_time(88), self.g.beat_time(91), 1520, 80)

    # --- ディスパッチ
    def render(self, t):
        b, phase = self.g.at(t)
        img = Image.new("RGB", (W, H), (0, 0, 0))
        if b < 4:
            self.scene_desk_intro(img, t, b, phase)
        elif b < 16:
            self.scene_fold(img, t, b, phase)
        elif b < 20:
            self.scene_lift(img, t, b, phase)
        elif b < 24:
            self.scene_launch(img, t, b, phase)
        elif b < 40:
            self.scene_bridge_a(img, t, b, phase)
        elif b < 56:
            self.scene_bridge_b(img, t, b, phase)
        elif b < 60:
            self.scene_pre_chorus(img, t, b, phase)
        elif b < 68:
            self.scene_chorus_city(img, t, b, phase)
        elif b < 76:
            self.scene_fireworks(img, t, b, phase)
        elif b < 84:
            self.scene_crown(img, t, b, phase)
        elif b < 88:
            self.scene_fly_to_camera(img, t, b, phase)
        else:
            self.scene_land_unfold(img, t, b, phase)
        return img


# ---------------------------------------------------------------- 出力
def render_video(anim, grid, song, out, fps=FPS):
    seg = out + ".seg.wav"
    subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-y", "-i", song, "-ss", f"{grid.t0:.3f}",
                    "-t", f"{grid.dur:.3f}", "-ar", "48000", "-ac", "2", seg], check=True)
    n = int(round(grid.dur * fps))
    cmd = ["ffmpeg", "-hide_banner", "-v", "error", "-y",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-",
           "-i", seg, "-map", "0:v", "-map", "1:a",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(fps),
           "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-shortest", out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(n):
        frame = anim.render(i / fps)
        p.stdin.write(frame.tobytes())
        if i % 150 == 0:
            print(f"  frame {i}/{n}", flush=True)
    p.stdin.close()
    p.wait()
    os.remove(seg)
    print(f"OK: {out} ({n} frames, {grid.dur:.2f}s)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--song", required=True)
    ap.add_argument("--out", default="animatic.mp4")
    ap.add_argument("--stills", help="確認用: 相対秒をカンマ区切り")
    ap.add_argument("--out-dir", default="stills")
    ap.add_argument("--grid-json", help="拍解析結果のキャッシュ")
    args = ap.parse_args()

    if args.grid_json and os.path.exists(args.grid_json):
        gj = json.load(open(args.grid_json))
        bt, iA = np.array(gj["bt"]), gj["iA"]
    else:
        bt, iA, tempo = analyze_grid(args.song)
        if args.grid_json:
            json.dump({"bt": bt.tolist(), "iA": int(iA), "tempo": tempo}, open(args.grid_json, "w"))
    grid = Grid(bt, iA)
    print(f"cut: {grid.t0:.3f}s + {grid.dur:.2f}s  (break beat {iA})")
    anim = Animatic(grid)
    if args.stills:
        os.makedirs(args.out_dir, exist_ok=True)
        for s in args.stills.split(","):
            t = float(s)
            im = anim.render(t)
            b, ph = grid.at(t)
            im.save(os.path.join(args.out_dir, f"t{t:05.2f}_b{b:02d}.png"))
            print("still", t, "beat", b)
        return
    render_video(anim, grid, args.song, args.out)


if __name__ == "__main__":
    main()
