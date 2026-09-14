# 必要な絵の発注書

いま持っている C の絵は **後ろ姿 1 枚**（`art/world_rooftop_dawn_C.png`）と、
白背景のキャラクターシート（`art/char_c_cold.png`）だけ。
カットを 14 に増やしても、絵が 1 枚では「同じ絵の切り取り違い」にしかならない。

**動いて見えるかどうかは枚数で決まる。** 生成 1 枚 0.12 クレジット、
動画生成は 5 秒で 7.5〜32.5。**枚数を増やすほうが 62 倍以上安い。**

## C の外見（毎回この通りに書く）

```
Japanese young woman of about twenty, long oval face with a clearly defined
jawline and visible cheekbones, mature adult facial proportions and definitely
not a rounded babyface, straight narrow nose, thin lips closed in a flat line,
narrow almond eyes with a level distant gaze, cool amber irises, straight dark
eyebrows, near-black deep indigo hair cropped short to ear length and slightly
tousled, one bright amber dyed streak at her right temple, wearing a long deep
navy open coat reaching mid-calf with the collar up, a plain white shirt
underneath, black slim trousers, black leather ankle boots, and large black
over-ear headphones resting around her neck
```

## 枠（前後に必ず付ける）

先頭:

```
A vertical hand-painted 2D anime key visual for a Japanese music video, cel
painting on paper, absolutely not a photograph and not a 3D render.
```

末尾:

```
Painted like a hand-made anime background: flat blocks of colour, crisp
hand-drawn edges, soft airbrushed glow around the light source, visible brush
texture. Clear, open, airy and clearly lit. Strict colour palette of deep
indigo, warm amber and white. No photorealism, no 3D render, no lens flare,
no text, no letters, no watermark, no logos.
```

`aspect_ratio: 9:16`、`model: soul_cinematic`。生成後に必ず平均輝度を測る
（夜明けの風景は 90〜130、顔のアップは 110〜150）。

## NOT YOUR MEDICINE に要る絵

| # | 絵 | どのカットで効くか | 場面の書き方 |
|---|---|---|---|
| 1 | 後ろ姿・引き | 01・04・09・12（**取得済み**） | — |
| 2 | 顔のアップ、目を伏せている | 冒頭 0〜3 秒。ここで誰の動画か決まる | `Extreme close-up of her face filling the frame, eyes lowered and almost closed, lit from below by warm amber light, the amber streak falling across her right temple` |
| 3 | 顔のアップ、目を開ける | 「I'm not your medicine」の頭 | `Extreme close-up of her face, eyes open and looking straight at the viewer, level and unflinching, amber rim light along her cheek` |
| 4 | 横顔、風に髪が流れる | サビ前 | `Profile view from her right side, chin slightly raised, short hair and coat collar lifting in the wind, the amber horizon behind her, she fills the left third of the frame` |
| 5 | 振り向きかけ（3/4 後ろ） | 1 と 3 の間をつなぐ | `Three-quarter view from behind, caught mid-turn, looking back over her right shoulder, the coat swinging out behind her` |
| 6 | 縁に腰掛けている | 静かなところ | `Sitting on the low concrete parapet at the roof edge with her legs hanging over, seen from behind and to the side, small in the lower third of the frame` |
| 7 | 見上げる（下から） | 「Then maybe both of us can win」 | `Low angle looking up at her from near the ground, she is against a huge open sky, her face tilted up, the frame mostly sky` |
| 8 | 逆光のシルエット | 朝の光が差すところ | `Full silhouette, she is a flat black shape against a blazing amber sky, no interior detail, only the outline of the coat and headphones readable` |
| 9 | 歩き出す後ろ姿 | 終わり | `Seen from behind, walking away from the camera toward the far edge of the roof, the coat hem lifting with the step` |
| 10 | 手のアップ | 「線を引いて」 | `Close-up of her right hand only, fingers extended, drawing a horizontal line in the air, the amber line glowing where the fingertip has passed` |

**9 枚で 1.08 クレジット。**

## PAPER PLANE ROYALTY に要る絵

| # | 絵 | 場面の書き方 |
|---|---|---|
| 11 | 同じ屋上の昼 | `The same rooftop at midday, the sky a flat clear blue, hard sunlight across the concrete, she stands small in the lower third with her back to us` |
| 12 | 紙飛行機を投げる | `Caught mid-throw, her right arm extended forward and up having just released a small white paper plane, seen from behind and below` |
| 13 | 紙飛行機の軌跡 | `The white paper plane alone in a wide empty sky, small, seen from below, a faint amber curve trailing behind it` |

**3 枚で 0.36 クレジット。**

## 合計

| | 枚数 | クレジット |
|---|---|---|
| NOT YOUR MEDICINE | 9 | 1.08 |
| PAPER PLANE ROYALTY | 3 | 0.36 |
| 予備（露出で落ちるぶん、3 割） | 4 | 0.48 |
| **合計** | **16** | **約 2** |

残高は 0.10。**2 クレジット足せば 2 曲ぶんの絵が揃う。**

## 顔の同一性について

顔のアップ（2・3・4）は、外見の記述だけでは毎回少しずつ違う顔になる。
同じ顔で揃えるには Soul の学習が要る（`show_characters action='train'`、
同じキャラクターの参照画像 5〜20 枚、約 10 分、学習済みは `soul_cinematic` で使える）。

順番としては、まず引きとシルエット（顔が小さいカット）を先に出して、
顔のアップは学習してから出すほうが安全。
