import assert from 'node:assert/strict';
import {classifyUpdateFailure,makeUpdateHealth} from './update-health.mjs';
import {runScheduledUpdate} from './run-scheduled-update.mjs';
assert.equal(classifyUpdateFailure('Anthropic HTTP 400 Your credit balance is too low'),'credit_required');
assert.equal(classifyUpdateFailure('Anthropic HTTP 401'),'credentials_required');
const now=Date.parse('2026-09-30T07:00:00Z');
assert.equal(makeUpdateHealth({code:0,now,edition:{last_checked_at:'2026-09-28T01:00:00Z'}}).status,'delayed');
assert.equal(makeUpdateHealth({code:0,now,edition:{last_checked_at:new Date(now).toISOString()}}).status,'current');
const failed=makeUpdateHealth({code:1,failure:'credit_required',now});
assert.equal(failed.status,'action_required');
assert.equal(JSON.stringify(failed).includes('Anthropic'),false);
let attempts=0;
await runScheduledUpdate({run:async()=>{attempts++;return 1;},shouldRetry:()=>false,
 readState:()=>({}),readItems:()=>[],now:()=>Date.parse('2026-09-30T06:00:00+09:00'),sleep:async()=>assert.fail('must not retry'),log:()=>{}});
assert.equal(attempts,1);
console.log('Update health: stale data, credit errors, redaction and bounded retry passed.');
