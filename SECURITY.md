# Security policy

AI進化レーダーは、カード情報をアプリ内に保存せず、決済画面と契約管理画面を Stripe に委託します。認証と会員データは Supabase を利用し、公開用の GitHub Pages には秘密鍵・決済情報・顧客データを配置しません。

## 定期診断

- 毎月1回、GitHub Actionsでソース検査、CodeQL、OWASP ZAPの公開サイト診断を実行します。
- `main`への変更時にもソース検査とCodeQLを実行します。
- 認証、決済、会員データ、外部URL処理を変更した場合は、公開前に手動レビューと再診断を行います。
- 診断レポートは90日間保存し、重大・高リスクの問題は決済公開前に修正します。

## 実装済みの対策

- Supabaseの全会員テーブルでRow Level Securityを有効化
- SECURITY DEFINER関数の`search_path`固定と実行権限の最小化
- Stripe Webhook署名検証とイベント重複検知
- Checkoutの会員ID・メールアドレス・Price ID照合
- 外部URLをHTTP(S)に限定し、ローカル・プライベートアドレスを拒否
- 表示文字列のHTMLエスケープと入力値の長さ・範囲検証
- Content Security Policy、Referrer Policy、外部ライブラリのバージョン固定
- Stripe管理者アカウントの2段階認証

## 問題を発見した場合

公開のIssueには、秘密鍵、個人情報、再現用の顧客データを投稿しないでください。運営者は、重大・高リスクの問題では決済または該当機能を停止し、修正・再診断後に再開します。
