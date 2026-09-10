#!/usr/bin/env python3
"""イラスト(レイヤー PNG / 動画クリップ)を読み込んで 2.5D で動かすコンポジター。

アニマティックで決めたカット割り・タイミングをそのまま使い、絵だけを生成イラストに差し替えるための道具。
レイヤーごとの奥行き(パララックス)、カメラの寄り・ずらし、被写界深度、光の掃引、埃、ブルーム、粒子、字幕を付ける。
足りないレイヤーは仮の絵(灰色の枠にファイル名)になるので、素材が揃う前でも通しで確認できる。

使い方:
  python3 compose.py --spec shots.json --song SONG.mp3 --out out.mp4
  python3 compose.py --spec shots.json --song SONG.mp3 --stills 1.0,12.0 --out-dir stills/

shots.json の形式は README を参照。
"""
import argparse
import importlib.util
import json
import math
import os
import subprocess
import sys
import tempfile
import types

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mvkit as K  # noqa: E402
from mvkit import W, H, FPS, ease, lerp, font, paste_center, caption_hook  # noqa: E402

_img_cache = {}
_video_cache = {}


# ---------------------------------------------------------------- 素材
def load_image(path, base_dir):
    full = path if os.path.isabs(path) else os.path.join(base_dir, path)
    if full in _img_cache:
        return _img_cache[full]
    if os.path.exists(full):
        im = Image.open(full).convert("RGBA")
    else:
        im = placeholder(os.path.basename(path))
    _img_cache[full] = im
    return im


def placeholder(label, size=(1080, 1920)):
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([12, 12, size[0] - 12, size[1] - 12], radius=40, fill=(90, 94, 104, 200), outline=(200, 204, 212, 220), width=6)
    d.text((size[0] / 2, size[1] / 2), label, font=font(40), fill=(230, 232, 236, 255), anchor="mm")
    d.text((size[0] / 2, size[1] / 2 + 60), "(仮のレイヤー: この名前で画像を置く)", font=font(26), fill=(200, 204, 212, 255), anchor="mm")
    return im


def video_frame(path, base_dir, t_local, fps=FPS, loop=True):
    """動画クリップの t_local 秒のフレーム(RGBA)。初回にフレーム列へ展開してキャッシュ。"""
    full = path if os.path.isabs(path) else os.path.join(base_dir, path)
    if full not in _video_cache:
        if not os.path.exists(full):
            _video_cache[full] = None
        else:
            d = tempfile.mkdtemp(prefix="compose_clip_")
            subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-y", "-i", full, "-r", str(fps), os.path.join(d, "f%05d.png")], check=True)
            _video_cache[full] = sorted(os.path.join(d, f) for f in os.listdir(d))
    frames = _video_cache[full]
    if not frames:
        return placeholder(os.path.basename(path))
    i = int(t_local * fps)
    if loop and len(frames) > 1:
        # 往復ループ(端でパタンと戻らない)
        n = len(frames)
        i = i % (2 * n - 2)
        i = i if i < n else 2 * n - 2 - i
    i = max(0, min(len(frames) - 1, i))
    return Image.open(frames[i]).convert("RGBA")


