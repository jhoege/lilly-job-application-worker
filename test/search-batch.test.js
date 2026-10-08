import test from 'node:test';
import assert from 'node:assert/strict';
import {processSearchBatch} from '../src/search-batch.js';
function row(company,url,status,packet=''){const r=Array(18).fill('');r[3]=company;r[4]='Director';r[8]=180000;r[11]=url;r[14]=packet;r[16]=status;return r;}
test('additional batch continues after site failure, preserves tailored packet and skips protected jobs',async()=>{
 const rows=[[],row('Submitted','https://jobs.test/applied','Applied'),row('EVO Tech','https://jobs.test/excluded','Ready for Review'),row('First','https://jobs.test/failure','Qualified - Not Prepared'),row('Second','https://jobs.test/packet','Ready for Review','https://docs.google.com/document/d/packet'),row('Third','https://jobs.test/captcha','Ready for Review')];
 const writes=[],visits=[];let current;
 const context={newPage:async()=>({goto:async url=>{current=url;visits.push(url);if(url.endsWith('failure'))throw Error('Navigation timeout')},waitForTimeout:async()=>{},evaluate:async()=>({url:current,title:'Job posting',text:'Current role responsibilities',captcha:current.endsWith('captcha')}),close:async()=>{}})};
 const results=await processSearchBatch(context,[],{readSearchLedger:async()=>rows,readApplicationLedger:async()=>[],recordSearchAttempt:async(...args)=>writes.push(args)});
 assert.equal(visits.length,3);assert.equal(results.length,3);assert.equal(writes.length,3);
 assert.match(results[0].reason,/Navigation timeout/);assert.match(results[1].reason,/No default resume substituted/);assert.match(results[2].reason,/CAPTCHA/);
 assert.ok(results.every(r=>r.status==='Saved - application blocked'));
});
