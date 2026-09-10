#!/usr/bin/env python3
"""「NOT YOUR MEDICINE」(kikitoa) 演出「線を引く夜」のアニマティック。

カット: ブレイク頭(約3:07)から最終サビの句切れ(約3:58)まで 51秒。
世界: 深夜のテーブル。スマホ、水のグラス、白い錠剤。夜は青、朝は琥珀。手は出さない。

  ブレイク  No cure / No savior / Just love / With a line
            → 2:14 の着信。錠剤(=僕)が水に溶けて消える。線が引かれる。
  サビ前半  I'm not your medicine / But I can meet you where you are
            → 新しい錠剤はグラスの縁に立ち、水には落ちない。横へ滑りテーブルに立つ。
  小休止    I can love you deeply / Without becoming every scar
            → 静かな水面。夜明けの気配。
  サビ後半  I'm not your medicine / You have strength beneath your skin / …
            → 朝の光がテーブルを横切り、長い影。スマホに「起きてる？」
  I can stay / I can care / I can love without disappearing
            → 返信を打つ。「薬にはなれない。でも、隣にはいる。」
  I'm not your medicine / I'm just someone choosing to be here
            → 送信。朝の光の中、線とグラスと立ったままの錠剤。

使い方:
  python3 animatic.py --song NOT_YOUR_MEDICINE.mp3 --out animatic.mp4
  python3 animatic.py --song ... --stills 0.3,12,35 --out-dir stills/
"""
import argparse
import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "common"))
import mvkit as K  # noqa: E402
from mvkit import W, H, FPS, ease, ease_out, lerp, lerp_color, font, tracked_text, lyric_block, caption_hook, paste_center  # noqa: E402

FW, FH = 1600, 2100
FCX, FCY = 800, 1060

# ---- パレット ----
TABLE_NIGHT = (30, 34, 46)
TABLE_DAWN = (98, 86, 78)
PHONE_BODY = (14, 15, 20)
PHONE_GLOW = (196, 212, 240)
AMBER = (255, 172, 84)
LINE_WHITE = (238, 236, 230)
TABLET = (244, 242, 236)
WATER = (52, 84, 104)

# 物の位置(平面キャンバス座標)
PHONE_C = (600, 930)
GLASS_C = (1090, 1240)
GLASS_R = 150
TABLET_HOME = (1300, 1420)
LINE_PTS = [(790, 120), (812, 600), (836, 1100), (858, 1600), (884, 2000)]

# ---- 歌詞と訳 ----
BREAK = [("No cure", "治せはしない"), ("No savior", "救えもしない"), ("Just love", "ただ、愛してる"), ("With a line", "線を引いて")]
HOOK = [("I'm not your medicine", "僕は君の薬じゃない"),
        ("But I can meet you where you are", "でも、君のいる場所まで会いに行ける"),
        ("I can love you deeply", "深く愛せる"),
        ("Without becoming every scar", "君の傷のすべてにならなくても"),
        ("I'm not your medicine", "僕は君の薬じゃない"),
        ("You have strength beneath your skin", "君の中には、ちゃんと強さがある"),
        ("If we learn to stand together", "一緒に立つことを覚えたら"),
        ("Then maybe both of us can win", "きっと二人とも救われる"),
        ("I can stay", "隣にいられる"), ("I can care", "大事にできる"),
        ("I can love without disappearing", "消えずに、愛せる"),
        ("I'm not your medicine", "僕は君の薬じゃない"),
        ("I'm just someone choosing to be here", "ここにいることを選んだ、ただの一人")]
# (相対拍の開始, 終了, 行) — 解析した拍位置に合わせた仮定
SUB_TIMING = [(0, 12, BREAK[0]), (12, 20, BREAK[1]), (20, 26, BREAK[2]), (26, 30, BREAK[3]),
              (30, 40, HOOK[0]), (40, 49, HOOK[1]), (49, 61, HOOK[2]), (61, 73, HOOK[3]),
              (73, 81, HOOK[4]), (81, 89, HOOK[5]), (89, 97, HOOK[6]), (97, 105, HOOK[7]),
              (105, 110, HOOK[8]), (110, 115, HOOK[9]), (115, 123, HOOK[10]),
              (123, 133, HOOK[11]), (133, 146, HOOK[12])]
HOOK_TEXT = "毎晩、僕は君の薬だった。"
REPLY = "薬にはなれない。でも、隣にはいる。"

_c = K._cache
K.ACCENT = AMBER  # この曲のアクセント色は琥珀


