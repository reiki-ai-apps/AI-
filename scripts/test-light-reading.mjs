import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function homeTeaser(value,limit=92){');
const end=html.indexOf('function updateCard(u){',start);
assert.ok(start>=0&&end>start,'short home teaser exists');
const context=vm.createContext({});
vm.runInContext(html.slice(start,end),context);
assert.equal(context.homeTeaser('最初の一文です。 二文目は詳細で読みます。'),'最初の一文です。');
assert.equal(context.homeTeaser('長い一文です。',4),'長い一文…');
assert.equal(context.homeTeaser(''),'要点を読む');
assert.match(html,/detail-quick-take[\s\S]*まず、ここだけ/,'detail offers a short first layer');
assert.match(html,/\$\{friendlyExplanation\?`<div class="read-block is-easy">/,'full explanation remains available on detail');
console.log('Light reading: short home teasers and a deeper detail page passed.');
