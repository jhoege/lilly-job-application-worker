import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {annualSalaryDetails,annualSalaryRange,excludedApplication,excludedEmployer} from '../src/job-policy.js';
import {salaryRequest} from '../src/application-support.js';
import {authoritativeSalary,resolveSalaryBaseline,validateSalaryTarget,desiredSalaryQuestion,salaryAnswerMatches,validateSalaryReview,SALARY_VALIDATION_VERSION} from '../src/salary-validation.js';

test('employer base ranges, fixed salary and published caps retain correct targets',()=>{
 for(const [description,min,max,target] of [
  ['Base salary $190,000–$220,000 plus 50% executive bonus',190000,220000,212500],
  ['Base salary up to $150,000 plus significant equity',150000,150000,150000],
  ['Starting base salary is $260,000 plus bonus and stock options',260000,260000,260000],
  ['Annual salary: $156,700 to $250,700 / year.',156700,250700,227200],
  ['Base salary: $150–200K annually',150000,200000,187500],
  ['Salary\n$155,000 - $170,000 per year',155000,170000,166250]
 ]){
  const baseline=resolveSalaryBaseline({description});
  assert.equal(baseline.min,min,description);assert.equal(baseline.max,max,description);
  assert.equal(validateSalaryTarget(baseline,salaryRequest(baseline).amount),target);
 }
});
test('bonus, equity, revenue, OTE, hourly and conflicting location bands are not base salaries',()=>{
 assert.equal(annualSalaryRange('Salary is competitive; manage a budget of $150,000–$200,000 annually'),null);
 assert.equal(annualSalaryRange('Revenue $150,000–$200,000; accountable for site P&L'),null);
 assert.equal(annualSalaryRange('Annual bonus $150,000–$200,000'),null);
 assert.equal(annualSalaryRange('Total compensation $320,000–$386,000 annually'),null);
 assert.equal(annualSalaryRange('Base salary $190,000–$220,000 plus total compensation $320,000–$386,000 annually').max,220000);
 for(const description of ['Pay $40–$50 per hour','Base salary from $150,000','Base salary $150,000–$200,000 in NY\nBase salary $120,000–$170,000 in WI']){
  assert.equal(annualSalaryDetails(description).status,'unresolved');
  assert.throws(()=>resolveSalaryBaseline({description}),/Salary validation/);
 }
});
test('verified posting takes precedence over old worker ranges and comparable research',()=>{
 const verified={min:150000,max:150000,basis:'posted_range'};
 assert.equal(resolveSalaryBaseline({description:'Base salary up to $150,000',authoritative:verified,recorded:{min:275000,max:300000,basis:'posted_range'}}).max,150000);
 assert.equal(resolveSalaryBaseline({description:'No salary is disclosed.',authoritative:verified}).max,150000);
 assert.equal(resolveSalaryBaseline({description:'No salary is disclosed.',recorded:{min:275000,max:300000,basis:'posted_range'}}),null);
 assert.equal(resolveSalaryBaseline({description:'Base salary $190,000–$220,000',authoritative:{min:320000,max:386000,basis:'researched_comparable_range'}}).max,220000);
 assert.throws(()=>resolveSalaryBaseline({description:'Base salary $275,000–$300,000',authoritative:verified}),/differs/);
 assert.throws(()=>resolveSalaryBaseline({description:'Base salary $150,000',header:'Base salary $275,000–$300,000'}),/disagree/);
});
test('salary target cannot be padded above posting cap or defaulted without evidence',()=>{
 assert.throws(()=>validateSalaryTarget({min:190000,max:220000},369500),/conflicts/);
 assert.throws(()=>validateSalaryTarget({min:90000,max:110000},120000),/below minimum/);
 assert.throws(()=>validateSalaryTarget(null,120000),/reliable/);
 assert.throws(()=>validateSalaryTarget({min:119000,max:120000},120000+1),/conflicts/);
});
test('exact job ID grounding rejects conflicting duplicate search rows',()=>{
 const row=(id,min,max)=>{const r=[];r[11]='https://www.linkedin.com/jobs/view/'+id+'/';r[7]=min;r[8]=max;r[17]='Posted base range';return r;};
 assert.equal(authoritativeSalary([[],row('12345678',190000,220000),row('87654321',320000,386000)],{id:'12345678'}).max,220000);
 assert.throws(()=>authoritativeSalary([[],row('12345678',190000,220000),row('12345678',320000,386000)],{id:'12345678'}),/conflicting/);
});
test('final salary evidence accepts correct values and unambiguous dropdowns, blocks mismatches or missing review',()=>{
 assert.equal(desiredSalaryQuestion('What is your current salary?'),false);
 assert.equal(desiredSalaryQuestion('Desired annual salary'),true);
 assert.equal(salaryAnswerMatches('$212,500',212500),true);
 assert.equal(salaryAnswerMatches('$200,001 - $250,000',212500),true);
 const observed=[{label:'Desired annual salary',value:'212500'}];
 assert.equal(validateSalaryReview('Desired annual salary\n212500',212500,observed).review[0].value,'212500');
 assert.throws(()=>validateSalaryReview('Desired annual salary\n369500',212500,observed),/review salary/);
 assert.throws(()=>validateSalaryReview('Resume\nSubmit application',212500,observed),/not visible/);
 assert.throws(()=>validateSalaryReview('Desired annual salary\n212500',212500,[{value:'369500'}]),/entered salary/);
 assert.equal(validateSalaryReview('Resume\nSubmit application',212500,[]).salaryQuestionPresent,false);
});

