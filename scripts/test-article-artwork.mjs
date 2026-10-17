import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('const ART_VARIANTS='),html.indexOf('function updateCard(u)'));
assert.ok(source.startsWith('const ART_VARIANTS=')&&source.includes('function articleArtClass(u)'),
  'artwork selector is shared by the headline and article cards');
const select=Function('toolById',`${source};return articleArtClass;`)(()=>({name:'AI news'}));
assert.match(select({title:'AIセキュリティの攻撃を防ぐ',id:'security-1'}),/^art-(cyber|legal|quantum|cloud)$/);
assert.match(select({title:'AI動画生成の新機能',id:'video-1'}),/^art-(creative|city|quantum)$/);
const stable={title:'AI動画生成の新機能',id:'stable-1',published_at:'2026-10-17T00:00:00Z'};
assert.equal(select(stable),select(stable),'the same article keeps the same image');
assert.doesNotMatch(source,/dailySalt|new Date\(\)/,'artwork does not rotate by date');
for(const name of [...source.matchAll(/'art-([a-z]+)'/g)].map(match=>match[1])){
  assert.ok(fs.existsSync(new URL(`../assets/ai-card-${name}.webp`,import.meta.url)),`missing artwork: ${name}`);
}
assert.match(html,/class="daily-cover-image"><img src="\$\{coverArtSrc\}"/,'lead story has a visible image');
assert.match(html,/class="ucard-image"><img src="\$\{artSrc\}"[^>]+loading="lazy"/,'article cards have lazy-loaded images');
assert.match(html,/話題のイメージ画像/,'illustrations are clearly labelled, not presented as source photos');
console.log('Article artwork passed: relevant local images, stable mapping, labelled hero and cards.');