def render_fizz(size, p, T, tint=(255, 255, 255)):
    """円形の水面領域に、縮む錠剤・白い濁り・上がる泡・波紋を描く(RGBA、size×size)。p: 0→1 で溶けきる。"""
    import math
    import random
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = cy = size / 2
    r = size * 0.42
    haze = int(150 * math.sin(math.pi * p))
    if haze > 0:
        hz = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(hz).ellipse([cx - r * 0.7, cy - r * 0.7, cx + r * 0.7, cy + r * 0.7], fill=tint + (haze // 2,))
        im.alpha_composite(hz.filter(ImageFilter.GaussianBlur(size * 0.05)))
    tr = r * 0.30 * max(0.0, 1 - p / 0.7)
    if tr > 2:
        d.ellipse([cx - tr, cy - tr, cx + tr, cy + tr], fill=(244, 242, 236, 235))
        d.line([(cx - tr * 0.6, cy), (cx + tr * 0.6, cy)], fill=(214, 210, 202, 255), width=max(1, int(tr * 0.08)))
    rng = random.Random(3)
    for i in range(110):
        ang = rng.uniform(0, 2 * math.pi)
        sp = rng.uniform(0.3, 1.0)
        life = (p * 3.0 * sp + rng.random()) % 1.0
        rad = r * 0.85 * life
        bx, by = cx + rad * math.cos(ang), cy + rad * math.sin(ang)
        br = rng.uniform(2, 6) * (1 - life * 0.5) * size / 900
        d.ellipse([bx - br, by - br, bx + br, by + br], fill=tint + (int(210 * (1 - life) * (1 - p * 0.6)),))
    for i in range(3):
        rr = r * ((T * 0.9 + i * 0.33) % 1.0)
        a = int(80 * (1 - (T * 0.9 + i * 0.33) % 1.0) * (1 - p * 0.5))
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=tint + (a,), width=max(1, int(size * 0.003)))
    return im


def ripple(img, rp, T):
    """楕円領域の中を水面のように揺らす(正弦波の変位)。rp: {"x","y","w","h"(画面比), "amp"(px), "speed"}"""
    from scipy.ndimage import map_coordinates
    cx, cy = rp["x"] * W, rp["y"] * H
    rw, rh = rp["w"] * W / 2, rp["h"] * H / 2
    x0, y0 = int(max(0, cx - rw)), int(max(0, cy - rh))
    x1, y1 = int(min(W, cx + rw)), int(min(H, cy + rh))
    if x1 - x0 < 8 or y1 - y0 < 8:
        return img
    region = np.array(img.crop((x0, y0, x1, y1))).astype(np.float32)
    h, w = region.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    nx, ny = (xs - w / 2) / (w / 2), (ys - h / 2) / (h / 2)
    inside = np.clip(1.0 - np.sqrt(nx * nx + ny * ny), 0, 1) ** 0.7
    amp, sp = rp.get("amp", 3.0), rp.get("speed", 1.0)
    dx = amp * inside * (np.sin(ys * 0.11 + T * 2.1 * sp) + 0.6 * np.sin((xs + ys) * 0.07 - T * 1.6 * sp))
    dy = amp * inside * (np.cos(xs * 0.09 + T * 1.7 * sp) + 0.6 * np.sin(ys * 0.13 + T * 2.4 * sp))
    out = np.empty_like(region)
    for c in range(3):
        out[..., c] = map_coordinates(region[..., c], [ys + dy, xs + dx], order=1, mode="nearest")
    # ハイライトのきらめき
    glint = (np.clip(np.sin(xs * 0.05 + T * 3.0 * sp) * np.sin(ys * 0.04 - T * 2.2 * sp), 0, 1) ** 6) * inside * rp.get("glint", 18)
    out += glint[..., None]
    img.paste(Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)), (x0, y0))
    return img


