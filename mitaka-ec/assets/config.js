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
  // サンプルの3Dハウス。Blender などから書き出した .glb を assets/models/ に置いて、
  // ここに並べるとトップのヒーローと3Dシミュレーターで切り替えて見られます。
  // 空のままなら読みに行かず、これまでどおり寸法から組み立てたハウスを表示します。
  //   label: 画面に出す名前 / file: ファイルの場所 / width: 実寸で書き出していれば 0
  sampleModels: [
    // { label: "単棟ハウス", file: "assets/models/house-a.glb", width: 0 },
    // { label: "連棟ハウス", file: "assets/models/house-b.glb", width: 0 },
  ],
  // 担当者画面の簡易ロック(プロトタイプ用。本番はSupabase認証に置き換え)
  staffPin: "1234"
};
