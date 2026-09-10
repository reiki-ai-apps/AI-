// サイト全体の設定。正式運用時はここだけ書き換えます。
export const CONFIG = {
  companyName: "三高産業株式会社",
  // 本番データベース(Supabase)。URLとanonキーを入れると、ブラウザ保存から本番保存に切り替わります。
  supabaseUrl: "",
  supabaseAnonKey: "",
  // LINE公式アカウントの友だち追加URL(例: https://lin.ee/xxxxx)。空なら電話・メール案内を表示。
  lineAddFriendUrl: "",
  // 電話番号(入れると「電話で聞く」ボタンが発信になります。例: "0277-43-7181")
  tel: "",
  // 見積依頼の送信先。endpointを入れるとメールではなくAPIにJSON送信します。
  mailTo: "info@example.com",
  quoteEndpoint: "",
  // 担当者画面の簡易ロック(プロトタイプ用。本番はSupabase認証に置き換え)
  staffPin: "1234"
};
