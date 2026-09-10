#!/usr/bin/env python3
"""Google Gemini API で画像(Nano Banana / Imagen 4)と動画(Veo 3.x)を生成する薄いクライアント。

キーは環境変数 GEMINI_API_KEY(または GOOGLE_API_KEY)か --key。
  python3 gen_google.py models                       # 使えるモデル名を確認
  python3 gen_google.py image "prompt" out.png --aspect 9:16 [--ref a.png --ref b.png] [--model ...]
  python3 gen_google.py imagen "prompt" out.png --aspect 9:16
  python3 gen_google.py video "prompt" out.mp4 --aspect 9:16 [--image start.png] [--seconds 8]
"""
import argparse
import base64
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://generativelanguage.googleapis.com/v1beta"
IMAGE_MODELS = ["gemini-3-pro-image-preview", "gemini-2.5-flash-image", "gemini-2.5-flash-image-preview"]
IMAGEN_MODELS = ["imagen-4.0-ultra-generate-001", "imagen-4.0-generate-001"]
VIDEO_MODELS = ["veo-3.1-generate-preview", "veo-3.1-fast-generate-preview", "veo-3.0-generate-001", "veo-3.0-fast-generate-001"]


def key_of(args):
    k = getattr(args, "key", None) or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not k:
        sys.exit("エラー: GEMINI_API_KEY(または --key)が必要です")
    return k


def call(method, path, key, body=None, timeout=300):
    req = urllib.request.Request(API + path, method=method, headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} {path}\n{e.read().decode()[:1500]}")


def list_models(key):
    out = []
    token = None
    while True:
        j = call("GET", "/models?pageSize=200" + (f"&pageToken={token}" if token else ""), key)
        out += j.get("models", [])
        token = j.get("nextPageToken")
        if not token:
            break
    return out


def pick_model(key, candidates, kind):
    names = {m["name"].split("/")[-1] for m in list_models(key)}
    for c in candidates:
        if c in names:
            return c
    hint = ", ".join(sorted(n for n in names if kind in n)) or "(該当なし)"
    raise SystemExit(f"エラー: {kind} 用の候補モデルが見つかりません。使えるもの: {hint}")


def b64file(path):
    mime = mimetypes.guess_type(path)[0] or "image/png"
    return {"mime_type": mime, "data": base64.b64encode(open(path, "rb").read()).decode()}


def gen_image(key, prompt, out, aspect="9:16", refs=(), model=None, size=None):
    """Gemini 画像モデル(Nano Banana 系)。参照画像で画風・物の一貫性を保つ。"""
    model = model or pick_model(key, IMAGE_MODELS, "image")
    parts = [{"text": prompt}] + [{"inline_data": b64file(r)} for r in refs]
    cfg = {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect}}
    if size:
        cfg["imageConfig"]["imageSize"] = size  # 例: "2K"(対応モデルのみ)
    j = call("POST", f"/models/{model}:generateContent", key,
             {"contents": [{"parts": parts}], "generationConfig": cfg}, timeout=600)
    for cand in j.get("candidates", []):
        for p in cand.get("content", {}).get("parts", []):
            if "inlineData" in p:
                open(out, "wb").write(base64.b64decode(p["inlineData"]["data"]))
                return out
    raise SystemExit("画像が返ってきませんでした: " + json.dumps(j)[:800])


def gen_imagen(key, prompt, out, aspect="9:16", model=None, n=1):
    model = model or pick_model(key, IMAGEN_MODELS, "imagen")
    j = call("POST", f"/models/{model}:predict", key,
             {"instances": [{"prompt": prompt}],
              "parameters": {"sampleCount": n, "aspectRatio": aspect, "personGeneration": "dont_allow"}}, timeout=600)
    preds = j.get("predictions", [])
    if not preds:
        raise SystemExit("画像が返ってきませんでした: " + json.dumps(j)[:800])
    open(out, "wb").write(base64.b64decode(preds[0]["bytesBase64Encoded"]))
    return out


def gen_video(key, prompt, out, aspect="9:16", image=None, seconds=8, model=None, resolution="1080p"):
    """Veo。image を渡すと image-to-video。完了まで待って mp4 を保存。"""
    model = model or pick_model(key, VIDEO_MODELS, "veo")
    inst = {"prompt": prompt}
    if image:
        f = b64file(image)
        inst["image"] = {"bytesBase64Encoded": f["data"], "mimeType": f["mime_type"]}
    params = {"aspectRatio": aspect, "durationSeconds": seconds, "personGeneration": "dont_allow", "resolution": resolution}
    j = call("POST", f"/models/{model}:predictLongRunning", key, {"instances": [inst], "parameters": params})
    name = j["name"]
    print("  operation", name, flush=True)
    for _ in range(240):
        time.sleep(10)
        op = call("GET", "/" + name, key)
        if op.get("done"):
            if "error" in op:
                raise SystemExit("動画生成エラー: " + json.dumps(op["error"])[:800])
            resp = op.get("response", {})
            samples = resp.get("generateVideoResponse", {}).get("generatedSamples") or resp.get("generatedSamples") or []
            if not samples:
                raise SystemExit("動画が返ってきませんでした: " + json.dumps(op)[:800])
            uri = samples[0]["video"]["uri"]
            req = urllib.request.Request(uri, headers={"x-goog-api-key": key})
            with urllib.request.urlopen(req, timeout=600) as r:
                open(out, "wb").write(r.read())
            return out
        print("  ...生成中", flush=True)
    raise SystemExit("動画生成がタイムアウトしました")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["models", "image", "imagen", "video"])
    ap.add_argument("prompt", nargs="?")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--key")
    ap.add_argument("--aspect", default="9:16")
    ap.add_argument("--ref", action="append", default=[])
    ap.add_argument("--image")
    ap.add_argument("--seconds", type=int, default=8)
    ap.add_argument("--model")
    ap.add_argument("--size")
    args = ap.parse_args()
    key = key_of(args)
    if args.cmd == "models":
        for m in list_models(key):
            n = m["name"].split("/")[-1]
            if any(s in n for s in ("image", "imagen", "veo")):
                print(n, "-", ",".join(m.get("supportedGenerationMethods", [])))
        return
    if args.cmd == "image":
        print(gen_image(key, args.prompt, args.out, args.aspect, args.ref, args.model, args.size))
    elif args.cmd == "imagen":
        print(gen_imagen(key, args.prompt, args.out, args.aspect, args.model))
    else:
        print(gen_video(key, args.prompt, args.out, args.aspect, args.image, args.seconds, args.model))


if __name__ == "__main__":
    main()
