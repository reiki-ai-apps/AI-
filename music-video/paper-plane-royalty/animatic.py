#!/usr/bin/env python3
"""「PAPER PLANE ROYALTY」演出プラン「折って、飛ばす。」のアニマティック(プレビズ) v2。

v1 からの変更: 手を廃止(本番の実写に任せる)、俯瞰カメラにパースと被写界深度、机・紙の質感、
折り目の影、蛍光灯の光と埃、街の空気遠近法と雲、色が一点から広がるサビ、ブルーム/粒子/色調の後処理、
英語歌詞すべてに日本語訳の字幕ブロック。Suno 自動生成ジャケットは使わない。

使い方:
  python3 animatic.py --song PAPER_PLANE_ROYALTY.mp3 --out animatic.mp4
  python3 animatic.py --song ... --stills 0.2,3.5,8.5 --out-dir stills/
"""
import argparse
import json
import math
import os
import random
import subprocess

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont

W, H = 1080, 1920
FPS = 30
FONT = "/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf"

# 俯瞰シーンはこの大きさの平面キャンバスに描いてからカメラのパースで W×H に落とす
FW, FH = 1600, 2100
FCX, FCY = 800, 1060

# ---- パレット ----
GRAY_DESK = (110, 114, 122)
WOOD = (194, 166, 130)
PAPER = (247, 245, 239)
PAPER_BACK = (240, 237, 230)
INK = (58, 60, 66)
FORM = (156, 158, 162)
PINK = (255, 79, 163)
PINK_INK = (228, 58, 148)
WHITE = (255, 255, 255)
SKY_BLUE_TOP = (98, 168, 246)
SKY_BLUE_BOT = (196, 228, 255)
SKY_GRAY_TOP = (168, 171, 176)
SKY_GRAY_BOT = (206, 208, 211)

PAPER_W, PAPER_H = 620, 880


# ---------------------------------------------------------------- 幾何
def A_translate(tx, ty):
    return np.array([[1, 0, tx], [0, 1, ty], [0, 0, 1]], float)


def A_rotate(theta):
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], float)


def A_scale(k):
    return np.array([[k, 0, 0], [0, k, 0], [0, 0, 1]], float)


def A_fold(P, u, s):
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


def ease_out(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_color(c1, c2, t):
    return tuple(int(round(lerp(a, b, t))) for a, b in zip(c1, c2))


def centroid(poly):
    return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))


def find_coeffs(target, source):
    """PIL の PERSPECTIVE 係数(出力→入力)。target: 出力四隅、source: 入力四隅。"""
    m = []
    for (x, y), (u, v) in zip(target, source):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    A = np.array(m, float)
    B = np.array(source, float).reshape(8)
    return tuple(np.linalg.solve(A, B))


# ---------------------------------------------------------------- 紙(折り)
class Paper:
    def __init__(self):
        w, h = PAPER_W, PAPER_H
        self.facets = [dict(poly=[(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)],
                            M=np.eye(3), side=0, layer=0, moving=False)]
        self.states = []
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
    if f.get("moving") and a < 1.0:
        P, u = fold
        return A_fold(P, u, math.cos(math.pi * a)) @ f["M_old"]
    return f["M"]


def build_paper():
    w, h = PAPER_W, PAPER_H
    p = Paper()
    T = (0, -h / 2)
    r2 = math.sqrt(0.5)
    a22 = math.radians(22.5)
    p.fold(T, (-r2, r2), (-w / 2, -h / 2))
    p.fold(T, (r2, r2), (w / 2, -h / 2))
    p.fold(T, (-math.sin(a22), math.cos(a22)), (-w * 0.48, -h * 0.1))
    p.fold(T, (math.sin(a22), math.cos(a22)), (w * 0.48, -h * 0.1))
    p.fold((0, 0), (0, 1), (-w * 0.3, 0))
    return p


# ---------------------------------------------------------------- テクスチャ/ユーティリティ
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


def noise_layer(w, h, seed, amount, blur=0.0):
    rng = np.random.default_rng(seed)
    n = rng.normal(0, 1, (h, w)) * amount
    im = Image.fromarray(np.clip(n + 128, 0, 255).astype(np.uint8))
    if blur:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    return np.array(im).astype(np.int16) - 128


def paper_fiber(w, h, seed):
    fine = noise_layer(w, h, seed, 5.0)
    streak = noise_layer(w, h, seed + 1, 9.0, blur=0.0)
    streak = np.array(Image.fromarray((streak + 128).astype(np.uint8)).filter(ImageFilter.BoxBlur((9, 0)))).astype(np.int16) - 128
    return fine + streak // 2


def apply_fiber(img_rgb, fiber):
    arr = np.array(img_rgb).astype(np.int16)
    arr += fiber[:, :, None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def make_front_texture():
    w, h = PAPER_W, PAPER_H
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    d.text((w / 2, 96), "始 末 書", font=font(46), fill=INK, anchor="mm")
    d.line([(w / 2 - 90, 128), (w / 2 + 90, 128)], fill=INK, width=1)
    d.text((w - 44, 156), "2026年9月10日", font=font(18), fill=INK, anchor="rm")
    d.text((44, 196), "営業部長　殿", font=font(20), fill=INK, anchor="lm")
    d.text((w - 44, 238), "営業部　　　　　　　　　㊞", font=font(19), fill=INK, anchor="rm")
    body = ("この度は、私の不注意により取引先への納期報告を誤り、関係各位に多大なるご迷惑を"
            "おかけしましたことを深くお詫び申し上げます。今後はこのようなことのないよう、"
            "確認を徹底し、業務に精励いたします。")
    y = 296
    for line in wrap_chars(d, body, font(21), w - 88):
        d.text((44, y), line, font=font(21), fill=INK, anchor="lm")
        y += 36
    d.text((44, 500), "再発防止策", font=font(19), fill=INK, anchor="lm")
    for k in range(6):
        yy = 526 + k * 48
        d.line([(44, yy), (w - 44, yy)], fill=FORM, width=1)
    d.rectangle([w - 150, h - 150, w - 60, h - 60], outline=(128, 130, 136), width=2)
    d.text((w - 105, h - 105), "印", font=font(28), fill=(128, 130, 136), anchor="mm")
    im = apply_fiber(im, paper_fiber(w, h, 21))
    return im


def handwriting(text, size, color, tilt_seed=1, stroke=0):
    rng = random.Random(tilt_seed)
    f = font(size)
    tmp = ImageDraw.Draw(Image.new("L", (1, 1)))
    widths = [tmp.textlength(ch, font=f) for ch in text]
    total = int(sum(widths) + size * 0.08 * len(text)) + size
    layer = Image.new("RGBA", (total, int(size * 1.9)), (0, 0, 0, 0))
    x = size * 0.4
    for ch, cw in zip(text, widths):
        g = Image.new("RGBA", (int(size * 1.6), int(size * 1.6)), (0, 0, 0, 0))
        ImageDraw.Draw(g).text((size * 0.8, size * 0.8), ch, font=f, fill=color, anchor="mm",
                               stroke_width=stroke, stroke_fill=color)
        g = g.rotate(rng.uniform(-7, 7), resample=Image.BICUBIC)
        layer.alpha_composite(g, (int(x - size * 0.8 + cw / 2), int(size * 0.15 + rng.uniform(-3, 3))))
        x += cw + size * 0.08
    return layer


LYRICS_ON_PAPER = ["to the ceiling", "Catch it,", "kiss it", "into feeling", "no gravity"]  # 折る瞬間に歌っている行


def make_back_textures(paper):
    w, h = PAPER_W, PAPER_H
    base = Image.new("RGB", (w, h), PAPER_BACK)
    base = apply_fiber(base, paper_fiber(w, h, 33)).convert("RGBA")
    textures = [base.copy()]
    tex = base.copy()
    Lw = 1600
    for k, state in enumerate(paper.states):
        moving = [f for f in state if f.get("moving")]
        polys_plane = [apply(f["M"], f["poly"]) for f in moving]
        big = max(polys_plane, key=lambda p: abs(sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1]
                                                     for i in range(len(p)))))
        cx, cy = centroid(big)
        r_in = min(abs((q[0] - p[0]) * (cy - p[1]) - (q[1] - p[1]) * (cx - p[0])) / math.hypot(q[0] - p[0], q[1] - p[1])
                   for p, q in zip(big, big[1:] + big[:1]))
        size = 36
        tmp = ImageDraw.Draw(Image.new("L", (1, 1)))
        while size > 22 and tmp.textlength(LYRICS_ON_PAPER[k], font=font(size)) > 1.7 * r_in:
            size -= 2
        text_layer = handwriting(LYRICS_ON_PAPER[k], size, PINK_INK + (235,), tilt_seed=k + 3, stroke=1)
        L = Image.new("RGBA", (Lw, Lw), (0, 0, 0, 0))
        L.alpha_composite(text_layer, (int(Lw / 2 + cx - text_layer.width / 2),
                                       int(Lw / 2 + cy - text_layer.height / 2)))
        for f in moving:
            C = A_translate(Lw / 2, Lw / 2) @ f["M"] @ A_translate(-w / 2, -h / 2)
            warped = L.transform((w, h), Image.AFFINE,
                                 (C[0, 0], C[0, 1], C[0, 2], C[1, 0], C[1, 1], C[1, 2]), resample=Image.BILINEAR)
            mask = Image.new("L", (w, h), 0)
            ImageDraw.Draw(mask).polygon([(x + w / 2, y + h / 2) for x, y in f["poly"]], fill=255)
            warped.putalpha(Image.fromarray(np.minimum(np.array(warped.getchannel("A")), np.array(mask))))
            tex.alpha_composite(warped)
        textures.append(tex.copy())
    return textures


