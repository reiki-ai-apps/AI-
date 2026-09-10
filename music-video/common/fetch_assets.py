#!/usr/bin/env python3
"""art/assets.json に書いてある背景美術をダウンロードして art/ に並べる。

Higgsfield の配信CDN(d8j0ntlcm91z4.cloudfront.net)は、この実行環境の
ネットワーク方針では遮断されている。到達できる場所で走らせるための小道具。

  python3 common/fetch_assets.py not-your-medicine/art/assets.json

手元に PNG が既にある場合(ブラウザで落とした等)は --from で寄せ集めてもよい。
ファイル名が assets.json の job_id を含んでいれば、正しい名前に振り分ける。

  python3 common/fetch_assets.py not-your-medicine/art/assets.json --from ~/Downloads
"""
import argparse
import json
import os
import shutil
import sys
import urllib.error
import urllib.request


def load(spec_path):
    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)
    return spec, os.path.dirname(os.path.abspath(spec_path))


def download(url, out):
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read()
    with open(out, "wb") as f:
        f.write(data)
    return len(data)


def pick_local(src_dir, job_id):
    """job_id を名前に含むファイルを探す(Higgsfield の書き出し名はそうなっている)。"""
    if not os.path.isdir(src_dir):
        return None
    for name in sorted(os.listdir(src_dir)):
        if job_id in name and name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            return os.path.join(src_dir, name)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec", help="assets.json のパス")
    ap.add_argument("--from", dest="src", help="ダウンロード済みの画像が入った場所")
    ap.add_argument("--force", action="store_true", help="既にあるファイルも取り直す")
    args = ap.parse_args()

    spec, art_dir = load(args.spec)
    ok = fail = skip = 0

    for item in spec.get("images", []):
        out = os.path.join(art_dir, item["file"])
        if os.path.exists(out) and not args.force:
            print(f"  そのまま {item['file']}")
            skip += 1
            continue

        local = pick_local(args.src, item["job_id"]) if args.src else None
        if local:
            shutil.copyfile(local, out)
            print(f"  コピー   {item['file']}  ← {os.path.basename(local)}")
            ok += 1
            continue

        url = item.get("url")
        if not url:
            print(f"  URL なし {item['file']} (job {item['job_id']})", file=sys.stderr)
            fail += 1
            continue
        try:
            n = download(url, out)
            print(f"  取得     {item['file']}  {n // 1024} KB")
            ok += 1
        except (urllib.error.URLError, OSError) as e:
            print(f"  失敗     {item['file']}: {e}", file=sys.stderr)
            fail += 1

    print(f"\n取得 {ok} / 既存 {skip} / 失敗 {fail}")
    if fail:
        print("CDN に出られない環境なら、ブラウザで落として --from で渡してください。", file=sys.stderr)
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