# ---------------------------------------------------------------- テーブル(平面)
def table_flat(warm=0.0):
    """夜のテーブル。warm=0 夜 / 1 朝。照明マップ込み。"""
    key = ("table", round(warm, 2))
    if key in _c:
        return _c[key].copy()
    base_col = lerp_color(TABLE_NIGHT, TABLE_DAWN, warm)
    base = np.full((FH, FW, 3), base_col, float)
    ys, xs = np.mgrid[0:FH, 0:FW]
    # 木目(細かい波)と大きなムラ
    grain = 0.5 + 0.5 * np.sin(ys * 0.09 + 5.0 * np.sin(xs * 0.0027) + 1.5 * np.sin(ys * 0.011))
    base -= (grain * (2.2 + 2.0 * warm))[:, :, None]
    mott = K.noise_layer(FW // 20, FH // 20, 9, 40.0, blur=1.5)
    mott = np.array(Image.fromarray((mott + 128).astype(np.uint8)).resize((FW, FH), Image.BILINEAR)).astype(float) - 128
    base += (mott * 0.22)[:, :, None]
    base += K.noise_layer(FW, FH, 10, 3.0)[:, :, None]
    # ランプ(右上)の琥珀の光。夜は弱く、朝は強く広く
    d = np.sqrt(((xs - 1500) / 1.0) ** 2 + ((ys - 120) / 1.15) ** 2)
    lamp = np.exp(-d / (620 + 900 * warm)) * (0.55 + 0.55 * warm)
    amber = np.array(AMBER, float) / 255.0
    base = base * (1.0 + lamp[:, :, None] * amber[None, None, :] * 1.15)
    # 左下は暗く
    base *= (1.0 - 0.28 * (1 - warm) * np.clip((ys / FH) * 0.6 + (1 - xs / FW) * 0.6 - 0.35, 0, 1))[:, :, None]
    im = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    _c[key] = im
    return im.copy()


def glow_paste(flat, center, radius, color, alpha):
    if alpha <= 0.01:
        return
    g = K.glow_sprite(int(radius), color).copy()
    g.putalpha(Image.fromarray((np.array(g.getchannel("A")) * min(1.0, alpha)).astype(np.uint8)))
    flat.paste(g, (int(center[0] - g.width / 2), int(center[1] - g.height / 2)), g)


# ---------------------------------------------------------------- スマホ
def phone_screen(state, big=False, typed=0, caret=True, sent=False):
    """スマホ画面(縦)。state: off / call / dark / message"""
    sw, sh = (900, 1780) if big else (272, 584)
    im = Image.new("RGB", (sw, sh), (6, 7, 10))
    d = ImageDraw.Draw(im, "RGBA")
    s = sw / 272.0
    if state == "off":
        d.rectangle([0, 0, sw, sh], fill=(8, 9, 12))
        d.polygon([(0, 0), (sw * 0.55, 0), (sw, sh * 0.5), (sw, sh)], fill=(255, 255, 255, 6))
        return im
    if state == "call":
        d.rectangle([0, 0, sw, sh], fill=(18, 22, 34))
        d.text((sw / 2, 46 * s), "2:14", font=font(int(28 * s)), fill=(214, 222, 240), anchor="mm")
        d.ellipse([sw / 2 - 44 * s, 150 * s, sw / 2 + 44 * s, 238 * s], fill=(44, 52, 74))
        d.text((sw / 2, 194 * s), "君", font=font(int(34 * s)), fill=(214, 222, 240), anchor="mm")
        d.text((sw / 2, 292 * s), "君", font=font(int(30 * s)), fill=(232, 236, 246), anchor="mm")
        d.text((sw / 2, 334 * s), "着信中…", font=font(int(16 * s)), fill=(150, 160, 186), anchor="mm")
        d.ellipse([sw * 0.22 - 30 * s, sh - 120 * s, sw * 0.22 + 30 * s, sh - 60 * s], fill=(168, 62, 62))
        d.ellipse([sw * 0.78 - 30 * s, sh - 120 * s, sw * 0.78 + 30 * s, sh - 60 * s], fill=(66, 150, 96))
        return im
    # message / typing
    d.rectangle([0, 0, sw, sh], fill=(20, 22, 30))
    d.text((sw / 2, 34 * s), "6:41", font=font(int(16 * s)), fill=(190, 198, 214), anchor="mm")
    d.text((sw / 2, 74 * s), "君", font=font(int(18 * s)), fill=(226, 230, 240), anchor="mm")
    d.line([(0, 98 * s), (sw, 98 * s)], fill=(44, 48, 60), width=max(1, int(1 * s)))

    def bubble(y, text, mine=False, w=None):
        f = font(int(15 * s))
        tw = d.textlength(text, font=f) if text else 0
        bw = max(60 * s, tw + 32 * s) if w is None else w
        bh = 42 * s
        x0 = (sw - 16 * s - bw) if mine else 16 * s
        col = (58, 72, 112) if mine else (46, 50, 62)
        d.rounded_rectangle([x0, y, x0 + bw, y + bh], radius=16 * s, fill=col)
        if text:
            d.text((x0 + 16 * s, y + bh / 2), text, font=f, fill=(236, 238, 244), anchor="lm")
        return y + bh + 12 * s

    y = 120 * s
    d.text((sw / 2, y), "2:14", font=font(int(11 * s)), fill=(120, 128, 150), anchor="mm")
    y += 16 * s
    y = bubble(y, "起きてる？")
    y = bubble(y, "また眠れなかった")
    y = bubble(y, "声、聞きたい")
    y += 8 * s
    d.text((sw / 2, y), "6:40", font=font(int(11 * s)), fill=(120, 128, 150), anchor="mm")
    y += 16 * s
    if sent:
        y = bubble(y, REPLY[:typed] if typed < len(REPLY) else REPLY, mine=True)
        d.text((sw - 16 * s, y - 4 * s), "送信済み", font=font(int(11 * s)), fill=(120, 128, 150), anchor="rm")
    # 入力欄
    iy = sh - 92 * s
    d.rounded_rectangle([14 * s, iy, sw - 14 * s, iy + 60 * s], radius=22 * s, fill=(34, 38, 50), outline=(64, 70, 88))
    if not sent:
        txt = REPLY[:typed]
        f = font(int(16 * s))
        d.text((30 * s, iy + 30 * s), txt, font=f, fill=(236, 238, 244), anchor="lm")
        if caret:
            cx = 30 * s + d.textlength(txt, font=f) + 2 * s
            d.line([(cx, iy + 16 * s), (cx, iy + 44 * s)], fill=(236, 238, 244), width=max(1, int(2 * s)))
    else:
        d.text((30 * s, iy + 30 * s), "メッセージ", font=font(int(16 * s)), fill=(90, 96, 116), anchor="lm")
    d.ellipse([sw - 58 * s, iy + 12 * s, sw - 22 * s, iy + 48 * s], fill=(70, 120, 210) if (typed >= len(REPLY) and not sent) else (54, 60, 80))
    return im


def draw_phone_flat(flat, center, angle_deg, state, brightness=1.0, typed=0, sent=False):
    """テーブル上のスマホ(俯瞰)。本体+画面+画面の光。"""
    pw, ph = 300, 620
    body = Image.new("RGBA", (pw + 80, ph + 80), (0, 0, 0, 0))
    d = ImageDraw.Draw(body)
    d.rounded_rectangle([40, 40, 40 + pw, 40 + ph], radius=44, fill=PHONE_BODY + (255,), outline=(60, 62, 70, 255), width=3)
    scr = phone_screen(state, typed=typed, sent=sent)
    if brightness < 1.0:
        scr = ImageEnhance.Brightness(scr).enhance(max(0.0, brightness))
    mask = Image.new("L", scr.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, scr.width - 1, scr.height - 1], radius=30, fill=255)
    body.paste(scr, (40 + (pw - scr.width) // 2, 40 + (ph - scr.height) // 2), mask)
    d.line([(40 + 20, 40 + 2), (40 + pw - 20, 40 + 2)], fill=(120, 122, 130, 120), width=2)
    body = body.rotate(angle_deg, resample=Image.BICUBIC, expand=True)
    # 影
    sh = Image.new("L", (FW // 4, FH // 4), 0)
    ImageDraw.Draw(sh).rounded_rectangle([(center[0] - pw / 2 + 12) / 4, (center[1] - ph / 2 + 22) / 4,
                                          (center[0] + pw / 2 + 12) / 4, (center[1] + ph / 2 + 22) / 4], radius=12, fill=120)
    sh = sh.rotate(angle_deg, center=((center[0] + 12) / 4, (center[1] + 22) / 4)).filter(ImageFilter.GaussianBlur(4)).resize((FW, FH), Image.BILINEAR)
    flat.paste(Image.new("RGB", (FW, FH), (6, 8, 14)), (0, 0), sh)
    flat.paste(body, (int(center[0] - body.width / 2), int(center[1] - body.height / 2)), body)


# ---------------------------------------------------------------- グラスと錠剤(俯瞰)
def draw_glass_flat(flat, center, r, fizz=0.0, t=0.0, warm=0.0, ripple=0.0):
    cx, cy = center
    layer = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # 影(柔らかい)
    sh = Image.new("L", (FW // 4, FH // 4), 0)
    ImageDraw.Draw(sh).ellipse([(cx - r + 10) / 4, (cy - r + 18) / 4, (cx + r + 10) / 4, (cy + r + 18) / 4], fill=120)
    sh = sh.filter(ImageFilter.GaussianBlur(5)).resize((FW, FH), Image.BILINEAR)
    flat.paste(Image.new("RGB", (FW, FH), (6, 8, 14)), (0, 0), sh)
    # ガラスの底(テーブルより少し明るく青い)
    water = lerp_color(WATER, (120, 110, 96), warm)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=lerp_color(water, (0, 0, 0), 0.35) + (170,))
    d.ellipse([cx - r * 0.86, cy - r * 0.86, cx + r * 0.86, cy + r * 0.86], fill=water + (200,))
    # 水面の反射(窓の四角と縁のハイライト)
    d.ellipse([cx - r * 0.86, cy - r * 0.86, cx + r * 0.86, cy + r * 0.86], outline=(255, 255, 255, 40), width=2)
    d.polygon([(cx - r * 0.45, cy - r * 0.55), (cx - r * 0.1, cy - r * 0.7), (cx + r * 0.05, cy - r * 0.35), (cx - r * 0.3, cy - r * 0.2)],
              fill=(255, 255, 255, 34 + int(40 * warm)))
    # 波紋
    if ripple > 0:
        for i in range(3):
            rr = r * 0.86 * ((ripple + i * 0.33) % 1.0)
            a = int(90 * (1 - (ripple + i * 0.33) % 1.0))
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(255, 255, 255, a), width=2)
    # 発泡: 錠剤が縮み、泡と白い濁り
    if 0 < fizz < 1:
        tr = 44 * max(0.0, 1 - fizz / 0.7)
        haze = int(150 * math.sin(math.pi * fizz))
        d.ellipse([cx - r * 0.6, cy - r * 0.6, cx + r * 0.6, cy + r * 0.6], fill=(230, 236, 240, haze // 3))
        if tr > 2:
            d.ellipse([cx - tr, cy - tr, cx + tr, cy + tr], fill=TABLET + (230,))
        rng = random.Random(3)
        for i in range(90):
            ang = rng.uniform(0, 2 * math.pi)
            sp = rng.uniform(0.3, 1.0)
            life = (fizz * 3.0 * sp + rng.random()) % 1.0
            rad = r * 0.8 * life
            bx, by = cx + rad * math.cos(ang), cy + rad * math.sin(ang)
            br = rng.uniform(2, 6) * (1 - life * 0.5)
            d.ellipse([bx - br, by - br, bx + br, by + br], fill=(255, 255, 255, int(200 * (1 - life))))
    # 縁(厚いガラス)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255, 70), width=10)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255, 150), width=2)
    d.arc([cx - r, cy - r, cx + r, cy + r], 200, 260, fill=(255, 255, 255, 230), width=6)
    d.arc([cx - r * 0.86, cy - r * 0.86, cx + r * 0.86, cy + r * 0.86], 20, 70, fill=lerp_color(AMBER, (255, 255, 255), 0.3) + (int(120 + 100 * warm),), width=4)
    flat.paste(layer, (0, 0), layer)


def draw_tablet_flat(flat, center, r=44, standing=False, warm=0.0, shadow_len=0):
    cx, cy = center
    layer = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if shadow_len > 0:
        sh = Image.new("L", (FW // 4, FH // 4), 0)
        ImageDraw.Draw(sh).polygon([((cx - r * 0.2) / 4, (cy + 6) / 4), ((cx + r * 0.2) / 4, (cy + 6) / 4),
                                    ((cx - shadow_len + r * 0.4) / 4, (cy + 26) / 4), ((cx - shadow_len - r * 0.4) / 4, (cy + 26) / 4)], fill=110)
        sh = sh.filter(ImageFilter.GaussianBlur(3)).resize((FW, FH), Image.BILINEAR)
        flat.paste(Image.new("RGB", (FW, FH), (6, 8, 14)), (0, 0), sh)
    if standing:
        # 立った錠剤(俯瞰では細長い楕円 + 側面)
        d.ellipse([cx - r * 0.24 + 6, cy - r + 8, cx + r * 0.24 + 6, cy + r + 8], fill=(0, 0, 0, 90))
        d.ellipse([cx - r * 0.3, cy - r, cx + r * 0.3, cy + r], fill=(206, 202, 194, 255))
        d.ellipse([cx - r * 0.24, cy - r * 0.94, cx + r * 0.24, cy + r * 0.94], fill=TABLET + (255,))
        d.line([(cx, cy - r * 0.6), (cx, cy + r * 0.6)], fill=(214, 210, 202, 255), width=2)
    else:
        d.ellipse([cx - r + 6, cy - r + 10, cx + r + 6, cy + r + 10], fill=(0, 0, 0, 90))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(210, 206, 198, 255))
        d.ellipse([cx - r * 0.92, cy - r * 0.92, cx + r * 0.92, cy + r * 0.92], fill=TABLET + (255,))
        d.line([(cx - r * 0.6, cy), (cx + r * 0.6, cy)], fill=(216, 212, 204, 255), width=3)
        d.arc([cx - r * 0.92, cy - r * 0.92, cx + r * 0.92, cy + r * 0.92], 200, 300, fill=(255, 255, 255, 200), width=3)
    layer = layer.filter(ImageFilter.GaussianBlur(0.4))
    flat.paste(layer, (0, 0), layer)


def line_path(seed=5, n=160):
    key = ("line", seed)
    if key not in _c:
        rng = random.Random(seed)
        pts = []
        for i in range(n + 1):
            u = i / n
            k = min(len(LINE_PTS) - 2, int(u * (len(LINE_PTS) - 1)))
            lu = u * (len(LINE_PTS) - 1) - k
            x = lerp(LINE_PTS[k][0], LINE_PTS[k + 1][0], lu) + rng.uniform(-3, 3) + 6 * math.sin(u * 23)
            y = lerp(LINE_PTS[k][1], LINE_PTS[k + 1][1], lu) + rng.uniform(-2, 2)
            pts.append((x, y))
        _c[key] = pts
    return _c[key]


def draw_line_flat(flat, progress, alpha=255):
    if progress <= 0:
        return
    pts = line_path()
    n = max(2, int(len(pts) * min(1.0, progress)))
    layer = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.line(pts[:n], fill=(0, 0, 0, 70), width=13, joint="curve")
    d.line([(x + 3, y + 4) for x, y in pts[:n]], fill=(0, 0, 0, 40), width=11, joint="curve")
    d.line(pts[:n], fill=LINE_WHITE + (alpha,), width=9, joint="curve")
    d.line(pts[:n], fill=(255, 255, 255, alpha // 2), width=3, joint="curve")
    flat.paste(layer, (0, 0), layer)


# ---------------------------------------------------------------- 朝の光
def dawn_sweep(flat, frac, strength=1.0):
    """右から左へ朝の光が進む。frac 0..1。光の縁は柔らかい。"""
    if frac <= 0:
        return flat
    key = "xs"
    if key not in _c:
        _c[key] = np.mgrid[0:FH // 4, 0:FW // 4][1] * 4
    xs = _c[key]
    boundary = FW + 300 - frac * (FW + 900)
    a = np.clip((xs - boundary) / 360.0, 0, 1)
    mask = Image.fromarray((a * 255 * strength).astype(np.uint8)).resize((FW, FH), Image.BILINEAR)
    warm = ImageEnhance.Brightness(ImageChops.screen(flat, Image.new("RGB", (FW, FH), (64, 44, 22)))).enhance(1.04)
    return Image.composite(warm, flat, mask)


# ---------------------------------------------------------------- 横アングルのグラス
def glass_side_scene(t, u_tablet, lamp=1.0, still=1.0, fizz=0.0):
    """u_tablet: 0=縁に立つ, 1=外側を滑ってテーブルに立つ。"""
    img = Image.new("RGB", (W, H), (10, 12, 18))
    arr = np.zeros((H, W, 3), float)
    ys, xs = np.mgrid[0:H, 0:W]
    arr[:, :, 0] = 16 + 12 * (ys / H)
    arr[:, :, 1] = 18 + 12 * (ys / H)
    arr[:, :, 2] = 26 + 16 * (ys / H)
    d2 = np.sqrt(((xs - 820) / 1.0) ** 2 + ((ys - 380) / 1.2) ** 2)
    glow = np.exp(-d2 / 620) * 1.25 * lamp
    amber = np.array(AMBER, float) / 255.0
    arr += (glow[:, :, None] * amber[None, None, :] * 140)
    # テーブル面(下)
    tab = np.clip((ys - 1440) / 60.0, 0, 1)
    arr = arr * (1 - tab[:, :, None]) + (np.array([42, 40, 48], float) + glow[:, :, None] * amber * 90) * tab[:, :, None]
    arr += K.noise_layer(W, H, 12, 2.5)[:, :, None]
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    gx0, gx1, gy0, gy1 = 370, 710, 640, 1450  # グラスの外形
    inset = 26
    # グラスの影(テーブル)
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([gx0 - 60, gy1 - 30, gx1 + 120, gy1 + 60], fill=(0, 0, 0, 120))
    sh = sh.filter(ImageFilter.GaussianBlur(18))
    layer.alpha_composite(sh)
    # 水(暗い青、右に琥珀の照り返し)
    wl = 1120
    water = [(gx0 + 8 + inset * 0.3, wl), (gx1 - 8 - inset * 0.3, wl), (gx1 - inset, gy1 - 16), (gx0 + inset, gy1 - 16)]
    d.polygon(water, fill=(74, 122, 158, 235))
    d.ellipse([gx0 + inset + 10, gy1 - 70, gx1 - inset - 10, gy1 - 10], fill=lerp_color(AMBER, (255, 255, 255), 0.35) + (int(90 * lamp),))
    d.polygon([(gx1 - 8 - inset * 0.3 - 70, wl), (gx1 - 8 - inset * 0.3, wl), (gx1 - inset, gy1 - 16), (gx1 - inset - 60, gy1 - 16)],
              fill=lerp_color(AMBER, (255, 255, 255), 0.2) + (int(70 * lamp),))
    d.ellipse([gx0 + 12, wl - 14, gx1 - 12, wl + 14], fill=(124, 172, 204, 150), outline=(255, 255, 255, 170), width=2)
    # 発泡(過去の夜)
    if 0 < fizz < 1:
        rng = random.Random(4)
        for i in range(160):
            life = (fizz * 2.5 * rng.uniform(0.4, 1.0) + rng.random()) % 1.0
            bx = rng.uniform(gx0 + 50, gx1 - 50)
            by = gy1 - 40 - life * (gy1 - 40 - wl)
            br = rng.uniform(2, 7) * (0.5 + 0.5 * life)
            d.ellipse([bx - br, by - br, bx + br, by + br], fill=(255, 255, 255, int(180 * (1 - life))))
        d.ellipse([gx0 + 60, gy1 - 120, gx1 - 60, gy1 - 30], fill=(240, 244, 248, int(120 * math.sin(math.pi * fizz))))
    # ガラス本体(縁とハイライト)
    d.polygon([(gx0, gy0), (gx1, gy0), (gx1 - inset, gy1), (gx0 + inset, gy1)], outline=(255, 255, 255, 160), width=4)
    d.polygon([(gx0, gy0), (gx1, gy0), (gx1 - inset, gy1), (gx0 + inset, gy1)], fill=(255, 255, 255, 26))
    d.line([(gx0 + 34, gy0 + 60), (gx0 + 34 + inset * 0.6, gy1 - 60)], fill=(255, 255, 255, 110), width=6)
    d.line([(gx1 - 30, gy0 + 60), (gx1 - 30 - inset * 0.7, gy1 - 60)], fill=lerp_color(AMBER, (255, 255, 255), 0.5) + (int(150 * lamp),), width=5)
    d.ellipse([gx0 - 4, gy0 - 30, gx1 + 4, gy0 + 30], outline=(255, 255, 255, 200), width=5)
    d.ellipse([gx0 - 4, gy0 - 30, gx1 + 4, gy0 + 30], fill=(255, 255, 255, 12))
    d.ellipse([gx0 + inset - 6, gy1 - 22, gx1 - inset + 6, gy1 + 22], outline=(255, 255, 255, 120), width=4)
    # 錠剤: 縁の上 → 外側を滑って → テーブルに立つ
    if u_tablet < 0.5:
        v = u_tablet / 0.5
        px, py = lerp(gx1 - 30, gx1 + 34, v), lerp(gy0 - 8, gy0 + 40, v)
        ang = lerp(6, 70, v)
    else:
        v = (u_tablet - 0.5) / 0.5
        px, py = lerp(gx1 + 34, gx1 + 120, ease_out(v)), lerp(gy0 + 40, gy1 - 28, ease(v))
        ang = lerp(70, 90, v)
    tw, th = 80, 22
    tab = Image.new("RGBA", (140, 140), (0, 0, 0, 0))
    td = ImageDraw.Draw(tab)
    td.rounded_rectangle([70 - tw / 2, 70 - th / 2, 70 + tw / 2, 70 + th / 2], radius=8, fill=TABLET + (255,), outline=(200, 196, 188, 255), width=2)
    td.line([(70 - tw / 2 + 10, 70), (70 + tw / 2 - 10, 70)], fill=(214, 210, 202, 255), width=2)
    tab = tab.rotate(-ang, resample=Image.BICUBIC)
    tsh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(tsh).ellipse([px - 34, py + 12, px + 40, py + 32], fill=(0, 0, 0, 120))
    layer.alpha_composite(tsh.filter(ImageFilter.GaussianBlur(6)))
    tg = K.glow_sprite(70, (255, 236, 210)).copy()
    tg.putalpha(Image.fromarray((np.array(tg.getchannel("A")) * 0.55).astype(np.uint8)))
    layer.alpha_composite(tg, (int(px - tg.width / 2), int(py - tg.height / 2)))
    layer.alpha_composite(tab, (int(px - 70), int(py - 70)))
    img.paste(layer, (0, 0), layer)
    return img


# ---------------------------------------------------------------- 本体
class Animatic:
    def __init__(self, grid, sections):
        self.g = grid
        self.sec = sections  # 相対拍: hook, quiet, ret, dip230
        here = os.path.dirname(os.path.abspath(__file__))
        self.tl = K.LyricTimeline(os.path.join(here, "lyrics_timing.json"), lead=0.25, end_time=grid.t0 + grid.dur)
        # 歌い出しに結びついたシーン境界(絶対秒)
        self.T_hook = grid.t0 + grid.bt_rel(sections["hook"])
        self.T_quiet = grid.t0 + grid.bt_rel(sections["quiet"])
        self.T_ret = grid.t0 + grid.bt_rel(sections["ret"])
        self.T_reply = self.tl.start("I can stay") - 0.4
        self.T_morning = self.tl.start(15)  # 最後の I'm not your medicine
        self.T_end = grid.t0 + grid.dur
        self.T_savior = self.tl.start("No savior")
        self.T_love = self.tl.start("Just love")
        self.T_line = self.tl.start("With a line")
        self.T_strength = self.tl.start("You have strength beneath your skin")

    def subtitles(self, img, t, b=None):
        self.tl.draw(img, self.g.t0 + t, y=1420, kinetic=True)

    def punch(self, img, t, amp=0.012):
        """拍の頭で僅かに寄って戻る(拍同期パンチイン)。"""
        b, phase = self.g.at(t)
        z = 1 + amp * math.exp(-phase * 7.0)
        if z <= 1.0005:
            return img
        w, h = int(W / z), int(H / z)
        x0, y0 = (W - w) // 2, (H - h) // 2
        return img.crop((x0, y0, x0 + w, y0 + h)).resize((W, H), Image.BILINEAR)

    def hook_caption(self, img, t):
        t_end = self.T_savior - 0.2 - self.g.t0
        if t > t_end + 0.3:
            return
        a = 1.0 if t < t_end else 1.0 - (t - t_end) / 0.3
        pop = 1.0 + 0.10 * (1 - ease(min(1.0, (t - 0.1) / 0.16))) if t > 0.1 else 1.1
        if t < 0.1:
            a *= t / 0.1
        paste_center(img, caption_hook(HOOK_TEXT), W / 2, 372, a, pop)

    def finish(self, img, t, mode, vig=80, do_bloom=False, grain=0.9):
        if do_bloom:
            img = K.bloom(img, threshold=190, strength=0.5, radius=16)
        img = K.grade(img, mode)
        K.apply_vignette(img, vig)
        return K.apply_grain(img, int(t * 1000), grain)

    def camera(self, flat, t, push=0.0, bump=0.0, dof=6):
        return K.perspective_camera(flat, FW, FH, FCX, FCY, t, push=push, bump=bump, dof=dof)

    # ---- シーン1: ブレイク(夜のテーブル)
    def scene_break(self, t, b, phase):
        hook_b = self.sec["hook"]
        u = t / self.g.bt_rel(hook_b)
        flat = table_flat(0.0)
        T = self.g.t0 + t
        t_savior, t_love, t_line = (x - self.g.t0 for x in (self.T_savior, self.T_love, self.T_line))
        # 着信 → 通話終了(Just love で暗く)
        call_on = t < t_love
        ring = 0.75 + 0.25 * math.sin(t * 22) if call_on else 0.0
        screen_b = 1.0 if call_on else max(0.0, 1.0 - (t - t_love) / 0.5)
        glow_paste(flat, PHONE_C, 520, PHONE_GLOW, 0.55 * screen_b * (0.85 + 0.15 * ring))
        # 錠剤(=僕)が水へ: No savior で落ちて、Just love までに溶ける
        fizz = 0.0
        tablet_pos = TABLET_HOME
        show_tablet = True
        if t >= t_savior:
            v = (t - t_savior) / max(0.5, (t_line - t_savior))
            if v < 0.18:
                w = ease(v / 0.18)
                tablet_pos = (lerp(TABLET_HOME[0], GLASS_C[0], w), lerp(TABLET_HOME[1], GLASS_C[1], w))
            else:
                show_tablet = False
                fizz = min(1.0, (v - 0.18) / 0.82)
        ripple = 0.0
        if t >= t_savior and fizz < 1.0 and not show_tablet:
            ripple = (t * 0.9) % 1.0
        draw_glass_flat(flat, GLASS_C, GLASS_R, fizz=fizz, t=t, warm=0.0, ripple=ripple)
        if show_tablet:
            draw_tablet_flat(flat, tablet_pos, 44)
        draw_phone_flat(flat, PHONE_C, -8, "call" if call_on else "off", brightness=screen_b)
        # With a line: 線が引かれる(歌い出しからサビ頭まで)
        if t >= t_line - 0.2:
            prog = (t - (t_line - 0.2)) / max(0.6, (self.T_hook - self.T_line - 0.3))
            draw_line_flat(flat, ease(min(1.0, prog * 1.05)))
        img = self.camera(flat, t, push=0.5 * ease(u), bump=0.0)
        img = self.finish(img, t, "night", 95, do_bloom=True)
        self.hook_caption(img, t)
        self.subtitles(img, t, b)
        return img

    # ---- シーン2: サビ前半(横アングルのグラス)
    def scene_rim(self, t, b, phase):
        b0, b1 = self.sec["hook"], self.sec["quiet"]
        u = (t - self.g.bt_rel(b0)) / (self.g.bt_rel(b1) - self.g.bt_rel(b0))
        # 0〜0.5: 縁に立ったまま(I'm not your medicine) / 0.5〜1: 滑り降りて立つ(But I can meet you…)
        ut = 0.0 if u < 0.5 else min(1.0, (u - 0.5) / 0.5)
        img = glass_side_scene(t, ut, lamp=0.9 + 0.1 * math.sin(t * 3))
        # 拍でごく僅かな揺れ
        if phase < 0.15:
            k = int(6 * (1 - phase / 0.15))
            img = ImageChops.offset(img, 0, k)
        img = self.finish(img, t, "night", 70, do_bloom=True)
        img = self.punch(img, t, 0.015)
        self.subtitles(img, t, b)
        return img

    # ---- シーン3: 小休止(静かな水面、夜明けの気配)
    def scene_still(self, t, b, phase):
        b0, b1 = self.sec["quiet"], self.sec["ret"]
        u = (t - self.g.bt_rel(b0)) / (self.g.bt_rel(b1) - self.g.bt_rel(b0))
        warm = 0.18 * ease(u)
        flat = table_flat(warm)
        draw_glass_flat(flat, GLASS_C, GLASS_R, warm=warm)
        draw_tablet_flat(flat, (GLASS_C[0] + 235, GLASS_C[1] + 120), 44, standing=True, warm=warm)
        draw_line_flat(flat, 1.0, alpha=230)
        draw_phone_flat(flat, PHONE_C, -8, "off", brightness=0.0)
        # マクロ: グラスに寄る
        img = K.perspective_camera(flat, FW, FH, GLASS_C[0] + 60, GLASS_C[1] - 60, t, push=0.0, dof=8,
                                   top_w=980 - 120 * u, bot_w=700 - 90 * u, top_dy=600 - 70 * u, bot_dy=640 - 70 * u)
        img = self.finish(img, t, "night", 100, do_bloom=False)
        self.subtitles(img, t, b)
        return img

    # ---- シーン4: サビ後半(朝の光が横切る)
    def scene_dawn(self, t, b, phase):
        T = self.g.t0 + t
        u = (T - self.T_ret) / (self.T_reply - self.T_ret)
        u = max(0.0, min(1.0, u))
        warm = 0.2 + 0.8 * ease(u)
        flat = table_flat(warm)
        msg_on = T >= self.T_strength - 0.2
        draw_glass_flat(flat, GLASS_C, GLASS_R, warm=warm)
        draw_tablet_flat(flat, (GLASS_C[0] + 235, GLASS_C[1] + 120), 44, standing=True, warm=warm, shadow_len=int(220 * ease(u)))
        draw_line_flat(flat, 1.0, alpha=235)
        if msg_on:
            glow_paste(flat, PHONE_C, 420, PHONE_GLOW, 0.25 * (1 - warm * 0.5))
        draw_phone_flat(flat, PHONE_C, -8, "message" if msg_on else "off", brightness=1.0 if msg_on else 0.0)
        flat = dawn_sweep(flat, ease(min(1.0, u * 1.15)), strength=0.85)
        img = self.camera(flat, t, push=0.2 + 0.3 * ease(u), bump=0.0)
        img = self.finish(img, t, "dawn" if warm > 0.5 else "night", 70, do_bloom=True, grain=0.8)
        img = self.punch(img, t, 0.012)
        self.subtitles(img, t, b)
        return img

    # ---- シーン5: 返信を打つ(スマホのクローズアップ)
    def scene_reply(self, t, b, phase):
        T = self.g.t0 + t
        u = (T - self.T_reply) / (self.T_morning - self.T_reply)
        u = max(0.0, min(1.0, u))
        typed = int(len(REPLY) * min(1.0, u / 0.82))
        sent = u >= 0.93
        scr = phone_screen("message", big=True, typed=typed, caret=(int(t * 2) % 2 == 0), sent=sent)
        img = Image.new("RGB", (W, H), (84, 66, 54))
        arr = np.array(img).astype(float)
        ys, xs = np.mgrid[0:H, 0:W]
        d2 = np.sqrt(((xs - 900) / 1.0) ** 2 + ((ys - 200) / 1.1) ** 2)
        arr += (np.exp(-d2 / 900) * 70)[:, :, None] * (np.array(AMBER, float) / 255.0)[None, None, :]
        arr += K.noise_layer(W, H, 13, 3.0)[:, :, None]
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        # 本体
        pw, ph = 980, 1860
        body = Image.new("RGBA", (pw + 120, ph + 120), (0, 0, 0, 0))
        bd = ImageDraw.Draw(body)
        bd.rounded_rectangle([60, 60, 60 + pw, 60 + ph], radius=120, fill=PHONE_BODY + (255,), outline=(70, 72, 82, 255), width=6)
        mask = Image.new("L", scr.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, scr.width - 1, scr.height - 1], radius=96, fill=255)
        body.paste(scr, (60 + (pw - scr.width) // 2, 60 + (ph - scr.height) // 2), mask)
        body = body.rotate(-4 + 1.5 * math.sin(t * 0.6), resample=Image.BICUBIC, expand=True)
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle([90, 200, W - 60, 1780], radius=100, fill=(0, 0, 0, 150))
        sh = sh.filter(ImageFilter.GaussianBlur(30))
        img.paste(sh, (0, 0), sh)
        img.paste(body, (int(W / 2 - body.width / 2), int(1000 - body.height / 2 + 40 * u)), body)
        img = self.finish(img, t, "dawn", 60, do_bloom=False, grain=0.8)
        img = self.punch(img, t, 0.008)
        self.subtitles(img, t, b)
        return img

    # ---- シーン6: 朝(送信後、引きの俯瞰、フェードアウト)
    def scene_morning(self, t, b, phase):
        T = self.g.t0 + t
        u = (T - self.T_morning) / (self.T_end - self.T_morning)
        u = max(0.0, min(1.0, u))
        flat = table_flat(1.0)
        draw_glass_flat(flat, GLASS_C, GLASS_R, warm=1.0)
        draw_tablet_flat(flat, (GLASS_C[0] + 235, GLASS_C[1] + 120), 44, standing=True, warm=1.0, shadow_len=260)
        draw_line_flat(flat, 1.0, alpha=235)
        draw_phone_flat(flat, PHONE_C, -8, "message", brightness=0.9, typed=len(REPLY), sent=True)
        flat = dawn_sweep(flat, 1.0, strength=0.85)
        img = self.camera(flat, t, push=0.5 - 0.5 * ease(u), bump=0.0)
        img = self.finish(img, t, "dawn", 70, do_bloom=True, grain=0.8)
        img = self.punch(img, t, 0.012)
        self.subtitles(img, t, b)
        if u > 0.86:
            k = ease((u - 0.86) / 0.14)
            img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), Image.new("L", (W, H), int(255 * k)))
        return img

    def render(self, t):
        b, phase = self.g.at(t)
        T = self.g.t0 + t
        if T < self.T_hook:
            return self.scene_break(t, b, phase)
        if T < self.T_quiet:
            return self.scene_rim(t, b, phase)
        if T < self.T_ret:
            return self.scene_still(t, b, phase)
        if T < self.T_reply:
            return self.scene_dawn(t, b, phase)
        if T < self.T_morning:
            return self.scene_reply(t, b, phase)
        return self.scene_morning(t, b, phase)


def locate_sections(bt, song):
    """拍ごとの音量から、ブレイク頭・サビ頭・小休止・復帰・句切れの拍番号を求める。"""
    import librosa
    y, sr = librosa.load(song, sr=22050, mono=True)
    rms = librosa.feature.rms(y=y, hop_length=512)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=512)
    per = []
    for i in range(len(bt) - 1):
        m = (times >= bt[i]) & (times < bt[i + 1])
        per.append(float(rms[m].mean()) if m.any() else 0.0)
    per = np.array(per)

    def find(lo, hi, sign, win=2):
        best = None
        for i in range(win, len(per) - win):
            if lo <= bt[i] <= hi:
                sc = (per[i:i + win].mean() - per[i - win:i].mean()) * sign
                if best is None or sc > best[0]:
                    best = (sc, i)
        return best[1]

    return dict(iA=find(185, 190, -1), hook=find(196, 200, +1), quiet=find(203, 207, -1), ret=find(211, 215, +1),
                dip230=find(229, 231.5, -1), end=find(237, 239.5, -1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--song", required=True)
    ap.add_argument("--out", default="animatic.mp4")
    ap.add_argument("--stills")
    ap.add_argument("--out-dir", default="stills")
    ap.add_argument("--grid-json")
    args = ap.parse_args()
    bt = K.beat_grid(args.song, args.grid_json)
    sec_cache = (args.grid_json + ".sections") if args.grid_json else None
    if sec_cache and os.path.exists(sec_cache):
        secs = json.load(open(sec_cache))
    else:
        secs = locate_sections(bt, args.song)
        if sec_cache:
            json.dump({k: int(v) for k, v in secs.items()}, open(sec_cache, "w"))
    grid = K.Grid(bt, secs["iA"], secs["end"])
    rel = {k: secs[k] - secs["iA"] for k in ("hook", "quiet", "ret", "dip230")}
    print(f"cut: {grid.t0:.3f}s + {grid.dur:.2f}s  sections(rel beats): {rel}")
    anim = Animatic(grid, rel)
    if args.stills:
        os.makedirs(args.out_dir, exist_ok=True)
        for s in args.stills.split(","):
            t = float(s)
            b, _ = grid.at(t)
            anim.render(t).save(os.path.join(args.out_dir, f"t{t:05.2f}_b{b:03d}.png"))
            print("still", t, "beat", b)
        return
    K.render_video(anim, grid, args.song, args.out)


if __name__ == "__main__":
    main()
