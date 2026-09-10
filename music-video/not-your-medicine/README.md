# NOT YOUR MEDICINE「線を引く夜」アニマティック

kikitoa「NOT YOUR MEDICINE」（4分16秒、172 BPM、Suno 生成）の TikTok / Shorts 用カットのプレビズ。
共通基盤 `../common/mvkit.py` を使ったプログラム描画で、実際の音源の拍に同期している。
Suno 自動生成ジャケットは使っていない。手は出さない。

## 曲から取った演出

歌詞の核は「愛しているから境界を作りたい。僕は君の薬じゃない。でも隣にはいる」。
"With a line"「境界」「消えていく」「薬」「Stand with me」を、そのまま物に置き換えた。

| 歌詞のモチーフ | 画面の物 |
|---|---|
| 薬 / 僕が消えていく | 水のグラスと白い錠剤。錠剤（=僕）は毎晩、水に溶けて消える |
| 苦しい夜はいつだって僕の名前を呼んできた | 深夜 2:14、スマホに「君」からの着信 |
| With a line / 境界 | テーブルに引かれる一本の白い線 |
| I'm not your medicine | 新しい錠剤はグラスの縁に立ち、水に落ちない。外側を滑ってテーブルに立つ |
| I can't disappear / Stand with me | 錠剤は立ったまま、朝の光で長い影を落とす |
| I can stay / I can care | 返信「薬にはなれない。でも、隣にはいる。」を打って送る |

色のルール: **夜は青、朝は琥珀。** 夜の唯一の暖色は右上のランプ。最終サビで朝の光が右から左へテーブルを横切る。

## カットと構成（音源 3:07.4 から 51秒）

| 相対拍 | 秒 | 歌詞 | 画面 |
|---|---|---|---|
| 0–30 | 0.0–10.6 | No cure / No savior / Just love / With a line | 夜のテーブル俯瞰。2:14 の着信。錠剤が水に落ちて発泡し消える。通話が切れて画面が暗くなる。線が引かれる。テロップ「毎晩、僕は君の薬だった。」 |
| 30–49 | 10.6–17.2 | I'm not your medicine / But I can meet you where you are | 横アングル、ランプに照らされたグラス。新しい錠剤は縁に立ったまま。外側を滑り降りてテーブルに立つ |
| 49–73 | 17.2–25.5 | I can love you deeply / Without becoming every scar | 静かな水面に寄る。夜明けの気配 |
| 73–105 | 25.5–36.7 | I'm not your medicine / You have strength… / If we learn… / Then maybe… | 朝の光が横切る。立った錠剤に長い影。スマホに「起きてる？」 |
| 105–123 | 36.7–42.8 | I can stay / I can care / I can love without disappearing | スマホのクローズアップ。返信を1文字ずつ打つ。送信 |
| 123–146 | 42.8–50.9 | I'm not your medicine / I'm just someone choosing to be here | 引きの俯瞰。朝の光の中、線とグラスと立ったままの錠剤。フェードアウト |

字幕は英語＋日本語訳のブロック（アクセント線は琥珀）。日本語の行は無し（このカットは全て英語）。

## 作り方

```bash
pip install numpy librosa soundfile pillow imageio-ffmpeg
python3 animatic.py --song NOT_YOUR_MEDICINE.mp3 --grid-json grid.json --out animatic.mp4
python3 animatic.py --song NOT_YOUR_MEDICINE.mp3 --grid-json grid.json --stills 0.3,12,35 --out-dir stills/
```

## 前提と限界

- 拍位置とセクション（ブレイク頭・サビ頭・小休止・復帰・句切れ）は音量の変化から自動で決めている。
  歌い出しとの一致は耳で確認していない。字幕の行の割り当ては `SUB_TIMING` の拍数で直す。
- 絵はプレビズ。本番はテーブル・グラス・スマホを実写で撮り、発泡と朝の光はそのまま実写で足せる（AI 生成は不要な設計）。
