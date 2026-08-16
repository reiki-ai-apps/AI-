# 予約状況の同期契約

`status.json` の最優先目的は、Asia/Tokyo の今日を起点に「今日・明日・2日後」の予約がすべて完了しているかを示すことです。

- `reservation_horizon.horizon_days` は `2` に固定する。
- `reservation_horizon.days` は今日から2日後までの3日を日付順に持つ。
- 各日の `state` は、必要な予約証跡を確認できた場合だけ `RESERVED`、それ以外は `MISSING` とする。
- 3日のうち1日でも `MISSING`、欠落、未確認があれば全体を `DANGER` とする。推測で `RESERVED` にしない。
- 各媒体は2日先までの予約証跡がそろった場合だけ `reservation_state: "COVERED"`、それ以外は `MISSING` とする。
- AI進化レーダーはPOST BOARDの予約監視対象に含めない。
- 予約日時、対象媒体、投稿IDまたは予約receiptが変わった場合は、その実行でこの状態を再計算する。

公開済み件数や制作状況は補助情報です。予約不足より上位の正常判定には使用しません。
