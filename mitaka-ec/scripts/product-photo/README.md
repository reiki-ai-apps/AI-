# 商品画像(スタジオ撮影風レンダリング)

`mitaka-ec/assets/products/<商品ID>.jpg` を生成するツールです。

## これは何か

**実物の商品写真ではありません。** 部材の実寸(パイプ径・全長・目合いなど)から立体を組み立て、
白ホリのスタジオ撮影に見えるようレンダリングした画像です。
商品写真が用意できるまでの「つなぎ」として使っています。

- 寸法は規格どおりですが、メーカー固有の形状・刻印・色は**当社の推定**です。
- とくにメーカー品(誠和 くるファミ、佐藤産業 ナイスキャッチ など)は、
  本番公開までに**実物の写真へ差し替えが必要**です。
- 商品ページには「実物の写真ではありません」と明記しています(`assets/product.js` の `photo-note`)。

## 構成

| ファイル | 役割 |
| --- | --- |
| `shapes.js` | 商品の形を作る部品集(33種)。すべてメートル実寸で組み立てる |
| `map.js` | 商品ID → どの形をどのパラメータで、何個並べて撮るか |
| `studio.html` | 撮影セット。白ホリ・三灯・接地影・ACESトーンマッピング |
| `shoot.mjs` | Playwright で `studio.html` を開いて JPEG を書き出す |

## 撮り直し方

```bash
cd mitaka-ec
NODE_PATH=/opt/node22/lib/node_modules node scripts/product-photo/shoot.mjs          # 全商品
NODE_PATH=/opt/node22/lib/node_modules node scripts/product-photo/shoot.mjs ST-CR-PC # 指定商品だけ
```

出力は 1200×900(4:3)の JPEG。カード・商品ページの図枠と同じ比率です。

## 実物写真に差し替えるとき

`assets/products/<商品ID>.jpg` を同じ名前で上書きするだけです(4:3 推奨)。
コードの変更は要りません。画像が無い商品は、自動的に従来の「形のアイコン + 規格文字」の図に戻ります。
差し替えが全商品ぶん終わったら、`assets/product.js` の `photo-note` の一文を外してください。
