import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseCommand} from '../sms-gateway/src/commands.js';
import {smsJobSummary,smsRecordAnswer} from './google-answers.js';
import {runAutoTriage} from './auto-triage.js';
import {getTriageStatus} from './queue-triage.js';
import {searchJobs} from './sms-search.js';
const file=process.env.SMS_OPERATION_STATE_FILE||'/data/sms-operations.json';
let state={};
try{state=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
let active=null;
for(const op of Object.values(state))if(['queued','running'].includes(op.status)){op.status='interrupted';op.reply='Worker restarted during request. Text JOBS RETRY or repeat the search. Unverified submissions will not be retried.';}
function save(){fs.mkdirSync(path.dirname(file),{recursive:true});const entries=Object.entries(state).slice(-100);state=Object.fromEntries(entries);fs.writeFileSync(file+'.tmp',JSON.stringify(state),{mode:0o600});fs.renameSync(file+'.tmp',file);}
async function notify(op){
 const base=process.env.JOB_SMS_GATEWAY_URL,secret=process.env.JOB_ALERT_SHARED_SECRET;
 if(!base||!secret){op.notification='not_configured';return;}
 const url=new URL('/internal/job-result',base);
 if(url.protocol!=='https:')throw Error('SMS gateway requires HTTPS');
 const res=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({requestId:op.id,message:op.reply}),signal:AbortSignal.timeout(15000)});
 op.notification=res.ok?'accepted':'failed';
 if(!res.ok)throw Error('SMS result delivery failed HTTP '+res.status);
}
export async function handleSmsCommand(message,requestId,context){
 const cmd=parseCommand(message);
 if(cmd.kind==='invalid_answer')return 'Use ANSWER <question ID> <your answer>. Text JOBS QUESTIONS for IDs.';
 if(cmd.kind==='invalid_search')return 'Specify a role, for example JOB SEARCH VP of Operations.';
 if(cmd.kind==='answer')return smsRecordAnswer(cmd.id,cmd.answer);
 if(cmd.kind==='job_status'){
  const op=active||Object.values(state).at(-1),triage=getTriageStatus();
  if(!op)return triage.running?`Lilly processing: ${triage.processed}/${triage.total}; stage ${triage.stage}.`:'Lilly: No SMS search or retry has been requested yet.';
  return `Lilly request ${op.id}: ${op.status}. ${triage.running?'Applications: '+triage.processed+'/'+triage.total+'; '+triage.stage+'. ':''}${op.status==='completed'||op.status==='failed'||op.status==='interrupted'?op.reply:''}${op.notification==='failed'?' SMS result delivery failed; this status contains the result.':''}`.slice(0,1500);
 }
 if(['job_search','job_retry'].includes(cmd.kind)){
  const id=/^[A-Za-z0-9_-]{8,80}$/.test(String(requestId||''))?String(requestId):crypto.randomUUID();
  if(state[id])return `Lilly request ${id} is ${state[id].status}. Text JOBS STATUS for results.`;
  if(active||getTriageStatus().running)return 'Lilly is already processing a request. Text JOBS STATUS for progress, then retry when finished.';
  if(!context)return 'LinkedIn browser is not ready. Try again shortly.';
  const op={id,kind:cmd.kind,status:'queued',createdAt:new Date().toISOString(),reply:''};state[id]=op;active=op;save();
  setTimeout(async()=>{
   try{
    op.status='running';save();
    if(cmd.kind==='job_search'){const result=await searchJobs(context,cmd);op.reply=result.reply;op.resultCount=result.results.length;}
    else{
     const result=await runAutoTriage(context,{force:true});
     if(result.started===false)throw Error('An application run is already active; retry after it finishes');
     const outcomes=result.results||[];
     op.reply=`Lilly retry completed: ${outcomes.length} checked; ${outcomes.filter(x=>x.status==='submitted_verified').length} new verified submissions. `+outcomes.slice(0,5).map(x=>`${x.jobId}: ${x.status}`).join(' | ')+(outcomes.length?'':'No eligible pending jobs; submitted, closed and uncertain submissions are excluded.')+' Text JOBS DETAILS for blockers; JOBS QUESTIONS for unanswered questions.';
    }
    op.status='completed';
   }catch(e){op.status='failed';op.reply='Lilly request failed: '+String(e.message).slice(0,150)+'. Text JOBS STATUS for details.';console.error('[sms-operation] '+op.kind+' failed');}
   finally{
    op.finishedAt=new Date().toISOString();save();
    console.log('[sms-operation] kind='+op.kind+' status='+op.status+' results='+String(op.resultCount??'n/a'));
    try{await notify(op);}catch{op.notification='failed';console.error('[sms-operation] result delivery failed; available via JOBS STATUS');}
    save();active=null;
   }
  },100).unref();
  return cmd.kind==='job_search'?`Lilly search started (${id}): ${cmd.role}; ${cmd.mode==='remote'?'fully remote':'Madison area and fully remote'}. Results will arrive by text. JOBS STATUS checks progress.`:`Lilly retry started (${id}). Pending and saved jobs will be checked; closed, submitted and uncertain submissions are excluded. JOBS STATUS checks progress.`;
 }
 if(['job_summary','job_details','job_questions'].includes(cmd.kind))return smsJobSummary(cmd.kind==='job_details'?'jobs details':cmd.kind==='job_questions'?'jobs questions':'jobs');
 return 'Unsupported jobs command. Use JOB SEARCH <role>, JOBS RETRY, JOBS STATUS, JOBS DETAILS, JOBS QUESTIONS, or ANSWER <ID> <answer>.';
}