for(const mismatch of [false,true])test('worker uses exact posting and '+(mismatch?'blocks wrong final review':'persists salary evidence before submitting'),async()=>{
 const job={id:'4475964073',company:'Movement',url:'https://www.linkedin.com/jobs/view/4475964073/',submitted:false};
 let value='',submitted=0,evidenceWritten=0;
 const application={id:job.id,status:'Queued',salaryRequest:'369500'};
 const search=[];search[7]=190000;search[8]=220000;search[11]=job.url;search[17]='Posted base $190000-$220000';
 const input={fill:async answer=>{value=answer;},evaluate:async()=>value};
 const submit={isVisible:async()=>true,isEnabled:async()=>true,click:async()=>{assert.equal(evidenceWritten,1);submitted++;}};
 const dialog={getByRole:(_role,{name})=>String(name).includes('submit application')?submit:{count:async()=>0},
  locator:()=>({allTextContents:async()=>['Submit application']}),innerText:async()=>`Desired annual salary\n${mismatch?'369500':value}`};
 const page={url:()=>job.url,goto:async()=>{},waitForFunction:async()=>{},waitForTimeout:async()=>{},close:async()=>{},evaluate:async()=>({invalid:0}),
  getByText:()=>({first:()=>({waitFor:async()=>{}})}),
  locator:selector=>({first(){return this;},waitFor:async()=>{},isVisible:async()=>true,
   innerText:async()=>selector==='main'?'Recommended jobs: Base salary $320,000–$386,000':selector.includes('company')?'Movement':'Easy Apply',
   getAttribute:async()=>'',count:async()=>0,click:async()=>{},...selector.includes('data-lilly-field')?input:{},
   ...selector==='[data-lilly-application="true"]'?dialog:{}})};
 const source=fs.readFileSync(new URL('../src/queue-triage.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
 const sandbox={Date,setTimeout,clearTimeout,console,process:{env:{AUTO_SUBMIT_ENABLED:'true',TEST_MODE:'false'}},excludedApplication,excludedEmployer,
  acquireJobClaim:async()=>({claimed:true,beginSubmit:async()=>{},finish:async()=>{}}),
  readApprovedAnswers:async()=>[],readSubmittedJobIds:async()=>new Set(),readApplicationLedger:async()=>[application],readSearchLedger:async()=>[[],search],
  getQueue:()=>[job],archivePosting:async()=>({ok:true}),readPostingSalaryText:async()=>({description:'Base salary $190,000–$220,000 plus bonus',header:''}),
  authoritativeSalary,resolveSalaryBaseline,validateSalaryTarget,desiredSalaryQuestion,salaryAnswerMatches,validateSalaryReview,SALARY_VALIDATION_VERSION,salaryRequest,
  setSalaryBaseline:async(_job,baseline,amount)=>{application.salaryRequest=String(amount);application.salaryBaseline={...baseline,validationVersion:SALARY_VALIDATION_VERSION};},
  recordSalaryAnswerEvidence:async(_job,evidence)=>{assert.equal(evidence.target,212500);evidenceWritten++;},
  logVerifiedLinkedInApplication:async()=>({added:true}),upsertApplicationStatus:async()=>({updated:true})};
 vm.createContext(sandbox);
 vm.runInContext(source+`\nfieldsOnPage=async()=>[{index:0,label:'Desired annual salary',type:'number',tag:'input',required:true,filled:false,name:'salary'}];\nsaveDraftIfSupported=async()=>({saved:false});saveJobForLater=async()=>({saved:false});globalThis.run=triageQueue;`,sandbox);
 const result=await sandbox.run({newPage:async()=>page});
 assert.equal(application.salaryRequest,'212500');
 assert.equal(value,'212500');
 assert.equal(submitted,mismatch?0:1);assert.equal(evidenceWritten,mismatch?0:1);
 assert.equal(result.results[0].status,mismatch?'submission_blocked':'submitted_verified');
});

test('ledger salary writes are atomic and reject changes to validated posting ranges',async()=>{
 const {generateKeyPairSync}=await import('node:crypto');
 const {setSalaryBaseline,recordSalaryAnswerEvidence}=await import('../src/google-answers.js');
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const originalFetch=globalThis.fetch,originalCredential=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
 process.env.GOOGLE_SERVICE_ACCOUNT_JSON=JSON.stringify({type:'service_account',client_email:'test@example.invalid',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
 const row=[];row[0]='4475964073';row[4]='Queued';row[5]='369500';
 const writes=[];
 globalThis.fetch=async(url,options={})=>{
  if(String(url).includes('oauth2.googleapis.com'))return {ok:true,json:async()=>({access_token:'test-only'})};
  if(!options.method)return {ok:true,json:async()=>({values:[[],row]})};
  writes.push({url:String(url),body:JSON.parse(options.body)});
  if(String(url).endsWith('/values:batchUpdate')){
   row[5]=writes.at(-1).body.data[0].values[0][0];
   for(const [i,v] of writes.at(-1).body.data[1].values[0].entries())row[17+i]=v;
  }
  return {ok:true};
 };
 try{
  const baseline={min:190000,max:220000,basis:'posted_range'};
  await setSalaryBaseline({id:row[0],url:'https://www.linkedin.com/jobs/view/'+row[0]},baseline,212500);
  assert.equal(writes.length,1);assert.match(writes[0].url,/\/values:batchUpdate$/);assert.equal(row[5],'212500');assert.equal(row[20],SALARY_VALIDATION_VERSION);
  await assert.rejects(()=>setSalaryBaseline({id:row[0]},{min:320000,max:386000,basis:'posted_range'},369500),/refusing to overwrite/);
  await recordSalaryAnswerEvidence({id:row[0]},validateSalaryReview('Desired salary\n212500',212500,[{value:'212500'}]));
  assert.equal(writes.length,2);
  row[4]='Submitted verified';
  await assert.rejects(()=>setSalaryBaseline({id:row[0]},baseline,212500),/protected/);
  assert.equal(writes.length,2);
 }finally{globalThis.fetch=originalFetch;if(originalCredential===undefined)delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;else process.env.GOOGLE_SERVICE_ACCOUNT_JSON=originalCredential;}
});
