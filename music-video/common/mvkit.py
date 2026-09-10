"""音楽ショート・アニマティック共通基盤(mvkit)。

paper-plane-royalty/animatic.py v2 から切り出した描画・後処理・字幕・拍グリッド・出力のユーティリティ。
"""
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
_cache = {}
_font_cache = {}
PINK = (255, 79, 163)
ACCENT = PINK  # 字幕ブロックのアクセント色(曲ごとに差し替え可)


def A_translate(tx, ty):
    return np.array([[1, 0, tx], [0, 1, ty], [0, 0, 1]], float)


def A_rotate(theta):
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], float)


def A_scale(k):
    return np.array([[k, 0, 0], [0, k, 0], [0, 0, 1]], float)


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


def find_coeffs(target, source):
    """PIL の PERSPECTIVE 係数(出力→入力)。target: 出力四隅、source: 入力四隅。"""
    m = []
    for (x, y), (u, v) in zip(target, source):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    A = np.array(m, float)
    B = np.array(source, float).reshape(8)
    return tuple(np.linalg.solve(A, B))


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


def tilt_mask():
    if "tilt" not in _cache:
        ys = np.arange(H) / H
        a = np.clip((0.30 - ys) / 0.30, 0, 1) ** 1.4 + np.clip((ys - 0.86) / 0.14, 0, 1) ** 1.4
        m = np.tile((a * 255).astype(np.uint8)[:, None], (1, W))
        _cache["tilt"] = Image.fromarray(m)
    return _cache["tilt"]


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


def bloom(img, threshold=200, strength=0.55, radius=14):
    arr = np.array(img).astype(np.int16)
    bright = np.clip((arr - threshold) * 4, 0, 255).astype(np.uint8)
    b = Image.fromarray(bright).resize((W // 4, H // 4), Image.BILINEAR).filter(ImageFilter.GaussianBlur(radius / 2))
    b = b.resize((W, H), Image.BILINEAR)
    b = ImageEnhance.Brightness(b).enhance(strength)
    return ImageChops.screen(img, b)


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
    max_w = W - 140

    def fit(text, size, fill, tracking, stroke=0, min_size=30):
        layer = tracked_text(text, size, fill, tracking=tracking, stroke=stroke)
        while layer.width > max_w and size > min_size:
            size -= 4
            layer = tracked_text(text, size, fill, tracking=tracking, stroke=stroke)
        return layer

    if en:
        parts.append(fit(en, 66, (255, 255, 255, 255), 2, stroke=1))
        if jp:
            parts.append(fit(jp, 38, (255, 255, 255, 216), 3, min_size=26))
    else:
        parts.append(fit(jp, 68, (255, 255, 255, 255), 5, stroke=1))
    gap = 14
    hgt = sum(p.height for p in parts) + gap * (len(parts) - 1) + (26 if en and jp else 0) + 40
    wid = max(p.width for p in parts) + 40
    layer = Image.new("RGBA", (wid, hgt), (0, 0, 0, 0))
    y = 20
    for i, p in enumerate(parts):
        layer.alpha_composite(p, (int((wid - p.width) / 2), y))
        y += p.height + gap
        if en and jp and i == 0:
            ImageDraw.Draw(layer).rectangle([wid / 2 - 22, y - 2, wid / 2 + 22, y + 1], fill=ACCENT + (230,))
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


def render_video(anim, grid, song, out, fps=FPS, lead=0.0):
    """lead 秒だけ音源を早く始め、その間は先頭フレームを静止させる(歌い出しの頭切れ防止)。"""
    seg = out + ".seg.wav"
    subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-y", "-i", song, "-ss", f"{grid.t0 - lead:.3f}",
                    "-t", f"{grid.dur + lead:.3f}", "-ar", "48000", "-ac", "2", seg], check=True)
    n = int(round((grid.dur + lead) * fps))
    n_lead = int(round(lead * fps))
    cmd = ["ffmpeg", "-hide_banner", "-v", "error", "-y",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-",
           "-i", seg, "-map", "0:v", "-map", "1:a",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(fps),
           "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-movflags", "+faststart", "-shortest", out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    first = None
    for i in range(n):
        if i < n_lead:
            if first is None:
                first = anim.render(0.0)
            frame = first
        else:
            frame = anim.render((i - n_lead) / fps)
        p.stdin.write(frame.tobytes())
        if i % 150 == 0:
            print(f"  frame {i}/{n}", flush=True)
    p.stdin.close()
    p.wait()
    os.remove(seg)
    print(f"OK: {out} ({n} frames, {grid.dur:.2f}s)")


def grade(img, mode="gray"):
    """簡易カラーグレード。gray=青寄りの灰色, color=暖色, night=深い青, dawn=琥珀。"""
    key = ("lut", mode)
    if key not in _cache:
        x = np.arange(256) / 255.0
        s_curve = np.clip(0.5 + 1.08 * (x - 0.5) + 0.06 * np.sin(2 * math.pi * x), 0, 1)
        presets = {
            "gray": (0.975, 0.008, 0.99, 0.006, 1.03, 0.02),
            "color": (1.03, 0.01, 1.0, 0.008, 0.97, 0.012),
            "night": (0.93, 0.0, 0.97, 0.006, 1.08, 0.03),
            "dawn": (1.06, 0.02, 1.0, 0.01, 0.92, 0.0),
        }
        ra, rb, ga, gb, ba, bb = presets[mode]
        r = np.clip(s_curve * ra + rb, 0, 1)
        g = np.clip(s_curve * ga + gb, 0, 1)
        b = np.clip(s_curve * ba + bb, 0, 1)
        _cache[key] = [int(v * 255) for v in r] + [int(v * 255) for v in g] + [int(v * 255) for v in b]
    return img.point(_cache[key])


def perspective_camera(flat, fw, fh, fcx, fcy, t, push=0.0, bump=0.0, drift=1.0, dof=6, top_w=1440, bot_w=990,
                       top_dy=900, bot_dy=940):
    """平面キャンバス → 俯瞰カメラ(パース + 手持ちの揺れ + 押し寄せ + 被写界深度)。"""
    dx = drift * (5 * math.sin(t * 0.7) + 3 * math.sin(t * 1.9 + 1.3))
    dy = drift * (4 * math.sin(t * 0.9 + 0.4)) + bump
    k = 1.0 - 0.05 * push
    tw, bw = top_w * k, bot_w * k
    ty, by = fcy - top_dy * k, fcy + bot_dy * k
    srcq = [(fcx - tw / 2 + dx, ty + dy), (fcx + tw / 2 + dx, ty + dy), (fcx + bw / 2 + dx, by + dy), (fcx - bw / 2 + dx, by + dy)]
    coeffs = find_coeffs([(0, 0), (W, 0), (W, H), (0, H)], srcq)
    img = flat.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BILINEAR)
    if dof > 0:
        img = Image.composite(img.filter(ImageFilter.GaussianBlur(dof)), img, tilt_mask())
    return img


