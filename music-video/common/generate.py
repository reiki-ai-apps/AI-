#!/usr/bin/env python3
"""発注書(gen_manifest.json)どおりに Gemini API で絵と動画を生成し、art/ に納品するランナー。

  python3 generate.py --manifest ../not-your-medicine/gen_manifest.json [--only id1,id2] [--force] [--dry]

manifest:
{
  "style_suffix": "…(全プロンプト末尾に付ける画風指定)",
  "assets": [
    {"id": "01_table_night_bg", "type": "image", "prompt": "…", "aspect": "9:16", "out": "art/01_table_night_bg.png", "refs": []},
    {"id": "obj_phone", "type": "object", "prompt": "…", "aspect": "1:1", "out": "art/obj_phone.png", "refs": ["01_table_night_bg"]},
    {"id": "01b_fizz", "type": "video", "prompt": "…", "image": "01_table_night_bg", "crop": [0.45, 0.42, 0.95, 0.80], "seconds": 8, "out": "art/01b_fizz.mp4"}
  ]
}
- image: そのまま保存。refs は先に生成した id(画風・物の一貫性のための参照画像)。
- object: 真緑の無地背景で生成し、クロマキーで透過 PNG にして保存(物のレイヤー用)。
- video: image(id)の crop 範囲を 9:16 に切り出し、Veo の image-to-video で動かす。
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_google as G  # noqa: E402

GREEN_HINT = (" The subject is isolated on a flat, solid, evenly lit pure green (#00FF00) background, "
              "no shadow on the background, no other objects, centered, whole object visible with margin.")


def chroma_key(src_path, out_path, margin=24):
    im = Image.open(src_path).convert("RGB")
    a = np.array(im).astype(float) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # 緑らしさ: G が R,B より十分大きい
    greenness = g - np.maximum(r, b)
    alpha = np.clip((0.32 - greenness) / 0.22, 0, 1)  # 緑が強いほど透明
    alpha = np.array(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(float) / 255.0
    # スピル除去: 縁の緑かぶりを抑える
    spill = np.clip(g - (r + b) / 2, 0, 1)
    g2 = g - spill * 0.8
    rgb = np.stack([r, g2, b], axis=-1)
    rgba = np.concatenate([np.clip(rgb, 0, 1), alpha[..., None]], axis=-1)
    out = Image.fromarray((rgba * 255).astype(np.uint8), "RGBA")
    # 物の範囲で切り出す
    ys, xs = np.where(alpha > 0.5)
    if len(xs):
        x0, x1 = max(0, xs.min() - margin), min(out.width, xs.max() + margin)
        y0, y1 = max(0, ys.min() - margin), min(out.height, ys.max() + margin)
        out = out.crop((x0, y0, x1, y1))
    out.save(out_path)
    return out_path


def crop_for_video(src_path, crop, out_path):
    im = Image.open(src_path).convert("RGB")
    x0, y0, x1, y1 = [int(v * s) for v, s in zip(crop, (im.width, im.height, im.width, im.height))]
    region = im.crop((x0, y0, x1, y1))
    # 9:16 に合わせて中央を切る
    target = 9 / 16
    w, h = region.size
    if w / h > target:
        nw = int(h * target)
        region = region.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w / target)
        region = region.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    region = region.resize((1080, 1920), Image.LANCZOS)
    region.save(out_path)
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--only")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry", action="store_true", help="生成せずプロンプトを表示")
    ap.add_argument("--key")
    args = ap.parse_args()
    man = json.load(open(args.manifest, encoding="utf-8"))
    base = os.path.dirname(os.path.abspath(args.manifest))
    suffix = man.get("style_suffix", "")
    only = set(args.only.split(",")) if args.only else None
    key = None if args.dry else G.key_of(args)
    done = {}
    for a in man["assets"]:
        out = os.path.join(base, a["out"])
        done[a["id"]] = out
        if only and a["id"] not in only:
            continue
        os.makedirs(os.path.dirname(out), exist_ok=True)
        if os.path.exists(out) and not args.force:
            print(f"[skip] {a['id']} (exists)")
            continue
        prompt = a["prompt"] + (" " + suffix if a["type"] != "video" else "")
        refs = [done[r] for r in a.get("refs", []) if os.path.exists(done.get(r, ""))]
        print(f"[{a['type']}] {a['id']} -> {a['out']}")
        if args.dry:
            print("   ", prompt[:300], "...")
            continue
        if a["type"] == "image":
            G.gen_image(key, prompt, out, a.get("aspect", "9:16"), refs, a.get("model"), a.get("size"))
        elif a["type"] == "object":
            raw = out.replace(".png", "_raw.png")
            G.gen_image(key, prompt + GREEN_HINT, raw, a.get("aspect", "1:1"), refs, a.get("model"), a.get("size"))
            chroma_key(raw, out)
        elif a["type"] == "video":
            start = None
            if a.get("image"):
                src = done[a["image"]]
                start = out.replace(".mp4", "_start.png")
                crop_for_video(src, a.get("crop", [0, 0, 1, 1]), start)
            G.gen_video(key, a["prompt"], out, a.get("aspect", "9:16"), start, a.get("seconds", 8), a.get("model"),
                        a.get("resolution", "1080p"))
        print("   ok")


if __name__ == "__main__":
    main()
