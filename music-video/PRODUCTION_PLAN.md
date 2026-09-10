# 制作方針（確定版）— Higgsfield で作る

これまでの検討（Gemini / OpenAI API / ChatGPT 手動 / 実写）を踏まえた結論。
**Higgsfield Starter $19/月 が一番安く、しかも画像と動画が同じサブスクで揃う。**

## なぜ Higgsfield か

| 案 | 1曲あたり | 動画生成 | 備考 |
|---|---|---|---|
| Gemini API（Veo 3.1 + Nano Banana） | 数百円〜千円 | あり | 動画1本ずつ課金。画像モデルは4〜6位 |
| OpenAI API（GPT Image 2） | 数百円 | **なし** | Sora 2 は 2026-04 廃止、API も 09-24 停止 |
| ChatGPT で手動生成 → 合成 | 0 円 | なし | 静止画のみ。手間15分／曲 |
| **Higgsfield Starter $19/月** | **約 $6** | **あり（Kling 3.0）** | 画像は 0.125 クレジット＝実質無料 |
| Kling 直接契約 | 高い | あり | 単体だと割高 |

決め手は3つ。

1. **画像が実質タダ**。Soul 2.0 の 2K 画像が約 0.125 クレジット。270 クレジットで 2,000 枚以上。
2. **動画が本命の Kling 3.0**。8秒 720p が約 14 クレジット。2026年の動画モデル順位で1位。
3. **1曲6本＝約84クレジット**。Starter 1か月（270）で **3曲**まかなえる。

注意: クレジットは**翌月に繰り越されない**。契約した月にまとめて作るのが得。

## 役割分担

| 誰が | 何を |
|---|---|
| Higgsfield | 背景の動画クリップ 6 本（机・グラス・錠剤・光・朝） |
| 合成（Claude 側） | 拍に合わせたカット、キネティック字幕、スマホ画面の日本語、境界線、色調、粒子、ループ |

**生成側に文字を描かせない。** 日本語は必ず壊れるので、文字はすべて合成で乗せる。
プロンプトには毎回 `no text, no letters, no logos` を入れる。

## 接続方法: 公式 MCP コネクタ（これが本命）

Higgsfield は 2026-04-30 に**公式 MCP サーバー**を出した。Claude にコネクタとして繋ぐと、
**Claude が直接** 画像・動画を生成できる。API キーの受け渡しも、手動のダウンロード＆アップロードも要らない。

- サーバー: `https://mcp.higgsfield.ai/mcp`
- 認証: ブラウザ OAuth（Higgsfield アカウントでログインするだけ。API キー不要）
- 使えるツール: `generate_image` / `generate_video` / `create_character` / `get_generation_status` / `list_characters`
- 使えるモデル: Kling 3.0、Veo 3.1、Seedance 2.0、Sora 2、MiniMax Hailuo、GPT Image 2、Soul V2、Flux 2 など 30 以上
- 動画は 1 本あたり最大 15 秒（8 秒クリップ 6 本の構成がそのまま通る）

### 繋ぎ方（claude.ai 側で設定する）

この実行環境からは `mcp.higgsfield.ai` へ直接出られない（ネットワーク方針で遮断）。
一方 `mcp-proxy.anthropic.com` は到達できるので、**claude.ai のコネクタとして登録する**のが正しい経路。

1. claude.ai にログイン → 左の **Customize**（またはSettings）→ **Connectors**
2. **＋ → Add custom connector**
3. URL に `https://mcp.higgsfield.ai/mcp` を入れて追加
4. Higgsfield アカウントで OAuth ログイン
5. このブランチ `claude/music-video-examples-05xvns` で**新しいセッション**を開いて「Higgsfield で6本生成して」と言う

繋がると、このセッションに `mcp__higgsfield__generate_video` などのツールが現れる。
そうなれば発注書の 6 本を私がそのまま生成し、`art/` に保存して、書き出しまで一気に通せる。

（ローカルの Claude Code CLI で使う場合は
`claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp`。
ただしこのサンドボックスからは OAuth のブラウザ遷移ができないので、上の claude.ai 経由が確実。）

## 進め方

1. Higgsfield Starter を契約（$19）。
2. `not-your-medicine/HIGGSFIELD_SHOTS.md` のプロンプト 6 本を Web UI に貼って生成。
   1本目の最終フレームを次の開始画像にすると、机とグラスがぶれない。
3. mp4 を `not-your-medicine/art/` に指定の名前で保存。
4. こちらで書き出し:
   ```
   python3 common/compose.py --spec not-your-medicine/shots.json \
     --song NOT_YOUR_MEDICINE.mp3 --grid-json grid.json --out nym_final.mp4
   ```
5. 直しは `shots.json` の秒数と座標だけ。生成し直しは基本不要。

## 代替経路

| 経路 | 手間 | 備考 |
|---|---|---|
| **MCP コネクタ（推奨）** | 設定 2 分。あとは全部こちら | Claude が直接生成。キー不要 |
| Higgsfield Web UI で手動 | 20 分／曲 | 発注書のプロンプトを貼って mp4 を `art/` に置く |
| REST API | ネットワーク方針の変更が必要 | `common/gen_higgsfield.py` を用意済み。`platform.higgsfield.ai` の許可と `HIGGSFIELD_API_KEY` が要る |

## PAPER PLANE ROYALTY 側

同じ方式で 6 本。オフィスの机・蛍光灯・窓の街・花火。プロンプトは同曲の発注書を追って作る。
折り紙の工程だけは生成が破綻しやすいので、スマホ実写（俯瞰・1拍1折り）に任せる方が確実で速い。

---

（`ZERO_COST_WORKFLOW.md` は費用ゼロにこだわる場合の代替案として残す。画は静止画のみになる。）