def beat_grid(song, cache=None):
    """拍位置(秒)の配列を返す。cache に JSON パスを渡すと再利用。"""
    if cache and os.path.exists(cache):
        return np.array(json.load(open(cache))["bt"])
    import librosa
    y, sr = librosa.load(song, sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    bt = np.array(beats)
    if cache:
        json.dump({"bt": bt.tolist(), "tempo": float(np.atleast_1d(tempo)[0])}, open(cache, "w"))
    return bt


class Grid:
    """カットの開始拍 iA から終了拍 iEnd まで。at(t) は (開始からの拍番号, 拍内位相)。"""

    def __init__(self, bt, iA, iEnd):
        self.bt = bt
        self.iA = iA
        self.iEnd = iEnd
        self.t0 = float(bt[iA])
        self.dur = float(bt[iEnd] - bt[iA])

    def at(self, t_rel):
        T = self.t0 + t_rel
        k = int(np.searchsorted(self.bt, T, side="right") - 1)
        k = max(0, min(len(self.bt) - 2, k))
        phase = (T - self.bt[k]) / (self.bt[k + 1] - self.bt[k])
        return k - self.iA, float(max(0.0, min(1.0, phase)))

    def bt_rel(self, b):
        return float(self.bt[self.iA + b] - self.t0)


def fade_alpha(t, t_in, t_out, fi=0.3, fo=0.25):
    return max(0.0, min(1.0, (t - t_in) / fi, (t_out - t) / fo))


class LyricTimeline:
    """歌詞行の絶対秒タイムライン。JSON: [{"t": 187.95, "en": "...", "jp": "..."}, ...]
    行の終わりは次の行の開始。字幕は歌い出しの lead 秒前に出す。"""

    def __init__(self, path, lead=0.25, gap=0.12, max_len=6.0, end_time=None):
        self.lines = json.load(open(path, encoding="utf-8"))
        self.lead, self.gap, self.max_len, self.end_time = lead, gap, max_len, end_time

    def span(self, i):
        t0 = self.lines[i]["t"] - self.lead
        nxt = self.lines[i + 1]["t"] - self.lead if i + 1 < len(self.lines) else (self.end_time or t0 + self.max_len)
        t1 = min(nxt - self.gap, t0 + self.max_len)
        return t0, max(t1, t0 + 0.5)

    def start(self, key):
        """key: 行番号 or 英語/日本語の歌詞(最初に一致した行)の歌い出し(絶対秒)。"""
        if isinstance(key, int):
            return self.lines[key]["t"]
        for ln in self.lines:
            if ln.get("en") == key or ln.get("jp") == key:
                return ln["t"]
        raise KeyError(key)

    def draw(self, img, T, y=1420):
        for i, ln in enumerate(self.lines):
            t0, t1 = self.span(i)
            if t0 <= T < t1:
                a = fade_alpha(T, t0, t1, 0.28, 0.22)
                paste_center(img, lyric_block(ln.get("en"), ln.get("jp")), W / 2, y, a)
                return
