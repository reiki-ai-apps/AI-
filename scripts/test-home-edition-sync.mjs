import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {synchronizeHomeEdition}=require('./home-edition-sync.cjs');

const day='2026-10-26';
const previousDay='2026-10-25';
const at='2026-10-26T01:45:00.000Z';
const stories=[
  {article_id:'article_yesterday',title:'Yesterday story',content_type:'article',home_top_rank:5},
  {article_id:'article_today_a',title:'OpenAI releases a new model',primary_entity:'OpenAI',story_subject:'new model',event_type:'release',content_type:'article'},
  {article_id:'article_today_b',title:'NVIDIA opens a data center in Germany',primary_entity:'NVIDIA',story_subject:'German data center',event_type:'investment',content_type:'article'}
];
const edition={article_ids:['article_today_a','article_today_b'],new_article_ids:['article_today_a','article_today_b'],
  edition_day_jst:day,home_shown_days:{article_yesterday:previousDay,article_today_a:day,article_today_b:day},
  window_start:'2026-10-25T15:00:00.000Z',window_end:at,last_checked_at:at,
  home_content_changed_at:at,update_health:'HEALTHY'};
const selected=synchronizeHomeEdition(stories,edition);
assert.deepEqual(selected.map(item=>item.home_top_rank||0),[0,1,2],
  'today stories get consecutive ranks while yesterday rank is removed');
assert.deepEqual(selected.map(item=>item.title),stories.map(item=>item.title),'article text is untouched');
assert.deepEqual(synchronizeHomeEdition(selected,edition),selected,'repeated synchronization is idempotent');
assert.deepEqual(synchronizeHomeEdition(stories,{...edition,article_ids:[],new_article_ids:[]})
  .map(item=>item.home_top_rank||0),[0,0,0],'empty edition clears stale ranks');
assert.throws(()=>synchronizeHomeEdition(stories,{...edition,article_ids:['article_yesterday','article_today_a']}),
  /previous-day article/,'a previous-day story cannot silently enter the home');
assert.throws(()=>synchronizeHomeEdition(stories.filter(item=>item.article_id!=='article_today_b'),edition),
  /missing/,'an article removed during validation cannot leave a dangling edition entry');
console.log('Home rank sync fixtures passed: populated, previous-day, removed article, empty and idempotent.');
