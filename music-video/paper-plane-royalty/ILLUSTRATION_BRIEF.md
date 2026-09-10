# PAPER PLANE ROYALTY「折って、飛ばす。」イラスト発注書

アニマティックのカット割り・拍同期・歌詞の出し方はそのまま、絵をアニメ／漫画レベルに置き換えるための仕様。
絵は生成ツール（niji / Midjourney / Nano Banana 等）で作り、`common/compose.py` のレイヤーとして読み込む。
（NOT YOUR MEDICINE 側の `shots.json` と同じ形式で、この曲の `shots.json` はイラストが揃った時点で書く。）

## スタイルガイド

- 画風: 明るいアニメ調。線は細く、色はフラット寄りだが紙の質感だけは描き込む。人物は出さない（手は本番の実写）。
- 色: 世界は灰色（青みの灰、白い紙だけが温かい白）。唯一のアクセントは蛍光ペンのピンク。最終サビだけ世界全体に色（パステル）。
- 構図: 縦 9:16。文字が入る下 25% と上 17% に主役を置かない。
- 解像度: 2160×3840 以上。1枚目を参照画像（`--sref`）にして残りを作る。
- 禁止: ネオン、夜景、実在ロゴ、文字（歌詞はこちらで載せる）。

## 新規に描く絵（7 種類）

| # | 内容 | 英語プロンプトの骨子 |
|---|---|---|
| A | 灰色のオフィスの机の俯瞰（付箋、コーヒーの輪染み、蛍光ペンだけピンク） | `top-down view of a gray office desk, sticky notes, coffee ring stain, a single pink highlighter as the only color, soft fluorescent light, anime background art --ar 9:16` |
| B | 同じ机の**色つき版**（最終サビ用、パステルの朝の光） | `same top-down desk, pastel morning light, colors returning, warm wood, anime background art --ar 9:16` |
| C | 蛍光灯の下の壁（横アングル、上に蛍光灯、灰色） | `side view of a gray office wall under a fluorescent ceiling light, dust in the light, anime background art --ar 9:16` |
| D | 窓越しの灰色の街（昼、曇り、空気遠近法） | `view through an office window of a gray overcast city at noon, aerial perspective, muted, anime background art --ar 9:16` |
| E | 色が戻った街（同構図、パステルのビル、青空） | `same city view, pastel colored buildings, blue sky, light and hopeful, anime background art --ar 9:16` |
| F | 昼の空に花火（パステル） | `pastel fireworks in a bright daytime sky, paper planes in the foreground, anime style --ar 9:16` |
| G | 紙飛行機の透過 PNG（俯瞰・横・飛来の 3 角度） と 紙の王冠の透過 PNG | `a white paper plane, clean folds, isolated on transparent background, anime style` |

紙を折る工程（始末書→飛行機）は、生成イラストでは面の整合が取れないので**実写**に任せる（スマホ俯瞰で 1 拍 1 折り）。
アニマティックの折り工程はその撮影のタイミング指示として使う。

## 動画化が欲しいカット（任意、Kling / Veo）

| 元画像 | 動き |
|---|---|
| C | 天井のタイルが紙のようにめくれて青空が見える（4 秒） |
| E | 無数の紙飛行機がビルの窓から飛び出す（5 秒） |
| F | 花火が昼の空に開く（4 秒） |

## 納品の置き場所

```
music-video/paper-plane-royalty/art/
  A_desk_gray_bg.png  B_desk_color_bg.png  C_wall_bg.png  D_city_gray_bg.png  E_city_color_bg.png  F_fireworks_bg.png
  obj_plane_top.png  obj_plane_side.png  obj_plane_front.png  obj_crown.png
```
