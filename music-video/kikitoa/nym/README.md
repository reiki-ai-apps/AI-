# NOT YOUR MEDICINE — 生成を使わない組み立て

屋上のプレート 1 枚から 5 カットを作る。Higgsfield は使わない。

```bash
python3 prep_layers.py                     # プレートをレイヤーに分解（art/ ができる）
SONG=/path/to/NOT_YOUR_MEDICINE.mp3
python3 ../../common/compose.py --spec shots.json --song "$SONG" --out nym.mp4
python3 ../../common/compose.py --spec shots.json --song "$SONG" \
        --stills 191,197.5,206,216,234 --out-dir stills/   # 静止画だけ確認する場合
```

`art/` は中間ファイルなのでコミットしない。元は `../art/world_rooftop_dawn_C.png` の 1 枚だけ。

`prep_layers.py` が作るもの:

| ファイル | 中身 |
|---|---|
| `bg_rooftop_dawn.png` | プレートを 1152x2048 に拡大しただけのもの。引きのカットはこれを使う |
| `bg_rooftop_dawn_clean.png` | 人物を消したもの。寄りのカットで視差をつけるときの背景 |
| `fig_c_back.png` | 人物の切り抜き（透過つき） |
| `line_straight.png` | 琥珀の線。NOT YOUR MEDICINE「線を引いて」 |
| `line_bent.png` | 曲がった線。PAPER PLANE ROYALTY「少し曲がった線でいい」 |

考え方と粗は `../PIPELINE.md` の「生成を使わずにどこまで作れるか」を見ること。
