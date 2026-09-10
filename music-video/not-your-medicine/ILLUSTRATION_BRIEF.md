# NOT YOUR MEDICINE「線を引く夜」イラスト発注書

目的: アニマティックで決めたカット割り・タイミングはそのままに、絵を**アニメ背景美術レベル**に置き換える。
絵は生成ツール（Midjourney / niji / Nano Banana / Imagen 等）で作り、`shots.json` に指定したレイヤーとして
`common/compose.py` に読み込ませる。動きはコンポジター側（カメラ・パララックス・光・粒子・字幕）で付ける。
本当に動く絵が欲しいカット（発泡・朝の光）だけ、静止画を Kling / Veo で動画化して差し替える。

## スタイルガイド（全カット共通。1本の中で絶対にぶらさない）

- 画風: 日本のアニメ背景美術。写実寄りだが線は柔らかく、ハイライトは繊細。人物は出さない。
- 時間と色: 深夜 2:14 は**青**（群青〜藍、影は青黒）。唯一の暖色は画面右上のランプの**琥珀**。朝は琥珀が全体に広がる。
- 光源: 夜は「スマホ画面の冷たい白青」と「ランプの琥珀」の2つだけ。朝は「右の窓からの低い光」。
- 質感: 木のテーブル（暗い、少しマットな艶）、厚手のガラス、白い錠剤（割線あり）、黒いスマホ。
- 構図: すべて縦 9:16（`--ar 9:16`）。文字が入る**下 25% と上 17% は主役を置かない**。
- 解像度: 2160×3840 以上（コンポジターでカメラが寄るため 2 倍で作る）。
- 一貫性: 1枚目が決まったら、その画像を `--sref`（Midjourney）や参照画像（Nano Banana）に入れて残りを作る。
- 禁止: 人物、手、文字、ロゴ、ネオン、紫ピンク、被写界深度の強すぎるボケ（ボケはコンポジターで付ける）。

共通の英語プロンプト末尾（毎回付ける）:
`anime background art, cinematic, soft painterly linework, subtle highlights, film still, no people, no text --ar 9:16 --style raw`

## レイヤーの考え方

各カットを「背景（bg）」「中景（mid）」「前景（fg）」に分け、**中景と前景は透過 PNG** で用意する。
コンポジターは奥行きごとに動かし（パララックス）、カメラの寄り・ずらし・被写界深度を付ける。
透過が作れないツールの場合は、背景だけを 1 枚絵で作り、テーブル上の物は「物だけの正方形の絵」を作って渡せばよい（背景除去はこちらで行う）。

## カット別の発注

| # | 秒 | シーン | 必要なレイヤー | プロンプト（日本語の意図 → 英語） |
|---|---|---|---|---|
| 1 | 0–10.6 | 深夜のテーブル俯瞰 | bg: テーブル面 / mid: スマホ（画面は黒でよい。UIはこちらで合成）、グラス、錠剤（各 透過） | 真上から見た深夜の木のテーブル。左上に黒いスマホ、右下に水の入った厚いグラス、その横に白い錠剤。青い闇、右上からの弱い琥珀のランプ光。<br>`top-down view of a dark wooden table at 2 a.m., a black smartphone upper left, a thick glass of water lower right, one white tablet beside it, deep blue darkness, faint amber lamp light from the upper right, ...` |
| 2 | 10.6–17.2 | 横アングル、ランプに照らされたグラス | bg: 暗い部屋の壁とテーブルの縁 / mid: グラス（透過） / fg: 錠剤（透過） | 深夜、テーブルの上の水のグラスを横から。奥にぼんやり琥珀のランプ。ガラスの縁と水面に細い光。<br>`side view of a glass of water on a table at night, warm amber lamp glow behind it, thin rim highlights on the glass and the waterline, deep blue shadows, ...` |
| 3 | 17.2–25.5 | 静かな水面に寄る | bg: 1 のテーブル面（同じ絵を流用） / mid: グラス俯瞰（透過、1より大きく描く） | グラスの水面を真上から大きく。窓の四角い反射、ごく薄い夜明けの色。<br>`extreme close-up top-down of still water in a glass, a faint rectangular window reflection on the surface, the first hint of dawn, blue to pale amber, ...` |
| 4 | 25.5–36.7 | 朝の光がテーブルを横切る | bg: 1 のテーブル面の**朝版**（同構図、右から低い朝日、長い影） / mid: 1 の物（同じ透過を流用） | 1 と同じ構図で朝。右の窓から低い金色の光がテーブルを横切り、グラスと錠剤が長い影を落とす。<br>`same top-down table, early morning, low golden sunlight sweeping in from the right, long soft shadows from the glass and tablet, warm amber and cream, ...` |
| 5 | 36.7–42.8 | スマホのクローズアップ | なし（スマホ本体と画面はこちらで合成。背景は 4 の朝版を流用） | — |
| 6 | 42.8–50.9 | 引きの俯瞰、朝 | 4 と同じ | — |

つまり**新規に描く絵は 5 種類**（1 テーブル夜、2 横のグラス、3 水面、4 テーブル朝、＋物の透過 3 点）。

## 動画化が欲しいカット（任意、Kling / Veo）

| # | 元画像 | 動きの指示 |
|---|---|---|
| 1b | 1 のグラス部分 | 白い錠剤が水に落ちて発泡し、細かい泡が上がって溶けて消える。5秒。<br>`a white tablet drops into the glass and fizzes, fine bubbles rise, it dissolves and disappears, camera static, 5s` |
| 4b | 4 | 右から左へ朝の光がゆっくり横切り、影が伸びる。6秒。<br>`morning light slowly sweeps across the table from right to left, shadows lengthen, camera static, 6s` |

動画で差し替える場合は `shots.json` の該当レイヤーを `"video": "path.mp4"` にする。

## 納品の置き場所

```
music-video/not-your-medicine/art/
  01_table_night_bg.png   02_glass_side_bg.png   03_water_closeup_bg.png   04_table_dawn_bg.png
  obj_phone.png  obj_glass_top.png  obj_tablet.png  obj_tablet_side.png  obj_tablet_standing.png
  obj_line.png（線。こちらで作成済み）
  (任意) 01b_fizz.mp4  04b_dawn.mp4
```

| ファイル | 内容 |
|---|---|
| `obj_phone.png` | 黒いスマホ本体を真上から（画面は真っ黒でよい。画面表示はこちらで合成）。透過 |
| `obj_glass_top.png` | 水の入ったグラスを真上から。透過 |
| `obj_tablet.png` | 白い錠剤（割線あり）を真上から。透過 |
| `obj_tablet_side.png` | 同じ錠剤を真横から（細長い）。透過 |
| `obj_tablet_standing.png` | 立った錠剤を真上から（細長い楕円＋影は不要）。透過 |

置いたら `python3 ../common/compose.py --spec shots.json --song NOT_YOUR_MEDICINE.mp3 --out nym_illustrated.mp4` で動画になる。
足りないレイヤーは自動で仮の絵（灰色の枠にファイル名）になるので、揃っていなくても通しで確認できる。
