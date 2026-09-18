# Instagramの既存プロフィールリンク対応

## 確認した事実

2026-09-19に、KIZASHIの公開Instagramプロフィール `https://www.instagram.com/kizashi_jp/` の「AI進化レーダー」リンクを確認した。リンクには `utm_source=ig&utm_medium=social&utm_content=link_in_bio` が付いていた。

旧トラッカーは `instagram` と既知のInstagram参照元ドメインには対応していたが、`ig` は認識しなかった。このリンクから開き、かつブラウザーが参照元を渡さない場合は `direct_unknown` になる。過去の全ての判別不可アクセスがInstagramだったという証拠ではない。

## 修正

- 既存タグ `ig` を `instagram` に正規化する。
- 既存の `instagram` タグは引き続き使用可能。
- キャッシュ番号を v41 に更新。
- SNSのプロフィールや投稿の保存操作、DBの過去イベント変更はしていない。

## 検証

修正前にプロフィールと同形式のURL・参照元なしのテストを追加し、期待値 `instagram` に対して実際は `direct_unknown` となる失敗を再現した。

修正後は `ig`、`IG`、参照元欠落、他の参照元がある場合のUTM優先を確認。`ig.evil.example` など類似文字列は認識しない。URLの全文やクリック識別子を送信しない。復帰時に元のSNSの流入を重複計上しない。運営者の除外、通信再送時のUUID、他のSNSの分類は維持。

本番へテストアクセスは送らず、隔離した模擬ブラウザーで検証する。過去の `direct_unknown` を推測で書き換えない。
