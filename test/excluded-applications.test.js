import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {excludedApplication} from '../src/job-policy.js';

test('excluded and closed statuses block retries while ordinary saved drafts remain eligible',()=>{
 for(const status of ['Excluded - specialized experience gap','Excluded','Closed','closed_not_accepting_applications'])assert.equal(excludedApplication(status),true);
 for(const status of ['Saved - answer required','Saved - confirmation required','Needs review','Queued - LinkedIn saved'])assert.equal(excludedApplication(status),false);
});

test('direct triage cannot reopen or overwrite an excluded application in the original queue',async()=>{
 const job={id:'4470079202',company:'Lyra Health',url:'https://www.linkedin.com/jobs/view/4470079202/',submitted:false};
 const source=fs.readFileSync(new URL('../src/queue-triage.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
 let opened=0,written=0;
 const sandbox={Date,setTimeout,clearTimeout,console,process:{env:{}},excludedApplication,
  readApprovedAnswers:async()=>[],readSubmittedJobIds:async()=>new Set(),
  readApplicationLedger:async()=>[{id:job.id,status:'Excluded - specialized experience gap'}],
  getQueue:()=>[job],upsertApplicationStatus:async()=>{written++;}};
 vm.createContext(sandbox);
 vm.runInContext(source+'\nglobalThis.run=triageQueue;',sandbox);
 const result=await sandbox.run({newPage:async()=>{opened++;throw Error('Excluded job was opened');}});
 assert.equal(opened,0);assert.equal(written,0);
 assert.equal(result.results[0].status,'skipped_excluded');
 assert.equal(result.results[0].visited,false);
});
