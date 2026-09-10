// 商品ページ用の派生情報: 3Dで光らせる部位、一緒に使うもの、施工班のひとこと
import { PRODUCTS, CATEGORIES, shelfOf } from "./catalog-data.js";

// 3Dのどの部位を光らせるか
export function partOf(p) {
  const n = p.name, c = p.cat;
  if (c === "pipe") return /アーチ/.test(n) ? "arch" : "purlin";
  if (c === "joint") return /天井|内ジョイント|スエジ/.test(n) ? "arch" : "joint";
  if (c === "reinforce") return /杭/.test(n) ? "anchor" : "reinforce";
  if (c === "fastener") return "fastener";
  if (c === "film") return "film";
  if (c === "door") return "door";
  if (c === "vent") return /天窓/.test(n) ? "roofvent" : /扇/.test(n) ? "curtain" : "vent";
  if (c === "curtain") return "curtain";
  if (c === "control") return "vent";
  if (c === "irrigation") return "irrigation";
  if (c === "gutter") return "arch";
  if (c === "mulch") return /ネット/.test(n) ? "net" : "irrigation";
  if (c === "animal") return "anchor";
  return "arch";
}
export const PART_LABEL = { arch: "アーチ(骨組)", purlin: "母屋・直管", joint: "アーチと直管の交点", endframe: "妻面の骨組", film: "被覆材(フィルム)", fastener: "フィルムの固定部(裾・肩)", door: "妻面のドア", vent: "側面の巻き上げ換気", net: "換気部の防虫ネット", roofvent: "天窓", curtain: "内張カーテン", irrigation: "潅水(うねの上)", reinforce: "中柱・タイバー(補強)", anchor: "アーチの足元(基礎)" };

// 3Dで見せるときのハウス設定と視点
export function sceneFor(p) {
  const part = partOf(p);
  const base = { span: 5.4, length: 18, eave: 1.6, ridge: 3.0, pitch: 0.5, pipe: 25.4, film: "po015", doors: 2, sideVent: "both", ventDrive: "manual", roofVent: part === "roofvent", curtain: part === "curtain", insectNet: part === "net" || part === "vent", irrigation: part === "irrigation" ? "drip" : "none", snow: part === "reinforce" };
  if (base.curtain === true) base.curtain = "manual"; else base.curtain = "none";
  const dia = (p.name + " " + p.spec).match(/φ(\d+(?:\.\d+)?)/); if (dia && [19.1, 22.2, 25.4, 31.8].includes(Number(dia[1]))) base.pipe = Number(dia[1]);
  const view = { door: "front", endframe: "front", irrigation: "interior", curtain: "interior", roofvent: "exterior" }[part] || "exterior";
  return { params: base, part, view };
}

