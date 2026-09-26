# ornate-art — 無課金の装飾ポスター量産ジェネレータ

AI画像モデルを使わず、Pythonだけで極彩色マンダラ・レース輪・放射線・レインボー帯・グリッチ・紙目ノイズを
左右対称の縦長ポスターに合成します。クレジット消費ゼロ、1枚あたり約1秒。

```bash
pip install pillow numpy
python3 scripts/ornate-art/generate.py --count 20 --out out           # 1080x1350 (Instagram 4:5)
python3 scripts/ornate-art/generate.py --count 5 --size 1080x1920      # Shorts / Reels
python3 scripts/ornate-art/generate.py --bg black --palette lacquer --seed 42
python3 scripts/ornate-art/generate.py --count 3 --size 2160x2700 --ss 2   # 高解像度
```

- `--bg white|black|mix`、`--palette carnival|aurora|lacquer|mix`、`--seed` で再現可能
- `--ss` はスーパーサンプリング倍率（2で十分、4で線がより滑らか）
- `samples/` に生成例

限界: 人物（アリス風の少女など）は描けません。人物を重ねたい場合は、このポスターを背景にして
別途用意した人物画像を上に合成してください。
