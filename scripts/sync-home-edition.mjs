import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {applyHomeEdition}=require('./home-edition.cjs');
const dataFile=new URL('../data.json',import.meta.url);
const editionFile=new URL('../home-edition.json',import.meta.url);
const current=JSON.parse(fs.readFileSync(dataFile,'utf8'));
const edition=JSON.parse(fs.readFileSync(editionFile,'utf8'));
const next=applyHomeEdition(current,edition);
if(JSON.stringify(next)!==JSON.stringify(current)){
  fs.writeFileSync(dataFile,JSON.stringify(next,null,2)+'\n');
  console.log(`Home ranks synchronized to ${(edition.article_ids||[]).length} selected article(s).`);
}else console.log('Home ranks already match the selected edition.');