// φの取り出し
const diaOf = p => { const m = (p.name + " " + p.spec).match(/φ(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; };

// 一緒に使うもの(最大4点)。同じφ・同じ用途のつながりで選ぶ
export function companions(p) {
  const d = diaOf(p), out = [];
  const add = (pred) => { for (const q of PRODUCTS) if (q.id !== p.id && !out.includes(q) && pred(q)) out.push(q); };
  switch (p.cat) {
    case "pipe": add(q => q.cat === "joint" && diaOf(q) === d); add(q => q.cat === "fastener" && diaOf(q) === d); add(q => q.cat === "reinforce" && /杭/.test(q.name)); break;
    case "joint": add(q => q.cat === "pipe" && diaOf(q) === d); add(q => q.cat === "joint" && diaOf(q) === d); break;
    case "reinforce": add(q => q.cat === "pipe" && diaOf(q) === (d || 31.8)); add(q => q.cat === "joint" && /パイプクロス|バンド/.test(q.name)); break;
    case "fastener": add(q => q.cat === "film"); add(q => q.cat === "fastener" && q.id.startsWith(p.id.startsWith("TT") ? "TT" : "ST")); add(q => q.cat === "pipe" && diaOf(q) === d); break;
    case "film": add(q => q.cat === "fastener"); add(q => q.cat === "mulch" && /防虫/.test(q.name)); break;
    case "door": add(q => q.cat === "door"); add(q => q.cat === "fastener" && /止金具|パッカー/.test(q.name)); break;
    case "vent": add(q => q.cat === "vent" && /パイプ|制御盤/.test(q.name)); add(q => q.cat === "mulch" && /防虫/.test(q.name)); add(q => q.cat === "control" && /プロファインダー/.test(q.name)); break;
    case "curtain": add(q => q.cat === "curtain"); add(q => q.cat === "control" && /暖房|プロファインダー/.test(q.name)); break;
    case "control": add(q => q.cat === "control"); add(q => q.cat === "vent" && /電動|制御/.test(q.spec + q.name)); break;
    case "irrigation": add(q => q.cat === "irrigation"); add(q => q.cat === "mulch" && /マルチ/.test(q.name)); break;
    case "gutter": add(q => q.cat === "gutter"); add(q => q.cat === "joint" && /天井/.test(q.name)); break;
    case "mulch": add(q => q.cat === "mulch"); add(q => q.cat === "fastener" && /パッカー/.test(q.name)); break;
    case "animal": add(q => q.cat === "animal"); add(q => q.cat === "reinforce" && /杭/.test(q.name)); break;
  }
  return out.slice(0, 4);
}

// 適合(合うもの)の説明文
export function fitText(p) {
  const d = diaOf(p);
  if (p.cat === "joint" || p.cat === "fastener" || p.cat === "reinforce") return d ? `φ${d}mm のパイプに合います。お使いのハウスのパイプ径は、アーチの太さで確認できます(標準的な単棟は φ22.2 または φ25.4)。` : "パイプ径によって品番が変わります。わからないときは写真を送ってください。";
  if (p.cat === "pipe") return d ? `太さ φ${d}mm。同じ径の金具・パッカーを選んでください。` : "";
  if (p.cat === "film") return "間口と奥行から必要な幅と長さを計算します。ハウスカルテがあれば自動で選びます。";
  if (p.cat === "vent") return "巻き上げ長さ(ハウスの奥行)に合わせて機種が変わります。";
  return "";
}

// 施工班のひとこと(カテゴリ別・編集用の下書き)
export const TIPS = {
  pipe: "曲げ加工済みのアーチは、届いたその日に組めます。φ25.4は迷ったときの標準です。",
  joint: "クロス金具は1棟で数十個使います。予備を1袋持っておくと台風のあとに助かります。",
  reinforce: "雪の日に効くのは太いパイプより、中柱とタイバーです。既設ハウスにも後から入れられます。",
  fastener: "スプリングは消耗品。張り替えのたびに3割ほど替えると、風でフィルムが抜けません。",
  film: "張り替えは朝のうちに。日中はフィルムが伸びて、夕方にたるみます。",
  door: "ドアの建付けは妻面の骨組で決まります。ガタつきは早めにご相談ください。",
  vent: "巻き上げ機は年に一度、ワイヤーとギアの注油で長持ちします。",
  curtain: "保温カーテンは隙間が命。妻面側の処理までご案内します。",
  control: "環境制御は、まず測ることから。1棟だけ測っても翌年の作りが変わります。",
  irrigation: "点滴チューブは目詰まりが敵。フィルターは季節の初めに掃除を。",
  gutter: "連棟の谷は、雪と落ち葉が溜まる場所。秋に一度、掃いておきましょう。",
  mulch: "防虫ネットは目合いが細かいほど風を通しにくくなります。1mm目が換気とのバランス点です。",
  animal: "電気柵は下段の高さが決め手。イノシシは20cm、シカは高さで防ぎます。"
};
export const tipFor = p => TIPS[p.cat] || "";
export const catLabel = id => (CATEGORIES.find(c => c.id === id) || {}).label || "";
export { shelfOf };
