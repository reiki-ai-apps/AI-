# NOT YOUR MEDICINE — Higgsfield 発注書（動画クリップ 6 本）

Higgsfield で **8秒の動画クリップを6本**作る。それだけで 51 秒のカットの背景がすべて実写級の動画になる。
スマホ画面の日本語・線のグラフィック・字幕は、生成では文字が壊れるので**こちらの合成**で乗せる。

## クレジット試算（Starter $19/月 = 270 クレジット）

| 項目 | 単価 | 本数 | 小計 |
|---|---|---|---|
| Kling 3.0 動画 8秒 720p | 約 14 クレジット | 6 本 | 約 84 クレジット |
| Soul 2.0 画像 2K（保険用） | 約 0.125 クレジット | 10 枚 | 約 1.3 クレジット |
| **合計** | | | **約 85 クレジット** |

Starter 1 か月分（270）で **この曲を含めて 3 曲**まかなえる。1 曲あたり実質 **$6 前後**。
やり直しを 2 倍見込んでも 1 曲 170 クレジット、月 1〜2 曲なら Starter で足りる。
クレジットは翌月に繰り越されないので、契約した月にまとめて作るのが得。

## 共通の設定（毎回同じにする）

- モデル: **Kling 3.0**（画質と物理の安定が最上位）
- 比率: **9:16**、長さ **8秒**、720p（1080p は倍近く食うので、最後の1本だけ上げる判断でよい）
- カメラ: 各プロンプトの末尾に指定あり。**カメラは動かしすぎない**（こちらで寄りを足すため）
- 画風の統一: 1 本目ができたら、その**最終フレームを次のクリップの開始画像**に使う（image-to-video）。
  これで色・机・グラスがぶれない。Higgsfield なら「Extend」でも同じことができる。

すべてのプロンプトの末尾に付ける共通文（コピペ用）:

```
Japanese anime background art style, cinematic, painterly, no people, no hands, no text, no letters, no logos, vertical 9:16, static locked-off camera, subtle natural motion only.
```

## クリップ 6 本

### V1 — `art/v1_table_night.mp4`（0:00–0:08 / 深夜のテーブル）

```
Top-down view of a dark wooden table at 2 a.m. A thick glass of still water sits in the lower right. Deep blue darkness. A faint amber lamp glow from the upper right corner. On the upper left, a cool blue-white phone screen glow pulses softly on and off as if a call is ringing. The water surface trembles very slightly. Dust drifts slowly through the lamp light.
```
使い所: 冒頭のフック「毎晩、僕は君の薬だった。」とチャント "No cure / No savior"。

### V2 — `art/v2_tablet_dissolve.mp4`（0:02–0:10 / 錠剤が溶ける）★ 一番大事

V1 の最終フレームを開始画像にする。

```
Top-down close view of the glass of water on the dark table at night. A single white round tablet drops into the water, sinks, and starts to fizz. Fine bubbles rise and swirl, the water clouds white, ripples spread outward, and the tablet slowly dissolves until it is completely gone. Deep blue night, faint amber lamp light from the upper right.
```
使い所: "No savior"〜"Just love"。曲の意味（僕が溶けて消える）の中心。

### V3 — `art/v3_glass_side.mp4`（0:10–0:18 / 横アングル、縁に立つ錠剤）

```
Side view at table height of a thick glass of water at night. A warm amber lamp glows out of focus behind it. Thin bright highlights on the glass rim and the waterline. A single white round tablet rests balanced on the rim of the glass, not falling in. Dust motes float slowly through the amber light. Deep blue shadows.
```
使い所: サビ頭 "I'm not your medicine"。**錠剤が水に落ちない**のが画の主張。

### V4 — `art/v4_water_closeup.mp4`（0:18–0:26 / 水面クローズアップ）

```
Extreme close-up top-down of the still water surface inside a glass, filling the frame. A faint rectangular window reflection sits on the surface. The water breathes with almost imperceptible ripples. The colour shifts very slowly from deep blue toward a pale amber edge as the first hint of dawn arrives. Calm, quiet, minimal.
```
使い所: "I can love you deeply / Without becoming every scar"。一番静かな所。

### V5 — `art/v5_dawn_sweep.mp4`（0:26–0:34 / 朝の光が横切る）

V1 と同じ構図で。V1 の最終フレームを開始画像にして「朝にして」と指示すると揃う。

```
Top-down view of the same wooden table, early morning. Low golden sunlight enters from the right edge and slowly sweeps across the table from right to left. The shadow of the glass stretches and softens. Warm amber and cream tones grow as the blue night fades away. Dust glitters in the sunbeam.
```
使い所: 最終サビ "You have strength beneath your skin"。夜から朝への転換点。

### V6 — `art/v6_morning_wide.mp4`（0:34–0:42 / 朝の引き）

```
Top-down view of the same wooden table in full morning light. The glass of water sits calm, a single white tablet stands upright on its edge beside it casting a long soft shadow. Warm golden light, gentle dust in the air, everything still and peaceful. Very slight breathing motion in the light.
```
使い所: 締めの "I'm just someone choosing to be here"。立ったままの錠剤＝消えなかった僕。

## 保険用の静止画（Soul 2.0、ほぼ無料）

動画がうまくいかなかった時の差し替え用に、同じ 6 場面を静止画でも 1 枚ずつ撮っておく（合計 0.75 クレジット）。
プロンプトは上と同じものから、動きの記述（drops, sweeps, rises など）を抜くだけ。

## 保存場所

生成した mp4 を `music-video/not-your-medicine/art/` に上の名前で置く。
置いたらこちらで `shots.json` の時間に合わせて切り、字幕・スマホ画面・線・色調・粒子を乗せて書き出す。

## 私（Claude）側の分担

| 誰が | 何を |
|---|---|
| Higgsfield | 背景の動画 6 本（机・グラス・錠剤・光） |
| 合成（こちら） | 拍に合わせたカット、キネティック字幕、スマホ画面の日本語、境界線のグラフィック、色調、粒子、ループ |

生成側に文字を描かせない。文字は全部こちらで乗せるので、**プロンプトに no text を必ず入れる**。
