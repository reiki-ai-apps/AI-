# 流入元別アクセス画面（2026-09-17）

## アプリで見る

- ログイン済みの管理者は、画面上部の人数・回数の横の「分析を見る」から開く。
- 直接の入口: https://reiki-ai-apps.github.io/AI-/#operator
- 初期表示は「今日」。昨日・7日・30日・全期間への切り替えが可能。
- X・YouTube・Web検索の回数を先頭に大きく表示。Web検索はGoogle、Yahoo!、Bing、DuckDuckGo、Braveの回数を合算。ユニーク数は単純合算しない。
- Instagram等、直接・不明、アプリ内リンク、過去の未記録は別に表示。時間帯別、日別、新規／再訪、累計、CSVは下で確認。
- アプリが開いている間は毎分再取得。日報は保存されたイベントから集約するため、利用者が毎日作業する必要はない。

## 計測リンク

アプリの「X・YouTubeに貼る計測用リンク」からコピーできる。

- X: https://reiki-ai-apps.github.io/AI-/?utm_source=x&utm_medium=social
- YouTube: https://reiki-ai-apps.github.io/AI-/?utm_source=youtube&utm_medium=video

クリックしただけでなく、ページが開かれて記録が送信された回数を数える。SNS内ブラウザーなどが参照元を渡さない場合に備え、既存投稿の書き換えはせず、今後の共有に使えるリンクを提供する。復帰表示は新しいX／YouTube流入としては再計上しない。検索元の偽装ドメインも検索として扱わない。

## 本番DBの有効化（この変更の準備時点では未適用）

本番 Supabase の ncosmmesecpqhzfikpmn が対象。supabase/access-insights-2026-09-17.sql の最新版を一度適用する。列・関数・インデックスの追加であり、既存イベントやカウンターの削除はしない。再適用も可能。

接続が確認できるまでは実数が見えるとは報告しない。SQL未適用の画面は理由を表示し、流入元の値は「—」。0回を装わない。過去に流入元を記録していないアクセスは復元できず「過去の未記録」として扱う。

確認: 匿名・一般ユーザーからの集計取得拒否、運営者のみ取得可、同じUUIDの再送で二重計上しないこと、旧カウンター維持、日付境界、Web検索各分類、通信失敗時の表示。

参考: [Supabaseの関数権限](https://supabase.com/docs/guides/database/functions)、[参照元情報の仕様](https://developer.mozilla.org/en-US/docs/Web/API/Document/referrer)。
