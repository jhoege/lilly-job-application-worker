import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import path from 'node:path';
import {parseCommand,isJobCommand,helpText} from '../sms-gateway/src/commands.js';
import {searchUrls,evaluateSearchCandidate} from '../src/sms-search.js';
import {verifiedSubmission,uncertainSubmission,annualSalaryRange,excludedEmployer} from '../src/job-policy.js';

test('actual user commands route to search instead of tracker or tasks',()=>{
 for(const text of ['JOB SEARCH VP of Operations','JOBS SEARCH VP of Operations','Lilly, JOB SEARCH VP of Operations','Search for VP of operations jobs that match my location and salary criteria on LinkedIn, roles must be close to Madison, WI or be fully remote.']){
  const cmd=parseCommand(text);assert.equal(cmd.kind,'job_search');assert.match(cmd.role,/vp of operations/i);assert.equal(isJobCommand(cmd),true);
 }
 assert.equal(parseCommand('Find Director of Operations jobs overseeing calendar and billing tasks').kind,'job_search');
 assert.equal(parseCommand('JOBS RETRY').kind,'job_retry');
 assert.equal(parseCommand('JOBS DETAILS').kind,'job_details');
 assert.equal(parseCommand('JOBS STATUS').kind,'job_status');
 assert.equal(parseCommand('JOBS SEARCH STATUS').kind,'job_status');
 assert.deepEqual(parseCommand('ANSWER Qabc-1 First line\nSecond line'),{kind:'answer',id:'Qabc-1',answer:'First line\nSecond line'});
 assert.equal(parseCommand('ANSWER Qabc-1').kind,'invalid_answer');
 assert.equal(parseCommand('JOBS nonsense').kind,'unknown');
});
test('remote search applies LinkedIn remote filter; defaults also search Madison',()=>{
 const urls=searchUrls(parseCommand('JOB SEARCH VP of Operations remote'));
 assert.ok(urls.every(q=>new URL(q.url).searchParams.get('f_AL')==='true'));
 assert.equal(urls.length,1);assert.equal(new URL(urls[0].url).searchParams.get('f_WT'),'2');
 const both=searchUrls(parseCommand('JOB SEARCH VP of Operations'));
 assert.equal(both.length,2);assert.equal(new URL(both[0].url).searchParams.get('location'),'Madison, Wisconsin');
});
test('search results enforce role, employer, location and salary; unknown salary stays unknown',()=>{
 const base={title:'VP of Operations',company:'Example',location:'United States (Remote)',remoteSearch:true,salaryText:'$150,000 - $200,000 per year'};
 assert.equal(evaluateSearchCandidate(base,'VP of Operations').eligible,true);
 assert.equal(evaluateSearchCandidate({...base,easyApply:false},'VP of Operations').reason,'easy_apply_required');
 for(const change of [{company:'EVO Tech'},{company:'Lumino'},{location:'Chicago (Hybrid)'},{title:'Director of Operations'},{salaryText:'$80,000–$110,000 per year'}])assert.equal(evaluateSearchCandidate({...base,...change},'VP of Operations').eligible,false);
 const unknown=evaluateSearchCandidate({...base,salaryText:'Competitive pay'},'VP of Operations');assert.equal(unknown.salary,null);assert.equal(unknown.qualification,'salary_not_disclosed');
 assert.equal(evaluateSearchCandidate({...base,location:'Middleton, WI',remoteSearch:false},'VP of Operations').eligible,true);
 assert.equal(annualSalaryRange('$150K–$200K per year').max,200000);
 assert.equal(annualSalaryRange('$40–$50 per hour'),null);
 assert.equal(excludedEmployer('Colorful Concrete Solutions'),true);
});
test('uncertain submission is never labeled verified',()=>{
 assert.equal(verifiedSubmission('Submission unverified - Verify before retry'),false);
 assert.equal(uncertainSubmission('Submission unverified - Verify before retry'),true);
 assert.equal(verifiedSubmission('Submitted verified'),true);
 assert.equal(verifiedSubmission('not applied'),false);
});
test('worker Docker image includes shared runtime parser',()=>{
 const docker=fs.readFileSync('Dockerfile','utf8');
 assert.match(docker,/COPY sms-gateway\/src\/commands\.js \.\/sms-gateway\/src\/commands\.js/);
 assert.ok(fs.existsSync('sms-gateway/src/commands.js'));
});
test('gateway forwards MessageSid, routes natural language before unrelated keywords, and preserves answer text',async()=>{
 const source=fs.readFileSync('sms-gateway/src/server.js','utf8');
 const route=source.slice(source.indexOf('async function routeMessage'),source.indexOf('// Authenticated readiness check'));
 const calls=[];
 const context=vm.createContext({parseCommand,isJobCommand,process:{env:{}},jobsCommand:async(...args)=>{calls.push(args);return 'worker response';},fetchTasks:async()=>{throw Error('must not load tasks');}});
 const fn=vm.runInContext(route+';routeMessage',context);
 assert.equal(await fn('Find VP of Operations jobs with billing tasks','SM12345678'),'worker response');
 assert.deepEqual(calls[0],['Find VP of Operations jobs with billing tasks','SM12345678']);
 assert.equal(await fn('ANSWER Qabc-1 Yes, I can','SM99999999'),'worker response');
 assert.equal(await fn('calendar','SM22222222'),'worker response');
 assert.match(await fn('email','SM22222222'),/not available yet/);
});
test('worker acknowledges real retries, deduplicates inbound requests, persists results and reports delivery failure',async()=>{
 const source=fs.readFileSync('src/sms-operations.js','utf8').replace(/^import .*;\n/gm,'').replace('export async function','async function');
 const memory=new Map(),timers=[];let retries=0,searches=0;
 const fakeFs={readFileSync:p=>{if(!memory.has(p))throw Error('missing');return memory.get(p);},mkdirSync:()=>{},writeFileSync:(p,s)=>memory.set(p,s),renameSync:(a,b)=>memory.set(b,memory.get(a))};
 const context=vm.createContext({fs:fakeFs,path,crypto,parseCommand,process:{env:{JOB_SMS_GATEWAY_URL:'https://gateway.example',JOB_ALERT_SHARED_SECRET:'test'}},console:{error:()=>{},log:()=>{}},URL,AbortSignal,
  setTimeout:fn=>{timers.push(fn);return {unref:()=>{}};},getTriageStatus:()=>({running:false}),smsJobSummary:async s=>'summary '+s,smsRecordAnswer:async(id,a)=>id+': '+a,
  runAutoTriage:async(_c,options)=>{assert.equal(options.force,true);retries++;return {started:true,results:[{jobId:'1234567890',status:'needs_answers'}]};},
  searchJobs:async()=>{searches++;return {reply:'search results',results:[]};},fetch:async()=>({ok:false,status:502})});
 const fn=vm.runInContext(source+';handleSmsCommand',context);
 const ack=await fn('JOBS RETRY','SM12345678',{});assert.match(ack,/retry started/);assert.equal(retries,0);
 assert.match(await fn('JOBS RETRY','SM12345678',{}),/queued/);
 assert.match(await fn('JOB SEARCH VP of Operations','SM88888888',{}),/already processing/);
 await timers.shift()();assert.equal(retries,1);
 const status=await fn('JOBS STATUS','SM99999999',{});assert.match(status,/completed/);assert.match(status,/needs_answers/);assert.match(status,/delivery failed/);
 assert.match(await fn('JOBS RETRY','SM12345678',{}),/completed/);assert.equal(retries,1);
 assert.match(await fn('JOB SEARCH VP of Operations','SM11111111',{}),/search started/);await timers.shift()();assert.equal(searches,1);
 assert.equal(await fn('ANSWER Qabc-1 Yes, I can','SM22222222',{}),'Qabc-1: Yes, I can');
 assert.ok([...memory.values()].some(x=>JSON.parse(x).SM11111111?.status==='completed'));
});


test('/help lists every active route and identifies disconnected capabilities',()=>{
 assert.equal(parseCommand('/help').kind,'help');
 assert.equal(parseCommand('Lilly /help').kind,'help');
 const off=helpText({});assert.match(off,/Email and briefing: not connected/);
 const on=helpText({JOB_WORKER_URL:'https://worker',JOB_ALERT_SHARED_SECRET:'test',LILLY_TASK_SPREADSHEET_ID:'sheet',GOOGLE_SERVICE_ACCOUNT_JSON:'{}',PERSONAL_ASSISTANT_URL:'https://bridge',PERSONAL_ASSISTANT_SECRET:'test'});
 for(const text of ['JOB SEARCH','JOBS APPLY','JOBS STATUS','JOBS DETAILS','JOBS QUESTIONS','ANSWER','TASKS','DUE TODAY','PAST DUE','CALENDAR','EMAIL','BRIEFING','STATUS'])assert.ok(on.includes(text));
 assert.ok(on.length<1500);
});
