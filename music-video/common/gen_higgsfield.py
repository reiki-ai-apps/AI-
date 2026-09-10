#!/usr/bin/env python3
"""Higgsfield API クライアント(画像 Soul / 動画 Kling・Veo・Seedance)。

Higgsfield は「1つのサブスクで画像も動画も」まかなえるため、この案件で一番安い。
  - Soul 2.0 画像(2K): 約 0.125 クレジット → 実質ゼロ
  - Kling 3.0 動画(8秒 720p): 約 14 クレジット
  Starter $19/月 = 270 クレジット → 8秒クリップ約19本。1曲(51秒)は6本=84クレジットで足りる。

キーは環境変数 HIGGSFIELD_API_KEY / HIGGSFIELD_API_SECRET か --key/--secret。
この環境では higgsfield.ai が遮断されているため、環境のネットワーク方針で許可してから使う。

  python3 gen_higgsfield.py image "prompt" out.png --aspect 9:16
  python3 gen_higgsfield.py video "prompt" out.mp4 --image start.png --seconds 8 --model kling-3.0
  python3 gen_higgsfield.py balance
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

API = os.environ.get("HIGGSFIELD_API_BASE", "https://platform.higgsfield.ai/v1")
POLL_INTERVAL = 8
POLL_MAX = 150  # 最大 20 分


def creds(args):
    key = getattr(args, "key", None) or os.environ.get("HIGGSFIELD_API_KEY")
    secret = getattr(args, "secret", None) or os.environ.get("HIGGSFIELD_API_SECRET")
    if not key:
        sys.exit("エラー: HIGGSFIELD_API_KEY(または --key)が必要です")
    return key, secret


def _headers(key, secret):
    h = {"Content-Type": "application/json", "hf-api-key": key}
    if secret:
        h["hf-secret"] = secret
    h["Authorization"] = f"Bearer {key}"
    return h


def call(method, path, key, secret, body=None, timeout=300):
    req = urllib.request.Request(API + path, method=method, headers=_headers(key, secret))
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} {path}\n{e.read().decode()[:1500]}")
    except urllib.error.URLError as e:
        raise SystemExit(f"接続できません {path}: {e}\n"
                         "この環境から higgsfield.ai に到達できない場合は、環境のネットワーク方針で許可してください。")


def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or "image/png"
    return f"data:{mime};base64," + base64.b64encode(open(path, "rb").read()).decode()


def download(url, out):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=900) as r:
        open(out, "wb").write(r.read())
    return out


def poll(job_id, key, secret, label="job"):
    """ジョブ完了まで待ち、成果物の URL を返す。"""
    for i in range(POLL_MAX):
        time.sleep(POLL_INTERVAL)
        j = call("GET", f"/jobs/{job_id}", key, secret)
        status = (j.get("status") or j.get("state") or "").lower()
        if status in ("completed", "succeeded", "success", "done"):
            for k in ("results", "outputs", "assets", "data"):
                items = j.get(k)
                if isinstance(items, list) and items:
                    first = items[0]
                    url = first.get("url") or first.get("raw", {}).get("url") or first.get("min", {}).get("url")
                    if url:
                        return url
            raise SystemExit(f"完了したが出力 URL が見つかりません: {json.dumps(j)[:900]}")
        if status in ("failed", "error", "canceled", "nsfw"):
            raise SystemExit(f"{label} 失敗 ({status}): {json.dumps(j)[:900]}")
        if i % 4 == 0:
            print(f"   ...{label} {status or 'queued'}", flush=True)
    raise SystemExit(f"{label} がタイムアウトしました")


def gen_image(key, secret, prompt, out, aspect="9:16", refs=(), model="soul-2.0", quality="2k"):
    body = {"params": {"prompt": prompt, "quality": quality, "aspect_ratio": aspect, "model": model}}
    if refs:
        body["params"]["reference_images"] = [{"type": "image_url", "image_url": data_uri(r)} for r in refs]
    j = call("POST", "/text2image", key, secret, body)
    job = j.get("id") or j.get("job_id")
    url = poll(job, key, secret, "image") if job else (j.get("results") or [{}])[0].get("url")
    if not url:
        raise SystemExit("画像 URL が返りませんでした: " + json.dumps(j)[:600])
    return download(url, out)


def gen_video(key, secret, prompt, out, image=None, seconds=8, model="kling-3.0", aspect="9:16", quality="720p"):
    params = {"prompt": prompt, "model": model, "duration": seconds, "aspect_ratio": aspect, "quality": quality}
    if image:
        params["input_images"] = [{"type": "image_url", "image_url": data_uri(image)}]
        endpoint = "/image2video"
    else:
        endpoint = "/text2video"
    j = call("POST", endpoint, key, secret, {"params": params})
    job = j.get("id") or j.get("job_id")
    if not job:
        raise SystemExit("ジョブ ID が返りませんでした: " + json.dumps(j)[:600])
    url = poll(job, key, secret, "video")
    return download(url, out)


def balance(key, secret):
    return call("GET", "/account/credits", key, secret)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["image", "video", "balance"])
    ap.add_argument("prompt", nargs="?")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--key")
    ap.add_argument("--secret")
    ap.add_argument("--aspect", default="9:16")
    ap.add_argument("--ref", action="append", default=[])
    ap.add_argument("--image")
    ap.add_argument("--seconds", type=int, default=8)
    ap.add_argument("--model")
    args = ap.parse_args()
    key, secret = creds(args)
    if args.cmd == "balance":
        print(json.dumps(balance(key, secret), indent=2))
    elif args.cmd == "image":
        print(gen_image(key, secret, args.prompt, args.out, args.aspect, args.ref, args.model or "soul-2.0"))
    else:
        print(gen_video(key, secret, args.prompt, args.out, args.image, args.seconds, args.model or "kling-3.0", args.aspect))


if __name__ == "__main__":
    main()
