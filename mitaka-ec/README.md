# 三高産業 ハウスEC(プロトタイプ)

ビニールハウス・パイプハウスの資材販売と施工のためのECサイト試作版です。
中心となる機能は **3Dハウスシミュレーター** で、間口・奥行・被覆材・換気などを選ぶと、
3Dモデル・数量・概算見積りがその場で表示されます。

サーバー不要の静的サイトなので、このリポジトリの GitHub Pages でそのまま公開できます。
公開URLの例: `https://<ユーザー名>.github.io/<リポジトリ名>/mitaka-ec/`

## ページ構成

| ファイル | 内容 |
|---|---|
| `index.html` | トップページ(特徴・取り扱い資材・ご利用の流れ・FAQ) |
| `simulator.html` | 3Dハウスシミュレーター + 概算見積り(URLに内容を保存) |
| `catalog.html` | 資材カタログ(カテゴリ絞り込み・検索・見積リスト) |
| `quote.html` | 見積依頼フォーム(シミュレーター内容と見積リストを添えて送信) |
| `partners.html` | 資材店・施工店・メーカー向けの出店・パートナー募集 |

## 仕組み

| ファイル | 役割 |
|---|---|
| `assets/pricing.js` | **数量計算と概算見積りのロジック。単価表(`UNIT`)と選択肢(`OPTIONS`)はここ。** |
| `assets/house3d.js` | three.js によるハウスの3D描画(アーチ・母屋・被覆材・ドア・換気・カーテン・潅水・耐雪補強) |
| `assets/simulator.js` | シミュレーター画面の入力と表示の制御 |
| `assets/catalog-data.js` | カタログのサンプル商品データ |
| `assets/catalog.js` / `assets/quote.js` / `assets/site.js` | 各ページの動作と共通UI(ナビ・見積リスト) |
| `assets/style.css` / `assets/simulator.css` | デザイン |
| `vendor/three/` | three.js r180(MIT)。CDNに依存せず動くように同梱 |

## 正式運用の前にやること

1. **単価を差し替える** — `assets/pricing.js` の `UNIT` と `OPTIONS.films[].perSqm` を自社の単価表に合わせる。`PRICING_VERSION` の文字列も更新する。
2. **見積依頼の送信先を設定する** — `assets/quote.js` の `CONFIG.mailTo` を受付用メールアドレスに変更する。
   フォーム受付API(Supabase Edge Function、Formspree など)を用意したら `CONFIG.endpoint` にURLを入れると、メールではなくAPIにJSONで送信します。
3. **会社情報を入れる** — 各ページのフッター(住所・電話・FAX)と `quote.html` の連絡先欄はプレースホルダーです。
4. **カタログを実データにする** — `assets/catalog-data.js` を商品マスタから生成する(CSV→JS変換で十分です)。
5. **検索エンジンに公開する** — 各ページの `<meta name="robots" content="noindex">` を外し、ページ上部の「プロトタイプ版」バナーを削除する。

## 概算見積りの計算方法(概要)

- アーチは「垂直の脚 + 半楕円」でモデル化し、弧長をラマヌジャンの近似式で求めています。
- アーチ本数 = 奥行 ÷ アーチ間隔 + 1。母屋の本数は間口で 3・5・7 通りに切り替わります。
- 被覆材面積は屋根・側面・両妻面の合計に 10% のロスを加えています。
- 施工費は床面積 × m²単価 + 基本料。運搬費は地域で固定額(その他地域は別途見積り)。
- 消費税は 10% で計算しています。

## 今後の拡張候補

- 注文・決済(Stripe など)と会員機能(Supabase Auth)
- 出店者ごとの単価設定・商品管理(マルチテナント)
- 3Dモデルの画像付き見積書PDFの自動生成
- 現地写真のアップロード、既存ハウスの張り替え見積り
- 補助金メニューの案内と申請書類の下書き支援

## 動作確認

Node.js と Playwright があれば、ローカルで次のように確認できます。

```bash
npx serve mitaka-ec   # または python3 -m http.server -d mitaka-ec 8000
```

ブラウザで `http://localhost:3000/simulator.html` を開きます。3D表示には WebGL が必要です。
