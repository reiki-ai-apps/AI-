// csv.js — 会計・税理士向けCSV出力(純粋関数)。画面の数値と同じ計算式(money.js)だけを使う。
import { realCost, saleNet } from "./money.js";

export const CSV_HEADERS = [
  "日付",
  "取引種別",
  "商品名",
  "シリーズ",
  "数量",
  "購入先",
  "購入額",
  "購入送料",
  "購入手数料",
  "値引き",
  "ポイント利用",
  "実質原価",
  "売却先",
  "売却額",
  "販売手数料",
  "発送費",
  "梱包費",
  "実質利益",
  "状態",
  "注文番号",
  "備考",
];

function esc(v) {
  if (typeof v === "number") return String(v); // 金額・数量(負の利益含む)はそのまま
  let s = v === null || v === undefined ? "" : String(v);
  // CSVインジェクション対策: 表計算ソフトが数式として解釈し得る先頭文字を無害化
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function dateOnly(iso) {
  if (!iso) return "";
  // 日付のみ文字列はUTC解釈による日ずれを避けるためパースしない
  if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 商品リストから取引行を作る。
 * 仕入行: 全商品(キャンセル・返品除く。画面集計 finance.js と同じ基準)。売却行: 売却済み/入金済み。
 */
export function buildRows(products) {
  const rows = [];
  for (const p of products) {
    if (p.status === "キャンセル" || p.status === "返品") continue;
    const pu = p.purchase || {};
    rows.push({
      日付: dateOnly(pu.orderedAt),
      取引種別: "仕入",
      商品名: p.name,
      シリーズ: p.series || "",
      数量: p.quantity || 1,
      購入先: pu.store || "",
      購入額: pu.itemPrice ? Number(pu.itemPrice) : 0, // 商品購入額(画面の表記と同じ。送料等は右の列に分離)
      購入送料: pu.shippingFee ? Number(pu.shippingFee) : 0,
      購入手数料: pu.paymentFee ? Number(pu.paymentFee) : 0,
      値引き: pu.discount ? Number(pu.discount) : 0,
      ポイント利用: pu.pointsUsed ? Number(pu.pointsUsed) : 0,
      実質原価: safe(() => realCost(pu)),
      売却先: "",
      売却額: "",
      販売手数料: "",
      発送費: "",
      梱包費: "",
      実質利益: "",
      状態: p.status,
      注文番号: pu.orderNumber || "",
      備考: p.note || "",
    });
    if ((p.status === "売却済み" || p.status === "入金済み") && p.sale) {
      const s = p.sale;
      rows.push({
        日付: dateOnly(p.soldAt || s.soldAt),
        取引種別: "売却",
        商品名: p.name,
        シリーズ: p.series || "",
        数量: p.quantity || 1,
        購入先: "",
        購入額: "",
        購入送料: "",
        購入手数料: "",
        値引き: "",
        ポイント利用: "",
        実質原価: "",
        売却先: s.channel || "",
        売却額: s.grossAmount || 0,
        販売手数料: s.platformFee || 0,
        発送費: s.shippingFee || 0,
        梱包費: s.packingFee || 0,
        実質利益: safe(() => saleNet(s) - realCost(pu)),
        状態: p.status === "入金済み" ? "入金済み" : "未入金",
        注文番号: pu.orderNumber || "",
        備考: p.note || "",
      });
    }
  }
  rows.sort((a, b) => (a.日付 < b.日付 ? -1 : a.日付 > b.日付 ? 1 : 0));
  return rows;
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return "";
  }
}

/** CSV文字列(CRLF)。Excel向けにBOMはダウンロード時に付与する。 */
export function toCsv(rows) {
  const lines = [CSV_HEADERS.map(esc).join(",")];
  for (const r of rows) {
    lines.push(CSV_HEADERS.map((h) => esc(r[h])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
