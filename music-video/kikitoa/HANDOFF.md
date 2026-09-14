# 手元の Claude Code に移すには

いまの作業はブラウザ版（リモート実行環境）で動いている。手元に移すと、
ここで詰まっていたことがそのまま解ける。

## 移すと解けること

| ここで詰まっていたこと | 手元だと |
|---|---|
| Higgsfield の CDN に到達できず、生成した絵を取り出せない | 普通に落とせる。`common/fetch_assets.py` がそのまま動く |
| 原寸(1152x2048)が持ってこられず、380px で作業していた | 原寸で作れる。足元の粗と寄りのボケが消える |
| `api.openai.com` が遮断されていて GPT が使えない | 使える（API キーは別途必要） |
| 50 秒の書き出しに数分、容量も食う | 手元の方が速いし、書き出したものがそのまま手元にある |
| 動画を見るのに毎回チャット経由 | 直接再生できる |

## 手順

### 1. 取ってくる

```bash
git clone https://github.com/reiki-ai-apps/AI-.git
cd AI-
git checkout claude/music-video-examples-05xvns
```

### 2. 入れる

```bash
pip install -r music-video/requirements.txt
```

ffmpeg も要る（pip では入らない）:

- macOS `brew install ffmpeg`
- Ubuntu `sudo apt install ffmpeg`
- Windows `winget install Gyan.FFmpeg`

日本語フォントは自動で探す（macOS のヒラギノ、Windows の游ゴシック、Linux の IPA）。
見つからないと止まるので、その場合は `MVKIT_FONT` に .ttf / .ttc のパスを入れる。

### 3. 音源を置く

リポジトリには入っていない（著作物なので）。手元の以下に置く:

```
music-video/audio/NOT_YOUR_MEDICINE.mp3
music-video/audio/PAPER_PLANE_ROYALTY.mp3
```

### 4. 絵を取ってくる

生成済みの絵は Higgsfield の CDN にある。URL は `art/assets.json` に入っている。

```bash
python3 music-video/common/fetch_assets.py music-video/kikitoa/art/assets.json
```

**リポジトリに入っている PNG は確認用の縮小版**（380px 等）。これで原寸に入れ替わる。

### 5. 動かす

```bash
cd music-video/kikitoa/nym
python3 prep_layers.py
python3 build_shots.py
python3 ../../common/compose.py --spec shots.json \
        --song ../../audio/NOT_YOUR_MEDICINE.mp3 --out nym.mp4
```

### 6. Claude Code を起動する

`music-video/CLAUDE.md` に決まりごとが書いてある。`music-video/` の中で
起動すれば自動で読まれる。

```bash
cd music-video
claude
```

## いまどこまで進んでいるか

**できているもの**

- キャラクター C が決定（`WORLD.md`）
- C の絵が 2 枚（後ろ姿の屋上 / 白背景のキャラクターシート）
- NOT YOUR MEDICINE を 14 カットで組んだもの（`nym/`）。50 秒フルで書き出し済み
- 風の揺れ・光の粒・琥珀の線・拍同期の字幕まで入っている

**次にやること**

1. **絵を増やす。** これが一番効く。何が要るかは `SHOT_LIST.md` に発注書がある。
   16 枚で約 2 クレジット。Higgsfield の残高は 0.10 なので追加が要る
2. 顔のアップを出す前に Soul を学習させる（外見の記述だけでは顔が毎回ずれる）
3. PAPER_PLANE_ROYALTY を同じやり方で組む

**まだ決まっていないこと**

- 名前を「キキ」にするか
- C の性別の読ませ方（中性的に出ている）
- 絵をどこで作るか（Higgsfield / GPT / 手描き）

## 読む順番

| | |
|---|---|
| `../CLAUDE.md` | 決まりごと。最初にこれ |
| `WORLD.md` | キャラクターと世界観 |
| `SHOT_LIST.md` | 次に要る絵の発注書 |
| `PIPELINE.md` | 生成と組み立ての知見。何が駄目だったかも全部 |
| `nym/README.md` | NOT YOUR MEDICINE の動かし方 |
