# 作り方（2026-09-12 に判明したこと）

## 前日の結論は間違っていた

`not-your-medicine/ART_DIRECTION.md` に「Higgsfield はプロンプトでアニメを
直接生成できない、`flux_kontext` で描き直すしかない」と書いたが、**これは背景
だけの話で、人物と人物のいる風景には当てはまらなかった。**

`soul_cinematic` は単体でアニメのキャラクターシートも背景美術も描く。
`flux_kontext` は要らない。

| モデル | 1枚 | 無料枠 | 用途 |
|---|---|---|---|
| `soul_cinematic` | **0.12** | 使える | 全部これで足りる |
| `flux_kontext` | 1.5 | 使える | 今回は不要 |
| `soul_cast` / `seedream_v4_5` / `flux_2` / `nano_banana` | — | `Requires basic plan or higher` | 使えない |

**12 倍安い方で足りていた。** 1 曲 4 カットなら 0.48 クレジット。

## 効くプロンプトの形

頭で「これは絵である」と宣言すること。写真を否定するだけでは足りない。

```
A hand-drawn 2D anime character reference sheet, flat cel-shaded illustration
on a plain white page, absolutely not a photograph and not a real person.
Left side: full-body standing view ... Right side: a tight head-and-shoulders
close-up of the same identical original character.
[顔] [目] [眉] [髪] [体] [服 上→下→靴→小物]
Drawing style: crisp thin ink lineart, flat blocks of colour with soft gradient
shadows, the restrained look of a modern Japanese music-video key visual,
anime model-sheet presentation, even flat lighting, clean white empty background.
One single character only, no other people, no duplicate figures, no furniture,
no background objects, no photorealism, no 3D render, no camera bokeh,
no text, no letters, no watermark, no logos.
```

背景美術も同じ形。`A vertical hand-painted 2D anime background illustration
for a Japanese music video, cel painting on paper, absolutely not a photograph
and not a 3D render.` で始めて、最後に `Painted like a hand-made anime
background: flat blocks of colour, crisp hand-drawn edges, soft airbrushed glow`
を置く。

## 画像参照は構図ごとコピーする

`medias: [{role: "image", value: "<job_id>"}]` にキャラクターシートを渡して
「同じ子を屋上に立たせて」と書いたら、**屋上ではなくキャラクターシートの
レイアウトがそのまま再生産された。** プロンプトの場面指定は完全に無視された。

参照画像は「この子の顔を使え」ではなく「この絵に寄せろ」として効く。
場面を変えたいカットに前のカットを渡してはいけない。

キャラクターを揃える正しい手段は Soul の学習（`show_characters action='train'`、
参照画像 5〜20 枚、約 10 分）。学習済み Soul は `soul_2` と `soul_cinematic`
でしか使えないが、`soul_cinematic` は無料枠で動くのでこの経路は通る。
まず 1 枚いいシートを出し、そのパネルを切り出して学習用に回すのが順番。

## 露出

生成後に必ず平均輝度を測って、見る前に弾く。

```
identify -format "%wx%h mean=%[fx:int(mean*255)] sd=%[fx:int(standard_deviation*255)]" x.png
```

| 画 | mean の目安 |
|---|---|
| 白背景のキャラクターシート | 180〜200 |
| 夜・夜明けの風景 | 90〜130 |
| 落とすべき | 20 以下（潰れ）/ 210 以上かつ sd < 40（白飛び） |

暗さを書くと潰れる。**光源の方を書く。**
「dawn sky」ではなく「a wide band of glowing amber along the low horizon where
the sun sits just beneath the rim of the world, its warm light spilling across
the concrete」と書く。

## 無料枠の制限

同時実行は 1 ジョブ。`generate_image` を並べて投げると 2 本目が
`Rate limit reached: max 1 concurrent job(s) on free (null) plan.` で落ちる。
1 枚ずつ `jobs_wait` で待ってから次を投げる。

## 今回使ったクレジット

開始 0.82 → 終了 0.22。

| job_id | 中身 | 結果 |
|---|---|---|
| 65f0faed | 候補 A | 採用 |
| b9e86a6b | 候補 B | 採用 |
| 633caca1 | 候補 C | 採用 |
| 2755b035 | A を参照して屋上に立たせる試み | **失敗**。シートのレイアウトが複製された |
| 62b7b4df | 屋上（参照なし） | 採用 |

## 追記（C 決定後）

| job_id | 中身 | 結果 |
|---|---|---|
| f60d5d75 | 案 C で夜明けの屋上（参照画像なし、外見をテキストで記述） | 採用。本番の画 |

0.22 → **0.10**。`soul_cinematic` 1 枚が 0.12 なので、**これ以上生成できない。**

参照画像を使わず外見をテキストで書き直す方法で、キャラクターは十分に再現できた。
コートとヘッドホンという形の特徴が効いている。顔の同一性が要るカット（寄り）に
入る前に Soul の学習が必要になる。

### Soul の学習について

`show_characters` は `type: "soul_cinematic"` を取れる。参照画像は
**完了済みの画像ジョブ ID をそのまま渡せる**ので、アップロードは要らない。
必要なのは同一キャラクターの 5〜20 枚。所要 10 分。

事前にコストを見積る手段は無い（`get_cost` は `generate_image` 専用）。
学習用に 5 枚出すだけで 0.6 クレジット。学習自体の費用は不明。

## 生成を使わずにどこまで作れるか（2026-09-14）

プレート 1 枚（`art/world_rooftop_dawn_C.png`）だけで 5 カットを作った。
実物は `nym/shots.json` と `nym/prep_layers.py`。生成は 1 枚も使っていない。

| カット | 何で差をつけたか |
|---|---|
| 01 夜・引き | プレートそのまま。ゆっくり寄る |
| 02 線を引く | 琥珀の線を左から右へ引く（手続き描画 + `reveal: {dir: "lr"}`） |
| 03 寄り | 背景と人物を分けて視差。人物 `depth: 0.8`、被写界深度 |
| 04 夜明け | `grade: dawn` + `light_sweep`。同じ絵の時間帯を変える |
| 05 線が残る | 引きに戻る。線だけ残る |

### コードでできること / できないこと

できる:

- **1 枚 → 複数カット**。カメラの寄り引き、視差、被写界深度
- **時間帯**。`grade` の night / dawn と `light_sweep` で夜と朝を作り分ける
- **琥珀の線**。`prep_layers.py` が描く。手の震えと入り抜きを入れてあるので定規の線にならない
- 字幕（拍同期・1語ずつ）、bloom、グレイン、ビネット

できない（生成か作画が要る）:

- **新しいアングルとポーズ**。今あるのは後ろ姿・正面全身・正面顔の 3 つだけ
- 別の場所

### 引きのカットは分解しない

背景と人物を分けると、消し跡が残って寄ったときに見える。視差が効くのは
カメラが大きく動くカットだけなので、**引きは元のプレートをそのまま貼る**。
分解するのは寄りのカットに限る。

消す側のマスクは切り抜きより広く取ること（`binary_dilation(..., 16)`）。
同じ幅だと縁に人物の欠片が残る。

### 残っている粗

寄りのカット（03 / 04）の足元に、背景を塗り潰した跡がまだ薄く出る。
元画像が手元では 380px しかなく、マスクが粗いのが効いている。
原寸（1152x2048）を持ってくれば潰せる。
