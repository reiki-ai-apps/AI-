#!/usr/bin/env python3
"""OpenAI Images API(GPT Image 系)で画像を生成する薄いクライアント。generate.py の --backend openai 用。

キーは環境変数 OPENAI_API_KEY か --key。この環境では api.openai.com が遮断されているため、
環境のネットワーク方針で許可してから使う。
  python3 gen_openai.py image "prompt" out.png --aspect 9:16 [--ref a.png] [--transparent] [--model gpt-image-2]
"""
import argparse
import base64
import io
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
import uuid

API = "https://api.openai.com/v1"
MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1"]          # 背景画(最上位モデル優先)
TRANSPARENT_MODELS = ["gpt-image-1.5", "gpt-image-1"]           # 透過 PNG は gpt-image-2 非対応のため
SIZES = {"9:16": "1024x1536", "16:9": "1536x1024", "1:1": "1024x1024"}


def key_of(args):
    k = getattr(args, "key", None) or os.environ.get("OPENAI_API_KEY")
    if not k:
        sys.exit("エラー: OPENAI_API_KEY(または --key)が必要です")
    return k


def _request(req, timeout=600):
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}\n{e.read().decode()[:1500]}")


def gen_image(key, prompt, out, aspect="9:16", refs=(), model=None, transparent=False, quality="high"):
    """refs があれば /images/edits(参照画像つき)、無ければ /images/generations。"""
    models = [model] if model else (TRANSPARENT_MODELS if transparent else MODELS)
    last = None
    for m in models:
        try:
            if refs:
                boundary = uuid.uuid4().hex
                body = io.BytesIO()

                def field(name, value):
                    body.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())

                field("model", m)
                field("prompt", prompt)
                field("size", SIZES.get(aspect, "1024x1536"))
                field("quality", quality)
                if transparent:
                    field("background", "transparent")
                for r in refs:
                    mime = mimetypes.guess_type(r)[0] or "image/png"
                    body.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"{os.path.basename(r)}\"\r\n"
                               f"Content-Type: {mime}\r\n\r\n".encode())
                    body.write(open(r, "rb").read())
                    body.write(b"\r\n")
                body.write(f"--{boundary}--\r\n".encode())
                req = urllib.request.Request(API + "/images/edits", data=body.getvalue(), method="POST",
                                             headers={"Authorization": f"Bearer {key}", "Content-Type": f"multipart/form-data; boundary={boundary}"})
            else:
                payload = {"model": m, "prompt": prompt, "size": SIZES.get(aspect, "1024x1536"), "quality": quality, "n": 1}
                if transparent:
                    payload["background"] = "transparent"
                req = urllib.request.Request(API + "/images/generations", data=json.dumps(payload).encode(), method="POST",
                                             headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
            j = _request(req)
            open(out, "wb").write(base64.b64decode(j["data"][0]["b64_json"]))
            return out
        except SystemExit as e:
            last = e
            msg = str(e).lower()
            if not model and ("model" in msg or "not supported" in msg or "background" in msg):
                continue  # 次の候補モデルへ
            raise
    raise SystemExit(f"どのモデルでも生成できませんでした: {last}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["image"])
    ap.add_argument("prompt")
    ap.add_argument("out")
    ap.add_argument("--key")
    ap.add_argument("--aspect", default="9:16")
    ap.add_argument("--ref", action="append", default=[])
    ap.add_argument("--transparent", action="store_true")
    ap.add_argument("--model")
    args = ap.parse_args()
    print(gen_image(key_of(args), args.prompt, args.out, args.aspect, args.ref, args.model, args.transparent))


if __name__ == "__main__":
    main()