# ---------------------------------------------------------------- 紙の描画(平面キャンバス上)
def draw_paper(flat, paper, k, a, S, front, backs):
    """flat(RGB, FW×FH) に紙を描く。k=完了した折り数、a=折り k の進行、S=紙平面→flat 変換。"""
    if k == 0:
        facets = [dict(poly=[(-PAPER_W / 2, -PAPER_H / 2), (PAPER_W / 2, -PAPER_H / 2),
                             (PAPER_W / 2, PAPER_H / 2), (-PAPER_W / 2, PAPER_H / 2)],
                       M=np.eye(3), side=0, layer=0, moving=False)]
        fold, back = None, backs[0]
    else:
        facets, fold, back = paper.states[k - 1], paper.folds[k - 1], backs[k]
    s_val = math.cos(math.pi * a) if fold else 1.0
    lift = math.sin(math.pi * a) if (fold and a < 1.0) else 0.0
    items = []
    for f in facets:
        Md = facet_draw_matrix(f, fold, a) if fold else f["M"]
        Mfull = S @ Md
        items.append((f, Mfull, apply(Mfull, f["poly"])))

    # 影: 落ち影(柔らかい) + 接地影(硬い) + 折り上げ中の面の影
    q = 4
    soft = Image.new("L", (FW // q, FH // q), 0)
    hard = Image.new("L", (FW // q, FH // q), 0)
    sd, hd = ImageDraw.Draw(soft), ImageDraw.Draw(hard)
    for f, Mfull, poly in items:
        if f.get("moving") and lift > 0:
            ox, oy = 14 + 30 * lift, 20 + 44 * lift
            sd.polygon([((x + ox) / q, (y + oy) / q) for x, y in poly], fill=int(70 + 60 * lift))
        else:
            sd.polygon([((x + 14) / q, (y + 20) / q) for x, y in poly], fill=80)
            hd.polygon([((x + 3) / q, (y + 5) / q) for x, y in poly], fill=70)
    soft = soft.filter(ImageFilter.GaussianBlur(5)).resize((FW, FH), Image.BILINEAR)
    hard = hard.filter(ImageFilter.GaussianBlur(1.2)).resize((FW, FH), Image.BILINEAR)
    black = Image.new("RGB", (FW, FH), (20, 22, 30))
    flat.paste(black, (0, 0), soft)
    flat.paste(black, (0, 0), hard)

    # 面
    for f, Mfull, poly in sorted(items, key=lambda it: (it[0]["layer"], it[0].get("moving", False))):
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        bx, by = int(max(0, min(xs)) - 2), int(max(0, min(ys)) - 2)
        ex, ey = int(min(FW, max(xs)) + 2), int(min(FH, max(ys)) + 2)
        bw, bh = ex - bx, ey - by
        if bw <= 1 or bh <= 1:
            continue
        inv = np.linalg.inv(Mfull)
        C = A_translate(PAPER_W / 2, PAPER_H / 2) @ inv @ A_translate(bx, by)
        side = f["side"]
        if f.get("moving") and fold and a < 1.0 and s_val > 0:
            side = 1 - side
        tex = front if side == 0 else back
        tile = tex.convert("RGB").transform((bw, bh), Image.AFFINE,
                                            (C[0, 0], C[0, 1], C[0, 2], C[1, 0], C[1, 1], C[1, 2]),
                                            resample=Image.BILINEAR)
        if f.get("moving") and fold and a < 1.0:
            tile = ImageEnhance.Brightness(tile).enhance(0.66 + 0.34 * abs(s_val))
        elif f["layer"] > 0:
            tile = ImageEnhance.Brightness(tile).enhance(1.0 - 0.012 * f["layer"])
        mask = Image.new("L", (bw, bh), 0)
        ImageDraw.Draw(mask).polygon([(x - bx, y - by) for x, y in poly], fill=255)
        flat.paste(tile, (bx, by), mask)
    # 折り目/縁の線(細く、少しだけ暗く)
    edge = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    ed = ImageDraw.Draw(edge)
    for f, Mfull, poly in items:
        ed.polygon(poly, outline=(40, 40, 48, 70))
        ed.line(poly + [poly[0]], fill=(255, 255, 255, 60), width=1)
    flat.alpha_composite(edge) if flat.mode == "RGBA" else flat.paste(edge, (0, 0), edge)


# ---------------------------------------------------------------- 背景セット
_cache = {}


def desk_flat(colored=False):
    key = ("desk", colored)
    if key in _cache:
        return _cache[key].copy()
    base = np.full((FH, FW, 3), WOOD if colored else GRAY_DESK, float)
    ys, xs = np.mgrid[0:FH, 0:FW]
    # 照明: 左上からのキーライト + 紙の少し上の柔らかい光だまり
    key_light = 1.16 - 0.34 * (xs / FW * 0.55 + ys / FH * 0.75)
    pool = 1.0 + 0.16 * np.exp(-(((xs - FCX) ** 2) / (2 * 700 ** 2) + ((ys - FCY + 200) ** 2) / (2 * 900 ** 2)))
    L = key_light * pool
    if colored:
        grain = 0.5 + 0.5 * np.sin(ys * 0.11 + 6.0 * np.sin(xs * 0.0031) + 2.0 * np.sin(ys * 0.013))
        base -= (grain * 9.0)[:, :, None]
    mott = noise_layer(FW // 20, FH // 20, 5, 40.0, blur=1.5)
    mott = np.array(Image.fromarray((mott + 128).astype(np.uint8)).resize((FW, FH), Image.BILINEAR)).astype(float) - 128
    fine = noise_layer(FW, FH, 6, 4.0)
    arr = base * L[:, :, None] + (mott * 0.18)[:, :, None] + fine[:, :, None]
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im, "RGBA")
    # 小道具: コーヒーの輪染み(左下)、蛍光ペン(右上) — 灰色の世界で唯一の色
    ring = (70, 62, 56, 34) if not colored else (110, 80, 50, 46)
    d.ellipse([300, 1700, 560, 1960], outline=ring, width=9)
    d.ellipse([310, 1710, 550, 1950], outline=(255, 255, 255, 18), width=3)
    pen_layer = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    pd = ImageDraw.Draw(pen_layer)
    px, py, ang = 1180, 300, math.radians(28)
    c, s = math.cos(ang), math.sin(ang)

    def tr(x, y):
        return (px + x * c - y * s, py + x * s + y * c)

    body = [tr(-190, -24), tr(120, -24), tr(120, 24), tr(-190, 24)]
    pd.polygon([(x + 12, y + 18) for x, y in body], fill=(0, 0, 0, 70))
    pen_layer = pen_layer.filter(ImageFilter.GaussianBlur(6))
    pd = ImageDraw.Draw(pen_layer)
    pd.polygon(body, fill=PINK + (255,))
    pd.polygon([tr(-190, -24), tr(-150, -24), tr(-150, 24), tr(-190, 24)], fill=(214, 46, 128, 255))
    pd.polygon([tr(120, -24), tr(190, -12), tr(190, 12), tr(120, 24)], fill=(214, 46, 128, 255))
    pd.polygon([tr(-120, -20), tr(80, -20), tr(80, -12), tr(-120, -12)], fill=(255, 190, 220, 160))
    pd.polygon([tr(-40, -6), tr(60, -6), tr(60, 8), tr(-40, 8)], fill=(255, 255, 255, 190))
    im.paste(pen_layer, (0, 0), pen_layer)
    _cache[key] = im
    return im.copy()


def desk_camera(flat, t, push=0.0, bump=0.0, drift=1.0):
    """平面キャンバス → 俯瞰カメラ(パース + 微妙な手持ちの揺れ + 押し寄せ)。"""
    dx = drift * (5 * math.sin(t * 0.7) + 3 * math.sin(t * 1.9 + 1.3))
    dy = drift * (4 * math.sin(t * 0.9 + 0.4)) + bump
    k = 1.0 - 0.05 * push
    top_w, bot_w = 1440 * k, 990 * k
    top_y, bot_y = FCY - 900 * k, FCY + 940 * k
    src = [(FCX - top_w / 2 + dx, top_y + dy), (FCX + top_w / 2 + dx, top_y + dy),
           (FCX + bot_w / 2 + dx, bot_y + dy), (FCX - bot_w / 2 + dx, bot_y + dy)]
    coeffs = find_coeffs([(0, 0), (W, 0), (W, H), (0, H)], src)
    img = flat.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BILINEAR)
    # 被写界深度(上下をぼかす)
    blurred = img.filter(ImageFilter.GaussianBlur(6))
    img = Image.composite(blurred, img, tilt_mask())
    img = ImageChops.screen(img, light_streak())
    return img


def tilt_mask():
    if "tilt" not in _cache:
        ys = np.arange(H) / H
        a = np.clip((0.30 - ys) / 0.30, 0, 1) ** 1.4 + np.clip((ys - 0.86) / 0.14, 0, 1) ** 1.4
        m = np.tile((a * 255).astype(np.uint8)[:, None], (1, W))
        _cache["tilt"] = Image.fromarray(m)
    return _cache["tilt"]


def light_streak():
    if "streak" not in _cache:
        ys, xs = np.mgrid[0:H, 0:W]
        d = (xs * 0.62 + ys * 0.78 - 1250) / 260.0
        a = np.exp(-d * d) * 22
        im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert("RGB")
        _cache["streak"] = im
    return _cache["streak"]


def vignette(strength):
    key = ("vig", strength)
    if key not in _cache:
        ys, xs = np.mgrid[0:H // 4, 0:W // 4]
        nx = xs / (W / 8) - 1.0
        ny = ys / (H / 8) - 1.0
        d = np.sqrt(nx * nx + ny * ny) / math.sqrt(2)
        a = np.clip((d - 0.42) / 0.58, 0, 1) ** 1.6 * strength
        _cache[key] = Image.fromarray(a.astype(np.uint8)).resize((W, H), Image.BILINEAR)
    return _cache[key]


def apply_vignette(img, strength=90):
    img.paste(Image.new("RGB", (W, H), (8, 10, 16)), (0, 0), vignette(strength))
    return img


def grain_bank():
    if "grain" not in _cache:
        _cache["grain"] = [noise_layer(W + 200, H + 200, 100 + i, 7.0) for i in range(3)]
    return _cache["grain"]


def apply_grain(img, frame_seed, amount=1.0):
    rng = random.Random(frame_seed)
    g = grain_bank()[rng.randrange(3)]
    ox, oy = rng.randrange(200), rng.randrange(200)
    arr = np.array(img).astype(np.int16)
    arr += (g[oy:oy + H, ox:ox + W] * amount).astype(np.int16)[:, :, None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def grade(img, mode="gray"):
    key = ("lut", mode)
    if key not in _cache:
        x = np.arange(256) / 255.0
        s_curve = np.clip(0.5 + 1.08 * (x - 0.5) + 0.06 * np.sin(2 * math.pi * x), 0, 1)
        if mode == "gray":
            r = np.clip(s_curve * 0.975 + 0.008, 0, 1)
            g = np.clip(s_curve * 0.99 + 0.006, 0, 1)
            b = np.clip(s_curve * 1.03 + 0.02, 0, 1)
        else:
            r = np.clip(s_curve * 1.03 + 0.01, 0, 1)
            g = np.clip(s_curve * 1.0 + 0.008, 0, 1)
            b = np.clip(s_curve * 0.97 + 0.012, 0, 1)
        _cache[key] = [int(v * 255) for v in r] + [int(v * 255) for v in g] + [int(v * 255) for v in b]
    return img.point(_cache[key])


def bloom(img, threshold=200, strength=0.55, radius=14):
    arr = np.array(img).astype(np.int16)
    bright = np.clip((arr - threshold) * 4, 0, 255).astype(np.uint8)
    b = Image.fromarray(bright).resize((W // 4, H // 4), Image.BILINEAR).filter(ImageFilter.GaussianBlur(radius / 2))
    b = b.resize((W, H), Image.BILINEAR)
    b = ImageEnhance.Brightness(b).enhance(strength)
    return ImageChops.screen(img, b)


def sky(colored, t=0.0):
    key = ("sky", colored)
    if key not in _cache:
        top, bot = (SKY_BLUE_TOP, SKY_BLUE_BOT) if colored else (SKY_GRAY_TOP, SKY_GRAY_BOT)
        ys = np.arange(H) / H
        arr = np.zeros((H, W, 3), np.uint8)
        for c in range(3):
            arr[:, :, c] = np.tile((top[c] + (bot[c] - top[c]) * ys ** 0.9).astype(np.uint8)[:, None], (1, W))
        _cache[key] = Image.fromarray(arr)
    im = _cache[key].copy()
    cl = clouds()
    ox = int((t * 14) % cl.width)
    band = Image.new("L", (W, H), 0)
    strip = cl.crop((ox, 0, ox + W, cl.height)) if ox + W <= cl.width else \
        ImageChops.add(cl.crop((ox, 0, cl.width, cl.height)), Image.new("L", (W, cl.height), 0))
    if strip.width < W:
        strip2 = Image.new("L", (W, cl.height), 0)
        strip2.paste(strip, (0, 0))
        strip2.paste(cl.crop((0, 0, W - strip.width, cl.height)), (strip.width, 0))
        strip = strip2
    band.paste(strip, (0, 60))
    tint = (255, 255, 255) if colored else (222, 224, 227)
    im.paste(Image.new("RGB", (W, H), tint), (0, 0), band)
    return im


def clouds():
    if "clouds" not in _cache:
        n = noise_layer(2400 // 12, 900 // 12, 77, 60.0, blur=1.2)
        im = Image.fromarray((n + 128).astype(np.uint8)).resize((2400, 900), Image.BICUBIC).filter(ImageFilter.GaussianBlur(18))
        a = np.array(im).astype(float)
        a = np.clip((a - 138) * 3.2, 0, 255)
        ys = np.arange(900) / 900
        fade = np.clip(1.2 - ys * 1.6, 0, 1) * np.clip(ys * 8, 0, 1)
        a = a * fade[:, None] * 0.55
        _cache["clouds"] = Image.fromarray(a.astype(np.uint8))
    return _cache["clouds"]


def make_buildings(seed=11, span=3400):
    rng = random.Random(seed)
    layers = []
    specs = [(180, 420, 3), (300, 640, 2), (460, 900, 1)]
    for hmin, hmax, _ in specs:
        x = -500
        bl = []
        while x < span:
            w = rng.randint(70, 190)
            h = rng.randint(hmin, hmax)
            tone = rng.randint(96, 132)
            hue = rng.choice([(255, 190, 210), (186, 224, 255), (255, 236, 176), (200, 248, 222), (224, 204, 255), (255, 214, 190)])
            wins = [(wx, wy) for wx in range(12, w - 14, 20) for wy in range(16, h - 14, 26) if rng.random() < 0.5]
            roof = rng.random() < 0.35
            bl.append(dict(x=x, w=w, h=h, tone=tone, hue=hue, wins=wins, roof=roof))
            x += w + rng.randint(4, 30)
        layers.append(bl)
    return layers


BUILDINGS = make_buildings()


def draw_city(img, offset=0.0, colored=0.0, horizon=1180, zoom=1.0, sky_col=None):
    d = ImageDraw.Draw(img, "RGBA")
    sky_ref = sky_col or ((120, 186, 250) if colored > 0.5 else (196, 199, 203))
    depth_par = [0.30, 0.6, 1.0]
    depth_mix = [0.62, 0.34, 0.06]
    for li, bl in enumerate(BUILDINGS):
        par, mix = depth_par[li], depth_mix[li]
        hscale = [0.75, 0.9, 1.0][li]
        for b in bl:
            x0 = (b["x"] - offset * par) * zoom
            w = b["w"] * zoom
            if x0 + w < -10 or x0 > W + 10:
                continue
            h = b["h"] * zoom * hscale
            gray = (b["tone"] + 18 * li,) * 3
            col = lerp_color(gray, b["hue"], colored) if colored > 0 else gray
            col = lerp_color(col, sky_ref, mix)
            top = lerp_color(col, (255, 255, 255), 0.10)
            d.rectangle([x0, horizon - h, x0 + w, horizon + 500], fill=col)
            d.rectangle([x0, horizon - h, x0 + w, horizon - h + 6], fill=top)
            d.line([(x0, horizon - h), (x0, horizon + 500)], fill=lerp_color(col, (255, 255, 255), 0.18), width=2)
            if b["roof"]:
                d.line([(x0 + w * 0.5, horizon - h), (x0 + w * 0.5, horizon - h - 40 * zoom)], fill=col, width=3)
            if li >= 1:
                wcol = lerp_color(lerp_color((b["tone"] + 60,) * 3, sky_ref, mix), (255, 246, 214), colored)
                for wx, wy in b["wins"]:
                    if wy * zoom < h - 12:
                        d.rectangle([x0 + wx * zoom, horizon - h + wy * zoom,
                                     x0 + (wx + 6) * zoom, horizon - h + (wy + 8) * zoom], fill=wcol + (210,))
    # 地面と地平の霞
    ground = lerp_color((124, 126, 130), (152, 186, 152), colored)
    d.rectangle([0, horizon + 40, W, H], fill=ground)
    haze = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(haze)
    for i in range(80):
        y = horizon - 280 + i * 4
        hd.line([(0, y), (W, y)], fill=sky_ref + (int(90 * (i / 80) ** 2),))
    img.paste(haze, (0, 0), haze)


def window_frame(img):
    d = ImageDraw.Draw(img, "RGBA")
    fr, fr2 = (44, 46, 52), (66, 68, 74)
    bars = [(0, 0, W, 64), (0, H - 372, W, H), (0, 0, 54, H), (W - 54, 0, W, H), (W / 2 - 16, 0, W / 2 + 16, H), (0, 630, W, 660)]
    for b in bars:
        d.rectangle(b, fill=fr)
    for b in bars:
        d.rectangle([b[0] + 3, b[1] + 3, b[2] - 3, b[3] - 3], fill=fr2)
    d.rectangle([54, H - 400, W - 54, H - 372], fill=(96, 98, 104))
    # ガラスの内側の影と反射
    inner = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    idr = ImageDraw.Draw(inner)
    for i in range(26):
        a = int(70 * (1 - i / 26) ** 2)
        idr.rectangle([54 + i, 64 + i, W - 54 - i, H - 372 - i], outline=(0, 0, 0, a))
    img.paste(inner, (0, 0), inner)
    refl = Image.new("L", (W, H), 0)
    rd = ImageDraw.Draw(refl)
    rd.polygon([(120, 64), (520, 64), (W - 60, 1100), (W - 60, 1500)], fill=22)
    refl = refl.filter(ImageFilter.GaussianBlur(40))
    img.paste(Image.new("RGB", (W, H), (255, 255, 255)), (0, 0), refl)


# ---------------------------------------------------------------- 飛行機
def plane_side(img, pos, angle=0.0, scale=1.0, glow=0.0, shadow=True, wing_text=None):
    c, s = math.cos(angle), math.sin(angle)

    def tr(x, y):
        x, y = x * scale, y * scale
        return (pos[0] + x * c - y * s, pos[1] + x * s + y * c)

    body = [tr(170, 0), tr(-170, -20), tr(-150, 6), tr(-170, 30)]
    wing = [tr(90, -8), tr(-170, -70), tr(-160, -22)]
    keel = [tr(40, 4), tr(-150, 6), tr(-170, 30)]
    if shadow:
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sdr = ImageDraw.Draw(sh)
        for poly in (body, wing, keel):
            sdr.polygon([(x + 34 * scale, y + 46 * scale) for x, y in poly], fill=(0, 0, 0, 60))
        sh = sh.filter(ImageFilter.GaussianBlur(10 * scale))
        img.paste(sh, (0, 0), sh)
    if glow > 0:
        g = glow_sprite(int(max(10, 110 * scale * (0.4 + glow))), PINK)
        g = g.copy()
        g.putalpha(Image.fromarray((np.array(g.getchannel("A")) * min(1.0, glow)).astype(np.uint8)))
        nose = tr(170, 0)
        img.paste(g, (int(nose[0] - g.width / 2), int(nose[1] - g.height / 2)), g)
    d = ImageDraw.Draw(img)
    d.polygon(keel, fill=(206, 204, 198))
    d.polygon(body, fill=(242, 240, 234))
    d.polygon(wing, fill=(228, 226, 220))
    d.line([tr(170, 0), tr(-170, -20)], fill=(255, 255, 255), width=max(1, int(2 * scale)))
    d.line([tr(90, -8), tr(-170, -70)], fill=(214, 212, 206), width=1)
    if glow > 0:
        nose = tr(170, 0)
        rr = 6 * scale
        d.ellipse([nose[0] - rr, nose[1] - rr, nose[0] + rr, nose[1] + rr], fill=PINK)
    if wing_text:
        tl = handwriting(wing_text, int(24 * scale), PINK_INK + (230,), tilt_seed=9, stroke=1).rotate(
            -math.degrees(angle) + 14, resample=Image.BICUBIC, expand=True)
        cx, cy = tr(-60, -34)
        img.paste(tl, (int(cx - tl.width / 2), int(cy - tl.height / 2)), tl)


def plane_top_small(d, pos, angle, size, colored=True):
    c, s = math.cos(angle), math.sin(angle)

    def tr(x, y):
        return (pos[0] + (x * c - y * s) * size, pos[1] + (x * s + y * c) * size)

    d.polygon([tr(1.0, 0), tr(-0.8, -0.55), tr(-0.5, 0)], fill=(236, 234, 228))
    d.polygon([tr(1.0, 0), tr(-0.5, 0), tr(-0.8, 0.55)], fill=(214, 212, 206))
    if colored:
        n = tr(1.0, 0)
        d.ellipse([n[0] - size * 0.12, n[1] - size * 0.12, n[0] + size * 0.12, n[1] + size * 0.12], fill=PINK)


def glow_sprite(radius, color):
    key = ("glow", radius, color)
    if key not in _cache:
        sz = radius * 4
        g = Image.new("RGBA", (sz, sz), color + (0,))
        d = ImageDraw.Draw(g)
        for i in range(7):
            r = radius * (1.0 - i * 0.13)
            d.ellipse([sz / 2 - r, sz / 2 - r, sz / 2 + r, sz / 2 + r], fill=color + (int(20 + i * 24),))
        _cache[key] = g.filter(ImageFilter.GaussianBlur(radius * 0.5))
    return _cache[key]


# ---------------------------------------------------------------- 文字
def tracked_text(text, size, fill, tracking=2, stroke=0, stroke_fill=None):
    f = font(size)
    tmp = ImageDraw.Draw(Image.new("L", (1, 1)))
    widths = [tmp.textlength(ch, font=f) for ch in text]
    total = int(sum(widths) + tracking * (len(text) - 1)) + size + 2 * stroke
    layer = Image.new("RGBA", (total, int(size * 1.5) + 2 * stroke), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x = size * 0.5 + stroke
    for ch, cw in zip(text, widths):
        d.text((x, layer.height / 2), ch, font=f, fill=fill, anchor="lm", stroke_width=stroke, stroke_fill=stroke_fill or fill)
        x += cw + tracking
    return layer


def caption_hook(text):
    key = ("hook", text)
    if key not in _cache:
        black = tracked_text(text, 58, (0, 0, 0, 255), tracking=1, stroke=9)
        white = tracked_text(text, 58, (255, 255, 255, 255), tracking=1, stroke=2)
        layer = Image.new("RGBA", black.size, (0, 0, 0, 0))
        layer.alpha_composite(black)
        layer.alpha_composite(white)
        _cache[key] = layer
    return _cache[key]


def lyric_block(en, jp):
    """英語(大)＋日本語訳(小)の字幕ブロック。英語が無ければ日本語だけ大きく。"""
    key = ("lyric", en, jp)
    if key in _cache:
        return _cache[key]
    parts = []
    if en:
        parts.append(tracked_text(en, 66, (255, 255, 255, 255), tracking=2, stroke=1))
        if jp:
            parts.append(tracked_text(jp, 38, (255, 255, 255, 216), tracking=3))
    else:
        parts.append(tracked_text(jp, 68, (255, 255, 255, 255), tracking=5, stroke=1))
    gap = 14
    hgt = sum(p.height for p in parts) + gap * (len(parts) - 1) + (26 if en and jp else 0) + 40
    wid = max(p.width for p in parts) + 40
    layer = Image.new("RGBA", (wid, hgt), (0, 0, 0, 0))
    y = 20
    for i, p in enumerate(parts):
        layer.alpha_composite(p, (int((wid - p.width) / 2), y))
        y += p.height + gap
        if en and jp and i == 0:
            ImageDraw.Draw(layer).rectangle([wid / 2 - 22, y - 2, wid / 2 + 22, y + 1], fill=PINK + (230,))
            y += 22
    shadow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    alpha = layer.getchannel("A")
    shadow.paste(Image.new("RGBA", layer.size, (0, 0, 0, 190)), (2, 6), alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(7))
    shadow.alpha_composite(layer)
    _cache[key] = shadow
    return shadow


def paste_center(img, layer, cx, cy, alpha=1.0, scale=1.0):
    if alpha <= 0:
        return
    if scale != 1.0:
        layer = layer.resize((max(1, int(layer.width * scale)), max(1, int(layer.height * scale))), Image.BILINEAR)
    if alpha < 1.0:
        layer = layer.copy()
        layer.putalpha(Image.fromarray((np.array(layer.getchannel("A")) * alpha).astype(np.uint8)))
    img.paste(layer, (int(cx - layer.width / 2), int(cy - layer.height / 2)), layer)


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
    return bt, best[1], float(np.atleast_1d(tempo)[0])


class Grid:
    def __init__(self, bt, iA):
        self.bt = bt
        self.iA = iA
        self.iEnd = iA + 92
        self.t0 = float(bt[iA])
        self.dur = float(bt[self.iEnd] - bt[iA])

    def at(self, t_rel):
        T = self.t0 + t_rel
        k = int(np.searchsorted(self.bt, T, side="right") - 1)
        k = max(0, min(len(self.bt) - 2, k))
        phase = (T - self.bt[k]) / (self.bt[k + 1] - self.bt[k])
        return k - self.iA, float(max(0.0, min(1.0, phase)))

    def bt_rel(self, b):
        return float(self.bt[self.iA + b] - self.t0)


# ---------------------------------------------------------------- 歌詞と訳
CHANT = [("Fold it, flip it", "折って、裏返して"), ("Send it to the ceiling", "天井まで飛ばして"),
         ("Catch it, kiss it", "つかまえて、キスして"), ("Turn it into feeling", "気持ちに変えて"),
         ("Up, up, no gravity", "上へ、上へ、重力なんてない"), ("Small wings, big fantasy", "小さな羽、大きな夢"),
         ("Fold it, flip it", "折って、裏返して"), ("Paper plane royalty", "紙飛行機の女王")]
BRIDGE = ["正解ばかり探してたら", "笑い方まで固くなる", "少し曲がった線でいい", "その方が遠くへ飛べる"]
CHORUS = [("I'm paper plane royalty", "私は紙飛行機の女王"), ("Flying over every worry", "悩みなんて全部飛び越えて"),
          ("I turn the ordinary", "ありふれた毎日を"), ("Into something bright and blurry", "まぶしくて、にじむ何かに変える"),
          ("I don't need a golden crown", "金の冠はいらない"), ("I don't need a perfect sign", "完璧な合図もいらない"),
          ("I'm paper plane royalty", "私は紙飛行機の女王"), ("Flying over every worry", "悩みなんて全部飛び越えて")]
HOOK = "始末書、紙飛行機にしてみた。"


# ---------------------------------------------------------------- 本体
class Animatic:
    def __init__(self, grid):
        self.g = grid
        self.paper = build_paper()
        self.front = make_front_texture()
        self.backs = make_back_textures(self.paper)
        self.fold_starts = [grid.bt_rel(4 + 2 * k) for k in range(5)]
        self.fold_dur = 0.36

    # ---- 共通
    def paper_state(self, t):
        k, a = 0, 1.0
        for i, st in enumerate(self.fold_starts):
            if t >= st:
                k = i + 1
                a = min(1.0, (t - st) / self.fold_dur)
        return k, (ease(a) if a < 1.0 else 1.0)

    def S_flat(self, theta_deg=-5, scale=1.0, center=(FCX, FCY)):
        return A_translate(*center) @ A_rotate(math.radians(theta_deg)) @ A_scale(scale)

    def fade_alpha(self, t, t_in, t_out, fi=0.3, fo=0.25):
        return max(0.0, min(1.0, (t - t_in) / fi, (t_out - t) / fo))

    def subtitles(self, img, t, b):
        """英語＋訳 / 日本語の字幕ブロック(画面下の安全域)。"""
        if b < 24:
            i = b // 3  # チャント8行を24拍に等分(3拍ずつ)
            if i < len(CHANT):
                en, jp = CHANT[i]
                a = self.fade_alpha(t, self.g.bt_rel(3 * i), self.g.bt_rel(3 * i + 3), 0.25, 0.2)
                paste_center(img, lyric_block(en, jp), W / 2, 1420, a)
        elif b < 56:
            i = (b - 24) // 8
            if i < 4:
                a = self.fade_alpha(t, self.g.bt_rel(24 + 8 * i), self.g.bt_rel(32 + 8 * i), 0.35, 0.3)
                paste_center(img, lyric_block(None, BRIDGE[i]), W / 2, 1420, a)
        elif b >= 60:
            bar = min(7, (b - 60) // 4)
            en, jp = CHORUS[bar]
            t_out = self.g.bt_rel(64 + 4 * bar) if bar < 7 else self.g.bt_rel(91)
            a = self.fade_alpha(t, self.g.bt_rel(60 + 4 * bar), t_out)
            paste_center(img, lyric_block(en, jp), W / 2, 1420, a)

    def hook(self, img, t):
        t_end = self.g.bt_rel(8)
        if t > t_end + 0.3:
            return
        a = 1.0 if t < t_end else 1.0 - (t - t_end) / 0.3
        pop = 1.0 + 0.10 * (1 - ease(min(1.0, (t - 0.1) / 0.16))) if t > 0.1 else 1.1
        if t < 0.1:
            a *= t / 0.1
        paste_center(img, caption_hook(HOOK), W / 2, 396, a, pop)

    def finish(self, img, t, mode="gray", vig=80, do_bloom=False, grain=1.0):
        if do_bloom:
            img = bloom(img)
        img = grade(img, mode)
        apply_vignette(img, vig)
        img = apply_grain(img, int(t * 1000), grain)
        return img

    # ---- 俯瞰シーン
    def desk_scene(self, t, b, phase, k, a, theta, scale, center, colored=0.0, push=0.0, bump=0.0, crown=None):
        if colored <= 0:
            flat = desk_flat(False)
        elif colored >= 1:
            flat = desk_flat(True)
        else:
            flat = Image.blend(desk_flat(False), desk_flat(True), colored)
        if crown is not None:
            self.draw_crown(flat, *crown)
        else:
            draw_paper(flat, self.paper, k, a, self.S_flat(theta, scale, center), self.front, self.backs)
        return desk_camera(flat, t, push=push, bump=bump)

    def scene_intro(self, t, b, phase):
        img = self.desk_scene(t, b, phase, 0, 1.0, -5, 1.0, (FCX, FCY), push=ease(t / 1.8) * 0.6)
        img = self.finish(img, t, "gray", 80)
        self.hook(img, t)
        self.subtitles(img, t, b)
        return img

    def scene_fold(self, t, b, phase):
        k, a = self.paper_state(t)
        theta, scale, center = -5.0, 1.0, (FCX, FCY)
        bump = 0.0
        if b in (4, 6, 8, 10, 12):
            bump = 9.0 * math.exp(-phase * 9.0)
        if b >= 13:
            u = ease((t - self.g.bt_rel(13)) / (self.g.bt_rel(16) - self.g.bt_rel(13)))
            theta = lerp(-5.0, -26.0, u)
            scale = lerp(1.0, 1.14, u)
            center = (FCX + 60 * u, FCY - 90 * u)
        img = self.desk_scene(t, b, phase, k, a, theta, scale, center, push=0.6 + 0.4 * ease((t - 1.8) / 5.2), bump=bump)
        img = self.finish(img, t, "gray", 80)
        self.hook(img, t)
        self.subtitles(img, t, b)
        return self.glitch(img, phase, b)

    def glitch(self, img, phase, b):
        if phase < 0.07:
            rng = random.Random(b)
            for _ in range(3):
                y = rng.randint(0, H - 40)
                hgt = rng.randint(6, 30)
                dx = rng.randint(-22, 22)
                band = img.crop((0, y, W, y + hgt))
                img.paste(band, (dx, y))
        return img

    # ---- 壁セット(横アングル)
    def wall(self, t, flicker):
        key = "wall"
        if key not in _cache:
            ys, xs = np.mgrid[0:H, 0:W]
            base = np.zeros((H, W, 3), float)
            for c, (a_, b_) in enumerate(zip((150, 153, 158), (104, 107, 112))):
                base[:, :, c] = a_ + (b_ - a_) * (ys / H)
            fall = np.exp(-((xs - 540) ** 2) / (2 * 380 ** 2)) * np.clip(1 - (ys - 150) / 1500, 0, 1) * 0.30
            base *= (1 + fall)[:, :, None]
            base += noise_layer(W, H, 41, 3.0)[:, :, None]
            _cache[key] = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
        img = _cache[key].copy()
        d = ImageDraw.Draw(img, "RGBA")
        # 天井(遠近)
        d.polygon([(0, 0), (W, 0), (W, 250), (0, 250)], fill=(128, 131, 136))
        d.line([(0, 250), (W, 250)], fill=(96, 99, 104), width=3)
        d.line([(0, 253), (W, 253)], fill=(176, 178, 182), width=1)
        # 蛍光灯とその光
        lit = lerp_color((222, 224, 220), (255, 255, 250), min(1.0, flicker))
        g = glow_sprite(190, (255, 255, 248)).copy()
        g.putalpha(Image.fromarray((np.array(g.getchannel("A")) * (0.35 + 0.55 * flicker)).astype(np.uint8)))
        img.paste(g, (int(W / 2 - g.width / 2), int(150 - g.height / 2)), g)
        d = ImageDraw.Draw(img, "RGBA")
        d.rectangle([300, 118, W - 300, 172], fill=(150, 152, 156))
        d.rectangle([312, 128, W - 312, 162], fill=lit)
        # 埃
        rng = random.Random(7)
        for i in range(46):
            bx, by = rng.uniform(200, W - 200), rng.uniform(200, 1500)
            x = bx + 24 * math.sin(t * 0.5 + i) + 10 * math.sin(t * 1.3 + i * 0.7)
            y = by - (t * 9 + i * 13) % 1300 + 18 * math.sin(t * 0.4 + i)
            r = rng.uniform(1.5, 3.5)
            a = int(110 * math.exp(-((x - 540) ** 2) / (2 * 330 ** 2)) * (0.6 + 0.4 * flicker))
            d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 250, a))
        return img

    def scene_lift(self, t, b, phase):
        flick = math.exp(-phase * 5.0)
        img = self.wall(t, flick)
        u = ease((t - self.g.bt_rel(16)) / (self.g.bt_rel(20) - self.g.bt_rel(16)))
        y = lerp(1250, 880, u)
        plane_side(img, (560, y), angle=math.radians(-24 - 6 * u), scale=1.9, glow=0.2 + 0.8 * u, wing_text="Small wings")
        img = self.finish(img, t, "gray", 70, do_bloom=True)
        self.subtitles(img, t, b)
        return self.glitch(img, phase, b)

    def scene_launch(self, t, b, phase):
        t_start, t_end = self.g.bt_rel(20), self.g.bt_rel(24)
        u = (t - t_start) / (t_end - t_start)
        flick = math.exp(-phase * 5.0)
        img = self.wall(t, flick)
        d = ImageDraw.Draw(img, "RGBA")
        # 天井タイル(遠近)がめくれて空
        vx, vy = 540, -900
        cols, rows = 6, 3
        peel = ease(min(1.0, u * 1.3))
        for r in range(rows):
            for c in range(cols):
                def pt(cc, rr):
                    yy = 250 - rr * (250 / rows)
                    k = 1 - (250 - yy) / 1150
                    return (vx + (cc * W / cols - vx) * k, yy)

                quad = [pt(c, r), pt(c + 1, r), pt(c + 1, r + 1), pt(c, r + 1)]
                dist = math.hypot((c + 0.5 - cols / 2) / cols, (r + 0.5) / rows * 0.5)
                p = ease(min(1.0, max(0.0, peel * 1.8 - dist * 1.6)))
                d.polygon(quad, fill=(118, 190, 255))
                if p < 1:
                    q2 = [quad[3], quad[2], (lerp(quad[2][0], quad[1][0], 1 - p), lerp(quad[2][1], quad[1][1], 1 - p)),
                          (lerp(quad[3][0], quad[0][0], 1 - p), lerp(quad[3][1], quad[0][1], 1 - p))]
                    shade = int(126 - 40 * p)
                    d.polygon(q2, fill=(shade, shade + 3, shade + 8), outline=(100, 103, 108))
        yy = lerp(880, -320, u * u)
        for i in range(3, 0, -1):
            plane_side(img, (560 + i * 2, yy + i * 90), angle=math.radians(-74), scale=1.6 - 0.08 * i, glow=0.0, shadow=False)
        plane_side(img, (560, yy), angle=math.radians(-74), scale=1.7, glow=1.0)
        img = self.finish(img, t, "gray", 70, do_bloom=True)
        self.subtitles(img, t, b)
        img = self.glitch(img, phase, b)
        if b == 23 and phase > 0.55:
            k = ease((phase - 0.55) / 0.45)
            img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), Image.new("L", (W, H), int(255 * k)))
        return img

    # ---- 街
    def city(self, t, colored, offset, zoom=1.0, window=False):
        img = sky(colored >= 0.5, t) if colored in (0.0, 1.0) else Image.blend(sky(False, t), sky(True, t), colored)
        draw_city(img, offset=offset, colored=colored, horizon=1180, zoom=zoom)
        if window:
            window_frame(img)
        return img

    def scene_bridge_a(self, t, b, phase):
        u = t - self.g.bt_rel(24)
        img = self.city(t, 0.0, 30 * u, zoom=1.0, window=True)
        d = ImageDraw.Draw(img)
        x = lerp(140, 940, ease(u / (self.g.bt_rel(40) - self.g.bt_rel(24))))
        y = 780 + 46 * math.sin(u * 1.3)
        plane_top_small(d, (x, y), angle=math.radians(-12 + 12 * math.sin(u)), size=60, colored=False)
        img = self.finish(img, t, "gray", 60)
        self.subtitles(img, t, b)
        if u < 0.5:
            img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), Image.new("L", (W, H), int(255 * (1 - ease(u / 0.5)))))
        return img

    def scene_bridge_b(self, t, b, phase):
        if b < 48:
            u = t - self.g.bt_rel(40)
            flat = desk_flat(False)
            S = self.S_flat(-30 + 2 * u, 1.9, (FCX, FCY + 60 - 30 * u))
            draw_paper(flat, self.paper, 5, 1.0, S, self.front, self.backs)
            pts = apply(S, [(0, -PAPER_H / 2), (6, -PAPER_H * 0.2), (-4, PAPER_H * 0.2), (0, PAPER_H / 2)])
            d = ImageDraw.Draw(flat)
            for i in range(len(pts) - 1):
                x0, y0 = pts[i]
                x1, y1 = pts[i + 1]
                n = 16
                for j in range(0, n, 2):
                    d.line([(lerp(x0, x1, j / n), lerp(y0, y1, j / n)), (lerp(x0, x1, (j + 1) / n), lerp(y0, y1, (j + 1) / n))],
                           fill=PINK, width=7)
            img = desk_camera(flat, t, push=0.3 + 0.3 * ease(u / 3.5))
            img = self.finish(img, t, "gray", 90)
        else:
            u = t - self.g.bt_rel(48)
            img = self.city(t, 0.0, 700 + 480 * u, zoom=1.7)
            plane_side(img, (520, 900 - 30 * u), angle=math.radians(-28), scale=2.3, glow=0.35)
            img = self.finish(img, t, "gray", 70)
        self.subtitles(img, t, b)
        return img

    def scene_breath(self, t, b, phase):
        u = t - self.g.bt_rel(56)
        img = sky(False, t)
        d = ImageDraw.Draw(img)
        plane_top_small(d, (540 + 70 * u, 1240 - 300 * u), angle=math.radians(-42), size=80 + 40 * u, colored=False)
        img = self.finish(img, t, "gray", 60)
        return img

    def particles(self, d, t, colored=True):
        for j in range(60, 84):
            ts = self.g.bt_rel(j)
            if t < ts:
                break
            rng = random.Random(1000 + j)
            for i in range(10):
                age = t - ts - rng.uniform(0, 0.3)
                if age < 0 or age > 3.4:
                    continue
                ox, oy = rng.uniform(40, W - 40), rng.uniform(560, 1160)
                vx, vy = rng.uniform(60, 240), -rng.uniform(150, 380)
                x = ox + vx * age
                y = oy + vy * age + 12 * math.sin(age * 5 + i)
                if -60 < x < W + 60 and -60 < y < H:
                    plane_top_small(d, (x, y), angle=math.atan2(vy, vx), size=rng.uniform(16, 34), colored=colored)

    def radial_mask(self, cx, cy, radius, soft=220):
        key = "radial_base"
        if key not in _cache:
            ys, xs = np.mgrid[0:H // 4, 0:W // 4]
            _cache[key] = (xs * 4, ys * 4)
        xs, ys = _cache[key]
        dist = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
        a = np.clip((radius - dist) / soft, 0, 1) * 255
        return Image.fromarray(a.astype(np.uint8)).resize((W, H), Image.BILINEAR)

    def scene_chorus_city(self, t, b, phase):
        u = t - self.g.bt_rel(60)
        img_c = self.city(t, 1.0, 1400 + 26 * u, zoom=1.15)
        d = ImageDraw.Draw(img_c)
        self.particles(d, t)
        if u < 0.8:
            img_g = self.city(t, 0.0, 1400 + 26 * u, zoom=1.15)
            dg = ImageDraw.Draw(img_g)
            self.particles(dg, t, colored=False)
            radius = 2600 * ease(u / 0.8)
            img = Image.composite(img_c, img_g, self.radial_mask(540, 1000, radius))
        else:
            img = img_c
        img = self.finish(img, t, "color", 50, do_bloom=True, grain=0.8)
        self.subtitles(img, t, b)
        return img

    def fireworks(self, img, t):
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        for j in range(66, 76):
            ts = self.g.bt_rel(j)
            age = t - ts
            if age < 0 or age > 1.7:
                continue
            rng = random.Random(500 + j)
            cx, cy = rng.uniform(200, W - 200), rng.uniform(300, 900)
            col = rng.choice([(255, 150, 200), (150, 230, 255), (255, 240, 150), (200, 255, 210), (255, 190, 150)])
            r = 560 * (1 - math.exp(-3.2 * age))
            alpha = int(255 * max(0.0, 1 - age / 1.6))
            for i in range(32):
                ang = i / 32 * 2 * math.pi + j
                px, py = cx + r * math.cos(ang), cy + r * math.sin(ang) + 130 * age * age
                rr = 12 * (1 - age / 2.0)
                d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=col + (alpha,))
                d.line([(cx + r * 0.6 * math.cos(ang), cy + r * 0.6 * math.sin(ang) + 130 * age * age), (px, py)],
                       fill=col + (alpha // 2,), width=4)
            core = int(70 * (1 - age / 1.2)) if age < 1.2 else 0
            if core > 0:
                d.ellipse([cx - core, cy - core, cx + core, cy + core], fill=(255, 255, 255, alpha))
        glow = layer.filter(ImageFilter.GaussianBlur(16))
        img.paste(glow, (0, 0), glow)
        img.paste(layer, (0, 0), layer)

    def scene_fireworks(self, t, b, phase):
        img = sky(True, t)
        self.fireworks(img, t)
        d = ImageDraw.Draw(img)
        self.particles(d, t)
        u = t - self.g.bt_rel(68)
        plane_top_small(d, (200 + 260 * u, 1520 - 230 * u), angle=math.radians(-35), size=96, colored=True)
        if b == 72 and phase < 0.12:
            flash = int(255 * (1 - phase / 0.12) * 0.7)
            img.paste(Image.new("RGB", (W, H), WHITE), (0, 0), Image.new("L", (W, H), flash))
        if b >= 72:
            img = ImageEnhance.Color(img).enhance(1.3)
        img = self.finish(img, t, "color", 40, do_bloom=True, grain=0.7)
        self.subtitles(img, t, b)
        return img

    def draw_crown(self, flat, cx, cy, angle, scale):
        c, s = math.cos(angle), math.sin(angle)

        def tr(x, y):
            x, y = x * scale, y * scale
            return (cx + x * c - y * s, cy + x * s + y * c)

        pts = [tr(-150, 60), tr(-150, -30), tr(-90, 30), tr(-40, -70), tr(0, 30), tr(40, -70), tr(90, 30), tr(150, -30), tr(150, 60)]
        sh = Image.new("L", (FW // 4, FH // 4), 0)
        ImageDraw.Draw(sh).polygon([((x + 14) / 4, (y + 22) / 4) for x, y in pts], fill=90)
        sh = sh.filter(ImageFilter.GaussianBlur(4)).resize((FW, FH), Image.BILINEAR)
        flat.paste(Image.new("RGB", (FW, FH), (20, 22, 30)), (0, 0), sh)
        d = ImageDraw.Draw(flat)
        d.polygon(pts, fill=(238, 214, 138), outline=(196, 170, 96))
        # 折り紙の面(明暗)
        d.polygon([tr(-150, 60), tr(-150, -30), tr(-90, 30), tr(-90, 60)], fill=(246, 226, 156))
        d.polygon([tr(-40, -70), tr(0, 30), tr(-40, 60), tr(-90, 60), tr(-90, 30)], fill=(228, 202, 124))
        d.polygon([tr(40, -70), tr(90, 30), tr(90, 60), tr(0, 60), tr(0, 30)], fill=(246, 226, 156))
        d.polygon([tr(150, -30), tr(150, 60), tr(90, 60), tr(90, 30)], fill=(228, 202, 124))
        for x, y in [(-150, -30), (-40, -70), (40, -70), (150, -30)]:
            p = tr(x, y)
            d.ellipse([p[0] - 10, p[1] - 10, p[0] + 10, p[1] + 10], fill=(214, 186, 104))

    def scene_crown(self, t, b, phase):
        u = (t - self.g.bt_rel(80)) / (self.g.bt_rel(84) - self.g.bt_rel(80)) if b >= 80 else 0.0
        u = max(0.0, min(1.0, u))
        v = u * u * u
        crown = (FCX + 1300 * v, FCY + 60 * v, math.radians(-8 + 50 * v), 1.7)
        img = self.desk_scene(t, b, phase, 0, 1.0, 0, 1.0, (FCX, FCY), colored=1.0, push=0.3, crown=crown)
        img = self.finish(img, t, "color", 80)
        self.subtitles(img, t, b)
        return img

    def scene_fly(self, t, b, phase):
        u = (t - self.g.bt_rel(84)) / (self.g.bt_rel(88) - self.g.bt_rel(84))
        u = max(0.0, min(1.0, u))
        img = sky(True, t)
        d = ImageDraw.Draw(img)
        self.particles(d, t)
        sc = lerp(0.4, 3.8, u * u * u)
        plane_side(img, (540 + 40 * u, 880 + 220 * u), angle=math.radians(-12 + 8 * u), scale=sc, glow=0.8, shadow=False)
        img = self.finish(img, t, "color", 40, do_bloom=True, grain=0.7)
        self.subtitles(img, t, b)
        return img

    def scene_land(self, t, b, phase):
        t0, t1 = self.g.bt_rel(88), self.g.bt_rel(92)
        u = (t - t0) / (t1 - t0)
        colored = 1.0 - ease(min(1.0, u / 0.55))
        if u < 0.42:
            v = ease(u / 0.42)
            theta, scale = lerp(-40, -5, v), lerp(1.7, 1.0, v)
            center = (lerp(FCX + 200, FCX, v), lerp(FCY - 600, FCY, v))
            k, a = 5, 1.0
        else:
            w = (u - 0.42) / 0.58
            step = 1.0 / 5
            idx = min(4, int(w / step))
            a = 1.0 - ease((w - idx * step) / step)
            k = 5 - idx
            if w >= 1.0:
                k, a = 0, 1.0
            theta, scale, center = -5, 1.0, (FCX, FCY)
        img = self.desk_scene(t, b, phase, k, a, theta, scale, center, colored=colored, push=0.0)
        img = self.finish(img, t, "color" if colored > 0.5 else "gray", 80)
        self.subtitles(img, t, b)
        return img

    def render(self, t):
        b, phase = self.g.at(t)
        if b < 4:
            return self.scene_intro(t, b, phase)
        if b < 16:
            return self.scene_fold(t, b, phase)
        if b < 20:
            return self.scene_lift(t, b, phase)
        if b < 24:
            return self.scene_launch(t, b, phase)
        if b < 40:
            return self.scene_bridge_a(t, b, phase)
        if b < 56:
            return self.scene_bridge_b(t, b, phase)
        if b < 60:
            return self.scene_breath(t, b, phase)
        if b < 68:
            return self.scene_chorus_city(t, b, phase)
        if b < 76:
            return self.scene_fireworks(t, b, phase)
        if b < 84:
            return self.scene_crown(t, b, phase)
        if b < 88:
            return self.scene_fly(t, b, phase)
        return self.scene_land(t, b, phase)


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
        p.stdin.write(anim.render(i / fps).tobytes())
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
            b, _ = grid.at(t)
            anim.render(t).save(os.path.join(args.out_dir, f"t{t:05.2f}_b{b:02d}.png"))
            print("still", t, "beat", b)
        return
    render_video(anim, grid, args.song, args.out)


if __name__ == "__main__":
    main()