def load_procedural(spec_dir, module_name):
    """曲側のスクリプト(例: animatic.py)から関数を借りる(スマホ画面などの手続き描画)。"""
    path = os.path.join(spec_dir, module_name + ".py")
    if not os.path.exists(path):
        return None
    spec = importlib.util.spec_from_file_location("proc_" + module_name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.argv = [sys.argv[0]]
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------- 補間
def interp_camera(cam, u):
    a, b = cam.get("from", {}), cam.get("to", {})
    e = {"smooth": ease, "linear": lambda x: x, "out": lambda x: 1 - (1 - x) ** 3, "in": lambda x: x ** 3}[cam.get("ease", "smooth")](u)
    out = {}
    for k, default in (("zoom", 1.0), ("x", 0.0), ("y", 0.0), ("rot", 0.0)):
        out[k] = lerp(a.get(k, default), b.get(k, default), e)
    return out


def layer_value(layer, key, default, u):
    """レイヤー属性のキーフレーム対応: 値 or {"from":..,"to":..}。"""
    v = layer.get(key, default)
    if isinstance(v, dict):
        return lerp(v.get("from", default), v.get("to", default), ease(u))
    return v


# ---------------------------------------------------------------- 描画
class Composer:
    def __init__(self, spec, spec_dir, song_t0, song_dur, beats=None):
        self.spec = spec
        self.dir = spec_dir
        self.t0 = song_t0
        self.dur = song_dur
        self.beats = beats  # 拍位置(絶対秒)。punch(拍同期の寄り)に使う
        if spec.get("accent"):
            K.ACCENT = tuple(spec["accent"])
        self.tl = K.LyricTimeline(os.path.join(spec_dir, spec["lyrics"]), lead=spec.get("lyric_lead", 0.25),
                                  end_time=song_t0 + song_dur) if spec.get("lyrics") else None
        self.proc = load_procedural(spec_dir, spec["procedural_module"]) if spec.get("procedural_module") else None
        self.shots = sorted(spec["shots"], key=lambda s: s["start"])

    def shot_at(self, T):
        for s in self.shots:
            if s["start"] <= T < s["end"]:
                return s
        return self.shots[-1] if T >= self.shots[-1]["end"] else self.shots[0]

    def render(self, t):
        T = self.t0 + t
        shot = self.shot_at(T)
        u = (T - shot["start"]) / max(1e-6, shot["end"] - shot["start"])
        u = max(0.0, min(1.0, u))
        cam = interp_camera(shot.get("camera", {}), u)
        # 手持ちの揺れ(画面比、ごく小さく)とカット頭の寄り
        drift = shot.get("drift", 0.004)
        cam["x"] += drift * (math.sin(T * 0.7) + 0.6 * math.sin(T * 1.9 + 1.3))
        cam["y"] += drift * 0.8 * math.sin(T * 0.9 + 0.4)
        cut_in = shot.get("cut_punch", 0.03)
        if cut_in and T - shot["start"] < 0.35:
            cam["zoom"] *= 1 + cut_in * (1 - ease((T - shot["start"]) / 0.35))
        # 拍同期のパンチイン: fx "punch:振幅"
        amp = next((float(f.split(":")[1]) for f in shot.get("fx", []) if f.startswith("punch")), 0.0)
        if amp and self.beats is not None:
            k = int(np.searchsorted(self.beats, T, side="right") - 1)
            if 0 <= k < len(self.beats) - 1:
                phase = (T - self.beats[k]) / (self.beats[k + 1] - self.beats[k])
                cam["zoom"] *= 1 + amp * math.exp(-phase * 7.0)
        img = Image.new("RGB", (W, H), tuple(shot.get("bg_color", [12, 14, 20])))
        for layer in shot.get("layers", []):
            if "from_t" in layer and T < layer["from_t"]:
                continue
            if "until" in layer and T >= layer["until"]:
                continue
            if layer.get("optional"):
                ref = layer.get("video") or layer.get("file")
                if ref and not os.path.exists(os.path.join(self.dir, ref)):
                    continue  # 素材がまだ無い: 下のレイヤーに任せる
            self.draw_layer(img, layer, T, u, cam)
        for rp in shot.get("ripples", []):
            if rp.get("from_t", 0) <= T < rp.get("until", 1e9):
                img = ripple(img, rp, T)
        img = self.effects(img, shot, T, u)
        if "caption" in shot:
            c = shot["caption"]
            if T < c.get("until", shot["end"]):
                a = min(1.0, (T - shot["start"]) / 0.15, (c.get("until", shot["end"]) - T) / 0.3)
                paste_center(img, caption_hook(c["text"]), W / 2, c.get("y", 372), max(0.0, a))
        if self.tl and shot.get("subtitles", True):
            self.tl.draw(img, T, y=shot.get("subtitle_y", 1420), kinetic=self.spec.get("lyric_style") == "kinetic")
        # フェード
        if shot.get("fade_in") and T - shot["start"] < shot["fade_in"]:
            k = 1 - (T - shot["start"]) / shot["fade_in"]
            img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), Image.new("L", (W, H), int(255 * ease(k))))
        if shot.get("fade_out") and shot["end"] - T < shot["fade_out"]:
            k = 1 - (shot["end"] - T) / shot["fade_out"]
            img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), Image.new("L", (W, H), int(255 * ease(k))))
        return img

    def draw_layer(self, img, layer, T, u, cam):
        depth = layer.get("depth", 0.0)  # 0 = 一番奥、1 = 一番手前
        ltype = layer.get("type", "image")
        if ltype == "phone_ui" and self.proc is not None:
            state = layer.get("state", "off")
            src = self.proc.phone_screen(state, big=layer.get("big", False), typed=int(layer_value(layer, "typed", 0, u)),
                                         caret=(int(T * 2) % 2 == 0), sent=bool(layer.get("sent", False))).convert("RGBA")
            mask = Image.new("L", src.size, 0)
            ImageDraw.Draw(mask).rounded_rectangle([0, 0, src.width - 1, src.height - 1], radius=int(src.width * 0.11), fill=255)
            src.putalpha(mask)
        elif ltype == "fizz":
            # 発泡の手続き描画(動画生成なしで「錠剤が溶ける」を作る)
            t_from = layer.get("from_t", self.shot_at(T)["start"])
            t_to = layer.get("until", self.shot_at(T)["end"])
            p = max(0.0, min(1.0, (T - t_from) / max(0.1, t_to - t_from)))
            src = render_fizz(int(layer.get("px", 900)), p, T, tint=tuple(layer.get("tint", [255, 255, 255])))
        elif "video" in layer:
            base = layer.get("from_t", self.shot_at(T)["start"])
            local = (T - base) * layer.get("speed", 1.0) + layer.get("clip_start", 0.0)
            src = video_frame(layer["video"], self.dir, local, loop=layer.get("loop", True))
        else:
            src = load_image(layer["file"], self.dir)
        # 大きさ: w(画面幅に対する比) か cover
        zoom_eff = 1 + (cam["zoom"] - 1) * (0.75 + 0.5 * depth)
        pan_x = cam["x"] * W * (0.5 + 0.9 * depth)
        pan_y = cam["y"] * H * (0.5 + 0.9 * depth)
        if layer.get("fit") == "cover":
            scale = max(W / src.width, H / src.height) * zoom_eff * layer_value(layer, "scale", 1.0, u)
            cx, cy = W / 2 - pan_x, H / 2 - pan_y
        else:
            wfrac = layer_value(layer, "w", 0.3, u)
            scale = (wfrac * W / src.width) * zoom_eff
            lx = layer_value(layer, "x", 0.5, u)
            ly = layer_value(layer, "y", 0.5, u)
            # ズームは画面中心基準
            cx = W / 2 + (lx * W - W / 2) * zoom_eff - pan_x
            cy = H / 2 + (ly * H - H / 2) * zoom_eff - pan_y
        rot = layer_value(layer, "rot", 0.0, u) + cam["rot"] * (0.5 + 0.5 * depth)
        sw, sh = max(1, int(src.width * scale)), max(1, int(src.height * scale))
        im = src.resize((sw, sh), Image.LANCZOS if scale < 1 else Image.BICUBIC)
        if rot:
            im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
        op = layer_value(layer, "opacity", 1.0, u)
        if op < 1.0:
            im = im.copy()
            im.putalpha(Image.fromarray((np.array(im.getchannel("A")) * op).astype(np.uint8)))
        blur = layer_value(layer, "blur", 0.0, u)
        if blur > 0:
            im = im.filter(ImageFilter.GaussianBlur(blur))
        if "reveal" in layer:
            # 上から下へ描き進める(線など)。reveal: {"from_t", "to_t"}
            rv = layer["reveal"]
            p = (T - rv["from_t"]) / max(0.1, rv["to_t"] - rv["from_t"])
            p = max(0.0, min(1.0, p))
            m = Image.new("L", im.size, 0)
            ImageDraw.Draw(m).rectangle([0, 0, im.width, int(im.height * ease(p))], fill=255)
            m = m.filter(ImageFilter.GaussianBlur(6))
            im = im.copy()
            im.putalpha(Image.fromarray(np.minimum(np.array(im.getchannel("A")), np.array(m))))
        if layer.get("shadow"):
            sh_ = Image.new("RGBA", im.size, (0, 0, 0, 0))
            sh_.paste(Image.new("RGBA", im.size, (0, 0, 0, int(255 * layer["shadow"].get("alpha", 0.5)))), (0, 0), im.getchannel("A"))
            sh_ = sh_.filter(ImageFilter.GaussianBlur(layer["shadow"].get("blur", 14)))
            dx, dy = layer["shadow"].get("offset", [16, 24])
            img.paste(sh_, (int(cx - im.width / 2 + dx), int(cy - im.height / 2 + dy)), sh_)
        img.paste(im, (int(cx - im.width / 2), int(cy - im.height / 2)), im)

    def effects(self, img, shot, T, u):
        fx = shot.get("fx", [])
        for f in fx:
            name, _, arg = f.partition(":")
            if name == "light_sweep":
                # arg: "start,end,strength" 絶対秒。右→左に暖色の光
                a, b, st = (arg.split(",") + ["0.8"])[:3]
                frac = (T - float(a)) / max(0.1, float(b) - float(a))
                if frac > 0:
                    frac = min(1.0, frac)
                    xs = np.mgrid[0:H // 4, 0:W // 4][1] * 4
                    boundary = W + 200 - frac * (W + 700)
                    m = np.clip((xs - boundary) / 300.0, 0, 1) * 255 * float(st)
                    mask = Image.fromarray(m.astype(np.uint8)).resize((W, H), Image.BILINEAR)
                    warm = ImageEnhance.Brightness(ImageChops.screen(img, Image.new("RGB", (W, H), (64, 44, 22)))).enhance(1.04)
                    img = Image.composite(warm, img, mask)
            elif name == "glow":
                # arg: "x,y,radius,r,g,b,alpha" 画面比
                x, y, r, cr, cg, cb, al = [float(v) for v in arg.split(",")]
                g = K.glow_sprite(int(r), (int(cr), int(cg), int(cb))).copy()
                g.putalpha(Image.fromarray((np.array(g.getchannel("A")) * al).astype(np.uint8)))
                img.paste(g, (int(x * W - g.width / 2), int(y * H - g.height / 2)), g)
            elif name == "dust":
                d = ImageDraw.Draw(img, "RGBA")
                rng = np.random.default_rng(7)
                n = int(arg or 40)
                base = rng.uniform(0, 1, (n, 2))
                for i in range(n):
                    x = base[i, 0] * W + 24 * math.sin(T * 0.5 + i)
                    y = (base[i, 1] * H - (T * 9 + i * 13) % H) % H
                    rr = 1.5 + (i % 3)
                    d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(255, 250, 240, 90))
            elif name == "dof":
                img = Image.composite(img.filter(ImageFilter.GaussianBlur(float(arg or 6))), img, K.tilt_mask())
        if "bloom" in fx or any(f.startswith("bloom") for f in fx):
            img = K.bloom(img, threshold=190, strength=0.5, radius=16)
        img = K.grade(img, shot.get("grade", self.spec.get("grade", "gray")))
        vig = next((float(f.split(":")[1]) for f in fx if f.startswith("vignette")), 70)
        K.apply_vignette(img, vig)
        grain = next((float(f.split(":")[1]) for f in fx if f.startswith("grain")), 0.8)
        return K.apply_grain(img, int(T * 1000), grain)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--song", required=True)
    ap.add_argument("--out", default="illustrated.mp4")
    ap.add_argument("--stills")
    ap.add_argument("--out-dir", default="stills")
    ap.add_argument("--grid-json", help="拍解析のキャッシュ")
    args = ap.parse_args()
    spec = json.load(open(args.spec, encoding="utf-8"))
    spec_dir = os.path.dirname(os.path.abspath(args.spec))
    cut = spec["cut"]
    t0, dur = float(cut["start"]), float(cut["end"]) - float(cut["start"])
    beats = K.beat_grid(args.song, args.grid_json) if spec.get("beats", True) else None
    comp = Composer(spec, spec_dir, t0, dur, beats=beats)
    grid = types.SimpleNamespace(t0=t0, dur=dur)
    if args.stills:
        os.makedirs(args.out_dir, exist_ok=True)
        for s in args.stills.split(","):
            t = float(s)
            comp.render(t).save(os.path.join(args.out_dir, f"t{t:06.2f}.png"))
            print("still", t)
        return
    K.render_video(comp, grid, args.song, args.out, lead=float(cut.get("lead", 0.0)))


if __name__ == "__main__":
    main()
