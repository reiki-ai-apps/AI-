# music-video/common — 共通基盤

| ファイル | 役割 |
|---|---|
| `mvkit.py` | 描画・後処理・字幕・拍グリッド・出力の共通関数。俯瞰カメラ（パース＋被写界深度）、ブルーム、粒子、色調 LUT、字間付き文字、英語＋訳の字幕ブロック、歌詞タイムライン、動画書き出し |
| `compose.py` | イラスト（レイヤー PNG / 動画クリップ）を 2.5D で動かすコンポジター。`shots.json` を読んで動画にする |

## 歌詞タイムライン `lyrics_timing.json`

```json
[{"t": 187.95, "en": "No cure", "jp": "治せはしない"}, {"t": 83.7, "en": null, "jp": "正解ばかり探してたら"}]
```

- `t` は曲の**絶対秒**（歌い出し）。字幕は `lead`（既定 0.25 秒）だけ早く出て、次の行の直前で消える。
- 歌い出しは音量と有声区間の解析からの推定。**耳で確認してこのファイルの数字を直せば、動画側は何も変えずに合う。**

## `shots.json` の形式（compose.py）

```json
{
  "cut": {"start": 187.43, "end": 238.28, "lead": 0.0},
  "lyrics": "lyrics_timing.json", "accent": [255,172,84], "grade": "night",
  "procedural_module": "animatic",
  "shots": [{
    "name": "01", "start": 187.43, "end": 198.0, "grade": "night",
    "camera": {"from": {"zoom": 1.0, "x": 0, "y": 0}, "to": {"zoom": 1.07, "x": 0.015, "y": -0.01}, "ease": "smooth"},
    "caption": {"text": "毎晩、僕は君の薬だった。", "until": 189.2},
    "layers": [
      {"file": "art/bg.png", "fit": "cover", "depth": 0.0},
      {"file": "art/glass.png", "x": 0.68, "y": 0.60, "w": 0.34, "depth": 0.6, "shadow": {"alpha": 0.5, "blur": 18, "offset": [10, 18]}},
      {"file": "art/tablet.png", "x": {"from": 0.84, "to": 0.68}, "y": 0.70, "w": 0.09, "depth": 0.7, "from_t": 189.4, "until": 192.0},
      {"video": "art/fizz.mp4", "x": 0.68, "y": 0.60, "w": 0.36, "from_t": 189.4},
      {"type": "phone_ui", "state": "call", "x": 0.33, "y": 0.40, "w": 0.255, "rot": -8, "until": 192.1},
      {"file": "art/line.png", "fit": "cover", "reveal": {"from_t": 194.8, "to_t": 197.6}}
    ],
    "fx": ["glow:0.33,0.40,520,196,212,240,0.45", "light_sweep:212.95,224.0,0.85", "dust:46", "dof:6", "bloom", "vignette:95", "grain:0.9"],
    "fade_in": 0.0, "fade_out": 0.8
  }]
}
```

- レイヤーは奥から順に描く。`depth` 0 が一番奥、1 が一番手前。カメラの寄り（zoom）とずらし（x, y は画面比）は奥行きに応じて効き方が変わる（パララックス）。
- `x, y, w, rot, opacity, blur, scale, typed` は数値か `{"from", "to"}`（そのカット内で補間）。
- `from_t` / `until` は絶対秒。`reveal` は上から下へ描き進める。`video` は動画クリップ（`from_t` から再生）。
- `type: "phone_ui"` は `procedural_module` のスクリプトにある `phone_screen()` を使う（スマホ画面など、生成イラストより手続き描画が向くもの）。
- 足りない画像は「灰色の枠にファイル名」の仮レイヤーになる。

## 実行

```bash
python3 common/compose.py --spec not-your-medicine/shots.json --song NOT_YOUR_MEDICINE.mp3 --out out.mp4
python3 common/compose.py --spec not-your-medicine/shots.json --song NOT_YOUR_MEDICINE.mp3 --stills 1,12,30 --out-dir stills/
```
