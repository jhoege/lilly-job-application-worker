import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {acquireJobClaim} from '../src/job-claims.js';
const env={LILLY_JOB_CLAIMS:'supabase',LILLY_SUPABASE_URL:'https://vjmaaljmdeaetrrogzah.supabase.co',LILLY_SUPABASE_SERVICE_KEY:'sb_secret_test'};
test('database errors block acquisition without leaking credentials',async()=>{
 await assert.rejects(acquireJobClaim({id:'4475964073'},{env,fetchImpl:async()=>({ok:false,status:503})}),/database HTTP 503/);
});
test('stale ownership blocks submission and uses secret key only in apikey header',async()=>{
 const calls=[];
 const fetchImpl=async(url,opts)=>{calls.push({url,...opts});return {ok:true,json:async()=>url.endsWith('lilly_job_claim')?{claimed:true}:{ok:false}}};
 const lease=await acquireJobClaim({id:'4475964073'},{env,fetchImpl});
 await assert.rejects(lease.beginSubmit(),/expired or replaced/);
 assert.equal(calls[0].headers.Authorization,undefined);
 assert.equal(JSON.parse(calls[1].body).p_action,'begin_submit');
});
for(const unavailable of [false,true])test('triage never opens or rewrites a job when claim '+(unavailable?'fails':'is denied'),async()=>{
 const source=fs.readFileSync(new URL('../src/queue-triage.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
 let opened=0,written=0;
 const sandbox={Date,setTimeout,clearTimeout,console,process:{env:{}},
  readApprovedAnswers:async()=>[],readSubmittedJobIds:async()=>new Set(),readApplicationLedger:async()=>[],
  excludedApplication:()=>false,getQueue:()=>[{id:'4475964073',url:'https://www.linkedin.com/jobs/view/4475964073/'}],
  acquireJobClaim:async()=>{if(unavailable)throw Error('database unavailable');return {claimed:false}},
  upsertApplicationStatus:async()=>{written++}};
 vm.createContext(sandbox);vm.runInContext(source+'\nglobalThis.run=triageQueue;',sandbox);
 await sandbox.run({newPage:async()=>{opened++;throw Error('must not open')}});
 assert.equal(opened,0);assert.equal(written,0);
});
