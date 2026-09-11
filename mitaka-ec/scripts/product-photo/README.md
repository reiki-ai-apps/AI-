# 商品画像

商品ページ・カタログの画像は `mitaka-ec/assets/products/<商品ID>.jpg`(1200×900 / 4:3)です。
画像には2種類あり、`assets/product-photos.js` の `REAL_PHOTOS` に入っているIDだけが**実物写真**、
それ以外は**イメージ図**として「イメージ図」バッジと注意書き付きで表示されます。

## 1. 実物写真を入れる(本来のやり方)

メーカー提供の画像、または自社で撮影した写真を、ファイル名を `商品ID.jpg` にして1つのフォルダに入れ:

```bash
cd mitaka-ec
NODE_PATH=/opt/node22/lib/node_modules node scripts/import-photos.mjs ~/photos
# ファイル名が品番と違うときは CSV(商品ID,ファイル名)で対応づけ
NODE_PATH=/opt/node22/lib/node_modules node scripts/import-photos.mjs ~/photos --map map.csv
```

1200×900・白背景に整えて `assets/products/` に入れ、`assets/product-photos.js` を書き換えます。
コードの変更は不要です。入れた商品から順に「イメージ図」の表示が消えます。

**メーカー品(佐藤産業・誠和・東都興業)は、メーカーから販売店向けの商品画像データをもらってください。**
メーカーサイトの写真を無断で持ってくることはできません(著作権)。
画像データは商品マスタ(品番・商品名・規格・JANコード・価格)と一緒に提供されることが多く、
2万点の商品マスタ取り込み(`scripts/import-catalog.mjs`)とセットで進めるのが早いです。

## 2. イメージ図(実物写真が無い間のつなぎ)

部材の実寸(パイプ径・全長・目合いなど)から立体を組み立て、白ホリのスタジオ撮影風に
レンダリングした画像です。**実物の商品写真ではありません。**

- 寸法は規格どおりですが、メーカー固有の形状・刻印・色は当社の推定です。
- 汎用品(パイプ・フィルム・ネット・マルチなど)は形が決まっているので実物に近くなりますが、
  メーカー固有の機械(誠和 くるファミ、プロファインダー など)は**外観の推定**にすぎません。
- 商品ページには「この画像は規格の寸法から起こしたイメージ図です。実物の写真ではありません」と明記しています。

| ファイル | 役割 |
| --- | --- |
| `shapes.js` | 形を作る部品集(34種)。すべてメートル実寸で組み立てる |
| `map.js` | 商品ID → 形・パラメータ・並べる個数・カメラ位置 |
| `studio.html` | 撮影セット。白ホリ、三灯、接地影、ACESトーンマッピング |
| `shoot.mjs` | Playwright で `studio.html` を開いて JPEG を書き出す |

```bash
cd mitaka-ec
NODE_PATH=/opt/node22/lib/node_modules node scripts/product-photo/shoot.mjs          # 全商品
NODE_PATH=/opt/node22/lib/node_modules node scripts/product-photo/shoot.mjs ST-CR-PC # 指定商品だけ
```

実物写真が入った商品は `shoot.mjs` で上書きされます。実物写真を入れ終わった商品は
`map.js` から消すか、`shoot.mjs` に品番を指定して必要な分だけ撮り直してください。
