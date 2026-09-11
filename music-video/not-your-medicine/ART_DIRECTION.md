# 絵柄の出し方（2026-09-11 に判明したこと）

## 結論: 生成ではなく「描き直し」で当てる

Higgsfield のモデルは全体に実写寄りで、**プロンプトでアニメ背景美術を直接生成するのは無理**だった。
当たったのは **`flux_kontext`（Black Forest Labs / style transfer）で写真を描き直す**やり方。

```
model: flux_kontext
medias: [{role: "image_references", value: "<元画像の job_id>"}]
prompt: "Redraw this photograph as hand-painted 2D anime background art for a
         Japanese animated film. Keep the exact composition, layout and lighting,
         but convert it into a cel painting: flat blocks of colour, crisp
         hand-drawn edges, visible brush strokes in the wood grain, soft
         airbrushed glow around the lamplight.
         No photorealism, no 3D render, no text, no letters, no logos."
```

構図・光・色は元画像から引き継がれるので、**まず `soul_cinematic` で構図を作り、
それを `flux_kontext` に食わせて絵柄だけ変える**、の2段構えが安定する。

## 試して駄目だったもの

| やり方 | 結果 |
|---|---|
| `soul_cinematic` に "anime background art, cinematic film still" | 実写の机の写真。構図の指示も無視された |
| `soul_cinematic` に "illustration, not a photograph" | 抽象的なオレンジのグラデーション。背景美術ではない |
| `z_image`（無料枠で唯一動く stylized モデル） | ジョブが failed |
| `seedream_v4_5` / `flux_2` / `nano_banana` / `soul_location` | `Requires basic plan or higher` |

## flux_kontext は内容も変えられる

style transfer だけでなく編集指示も通る。実際に効いた例:

- 「グラスの縁に錠剤を乗せて」→ 乗った（水面に浮いた形にはなった）
- 「水面の極端なクローズアップに寄って」→ 寄った
- 「夜を朝に変えて」→ 変わった

ただし**消す指示は効きすぎる**。「ランプとモニターを消して」と書いたら
グラスまで消えて空の机になった。残すものは "must stay exactly where it is,
same size and position" と明示すること。

## クレジット単価（ここが効く）

| モデル | 1枚あたり | 備考 |
|---|---|---|
| `soul_cinematic` | 約 0.12 | 構図出しはこれで十分 |
| `flux_kontext` | **約 1.5** | 絵柄を当てる本番。12倍以上高い |

無料枠 10 クレジットだと **flux_kontext は 5〜6 枚で尽きる**。
1曲4カットなら1回は通るが、描き直しの試行錯誤はできない。

## 発注の順番

1. `soul_cinematic` で構図と光を決める（安い。何枚でも振れる）
2. 平均輝度を測って露出で弾く（`HIGGSFIELD_SHOTS.md` の基準）
3. 通ったものだけ `flux_kontext` で絵柄を変える（高いので一発で決める）
4. 朝のカットは夜のカットを `flux_kontext` に食わせて時間だけ変えると机が揃う
