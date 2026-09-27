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

## 人物・小物・文字（motifs.py）

- 人物: フリルワンピース＋縞タイツ＋リボンの少女シルエット（傘・鍵・ティーカップ・風船を持つ）
- 小物: チェシャ猫、白兎、懐中時計、ティーカップ、トランプ、三日月、王冠、キノコ、シルクハット、目
- 文字: セリフ体の英語タイトル、縦書き日本語、章番号などの小ラベル、飾り文字、原作（パブリックドメイン）の本文段落
- 人物と小物は紙色のハロー（縁取り）付きで、密な背景の上でも読めるようにしています

フォントは FreeSerif と IPAゴシック（どちらも無償）を使用。

限界: 人物は記号的なシルエット表現です。参考作品のような描き込まれたイラストの人物は、
コードだけでは出せません。
