const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const BASE='https://reiki-ai-apps.github.io/AI-/assets/story-visuals/';
const ID=/^article_[A-Za-z0-9_-]{8,90}$/;
function storyVisualId(item){
  const id=String(item?.article_id||'');
  return ID.test(id)&&String(item?.content_type||'article')!=='expert_video'?id:'';
}
function storyVisualUrl(item){
  const id=storyVisualId(item);
  return id?`${BASE}${id}.svg`:'';
}
function xml(value){
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
}
function theme(item){
  const text=[item.title,item.story_subject,item.primary_entity,...(item.related_categories||[])].join(' ');
  if(/脆弱性|セキュリティ|サイバー|攻撃|情報漏えい|ハッキング/i.test(text))return {name:'SECURITY',color:'#29d8c8',icon:'shield'};
  if(/半導体|GPU|チップ|Nvidia|メモリ|データセンター/i.test(text))return {name:'COMPUTE',color:'#87d96c',icon:'chip'};
  if(/法案|政府|規制|国会|政策|司法|裁判|提訴/i.test(text))return {name:'POLICY',color:'#ffbc70',icon:'policy'};
  if(/動画|映像|画像生成|デザイン|音楽|クリエイティブ/i.test(text))return {name:'CREATE',color:'#f78cc9',icon:'media'};
  if(/投資|株価|株式|決算|買収|資金調達|売上/i.test(text))return {name:'BUSINESS',color:'#ffc76b',icon:'chart'};
  if(/エージェント|自動化|ロボット|連携|提携/i.test(text))return {name:'AGENTS',color:'#9aa5ff',icon:'nodes'};
  return {name:'AI UPDATE',color:'#65d5fb',icon:'spark'};
}
function glyph(name,color){
  const common=`fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"`;
  if(name==='shield')return `<path ${common} d="M130 46 208 77v67c0 64-36 102-78 126-42-24-78-62-78-126V77z"/><path ${common} d="m93 153 25 25 51-57"/>`;
  if(name==='chip')return `<rect ${common} x="61" y="69" width="138" height="138" rx="22"/><rect ${common} x="99" y="107" width="62" height="62" rx="7"/><path ${common} d="M92 40v29m48-29v29m48-29v29M92 207v29m48-29v29m48-29v29M32 100h29m-29 43h29m-29 43h29m138-86h29m-29 43h29m-29 43h29"/>`;
  if(name==='policy')return `<path ${common} d="m49 92 81-43 81 43M55 222h150M44 239h172M72 99v109m39-109v109m39-109v109m39-109v109"/>`;
  if(name==='media')return `<rect ${common} x="45" y="65" width="170" height="145" rx="24"/><path ${common} d="m111 103 55 35-55 35zM70 229h120"/>`;
  if(name==='chart')return `<path ${common} d="M47 221V75m0 146h175M79 194v-53m50 53V98m50 96V61"/><path ${common} d="m76 122 52-37 50 14 34-47"/>`;
  if(name==='nodes')return `<circle ${common} cx="129" cy="61" r="24"/><circle ${common} cx="57" cy="194" r="24"/><circle ${common} cx="205" cy="194" r="24"/><path ${common} d="m116 82-44 91m70-91 48 91M81 194h100"/>`;
  return `<path ${common} d="M130 38v58m0 94v58M25 143h58m94 0h58M56 69l41 41m66 66 41 41m0-148-41 41m-66 66-41 41"/><circle ${common} cx="130" cy="143" r="24"/>`;
}
function storyVisualSvg(item){
  const id=storyVisualId(item);
  if(!id)throw new Error('A published article_id is required for an article visual');
  const hash=crypto.createHash('sha256').update(id+'|'+String(item.title||'')).digest();
  const category=theme(item);
  const baseHue={SECURITY:160,COMPUTE:85,POLICY:22,CREATE:300,BUSINESS:35,AGENTS:225,'AI UPDATE':185}[category.name];
  const style={...category,color:`hsl(${baseHue+hash[0]%48} 88% 72%)`};
  const title=String(item.title||'AIニュース').replace(/\s+/g,' ').trim();
  const first=title.slice(0,18);
  const second=title.length>18?title.slice(18,35)+(title.length>35?'…':''):'';
  const dots=Array.from({length:22},(_,i)=>{
    const x=300+((hash[i%32]*47+i*127)%880);
    const y=35+((hash[(i+11)%32]*13+i*53)%335);
    return `<circle cx="${x}" cy="${y}" r="${2+(hash[(i+5)%32]%4)}" fill="${style.color}" opacity=".15"/>`;
  }).join('');
  const n=hash.readUInt32BE(0).toString(16).padStart(8,'0').toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400" role="img" aria-label="${xml(title)}のための図解サムネイル">
<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#061323"/><stop offset=".56" stop-color="#102649"/><stop offset="1" stop-color="#17144a"/></linearGradient><radialGradient id="glow"><stop stop-color="${style.color}" stop-opacity=".24"/><stop offset="1" stop-color="${style.color}" stop-opacity="0"/></radialGradient></defs>
<rect width="1200" height="400" fill="url(#bg)"/><circle cx="${700+hash[1]}" cy="${80+hash[2]}" r="350" fill="url(#glow)"/>
<path d="M0 326 Q420 ${280+hash[3]%80} 1200 ${290+hash[4]%75}" fill="none" stroke="${style.color}" stroke-opacity=".14" stroke-width="3"/>${dots}
<rect x="24" y="26" width="252" height="348" rx="32" fill="#081525" stroke="${style.color}" stroke-opacity=".58" stroke-width="3"/>
<g transform="translate(20 63)">${glyph(style.icon,style.color)}</g>
<text x="303" y="83" fill="${style.color}" font-family="Arial,sans-serif" font-size="24" font-weight="700" letter-spacing="5">KIZASHI / ${style.name}</text>
<text x="300" y="184" fill="#f5fbff" font-family="Noto Sans JP, Yu Gothic, Meiryo, sans-serif" font-size="48" font-weight="800">${xml(first)}</text>
${second?`<text x="300" y="252" fill="#f5fbff" font-family="Noto Sans JP, Yu Gothic, Meiryo, sans-serif" font-size="48" font-weight="800">${xml(second)}</text>`:''}
<path d="M302 318h${120+hash[6]}" stroke="${style.color}" stroke-width="5" stroke-linecap="round"/>
<text x="302" y="361" fill="#a8c5d8" font-family="Arial,sans-serif" font-size="17" letter-spacing="3">ARTICLE-SPECIFIC VISUAL / ${n}</text>
</svg>`;
}
function writeStoryVisuals(items,root){
  const dir=path.join(root,'assets','story-visuals');
  fs.mkdirSync(dir,{recursive:true});
  let count=0;
  for(const item of items){
    const id=storyVisualId(item);
    if(!id)continue;
    const target=path.join(dir,`${id}.svg`);
    const svg=storyVisualSvg(item);
    if(fs.existsSync(target)&&fs.readFileSync(target,'utf8')===svg)continue;
    fs.writeFileSync(target,svg,'utf8');count++;
  }
  return count;
}
module.exports={storyVisualId,storyVisualUrl,storyVisualSvg,writeStoryVisuals};
