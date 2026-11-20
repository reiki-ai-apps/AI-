import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {mergePublicArchive}=require("./public-archive.cjs");
const entry=(id,source_url,published="2026-11-01T00:00:00.000Z")=>({id,source_url,published,categories:["AIツール・モデル"]});
const old=entry("article_old","https://example.com/old");
const revised=entry("article_revised_rev_new","https://example.com/revised","2026-11-02T00:00:00.000Z");
const result=mergePublicArchive([revised],[old,entry("article_revised","https://example.com/revised"),entry("article_missing","https://example.com/missing")],id=>id!=="article_missing");
assert.deepEqual(result.map(item=>item.id),["article_revised_rev_new","article_old"],"古い公開記事は残し、同じ情報元の旧版と消えたページはサイトマップから除く");
const next=mergePublicArchive([entry("article_fresh","https://example.com/fresh","2026-11-03T00:00:00.000Z")],result,()=>true);
assert.deepEqual(next.map(item=>item.id),["article_fresh","article_revised_rev_new","article_old"],"表示枠を外れた記事も次回以降のアーカイブで保持する");
console.log("Public article archive retention and revision tests passed.");
