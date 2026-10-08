import fs from 'node:fs';
import crypto from 'node:crypto';
import {readApprovedAnswers,readApplicationLedger,upsertApplicationStatus} from './google-answers.js';
import {discoverSavedLinkedInJobs} from './linkedin-saved.js';
import path from 'node:path';
import {getQueue} from './application-support.js';
import {triageQueue} from './queue-triage.js';
const statePath=process.env.TRIAGE_STATE_FILE||'/data/job-triage-state.json';
let busy=false;
const engineVersion='2026-10-08-correct-modal-v5';
export function startAutoTriage(getContext){
 if(process.env.AUTO_TRIAGE_ENABLED!=='true'){console.log('[auto-triage] disabled until supervised pilot passes');return}
 const run=async()=>{
  if(busy||!getContext())return;
  busy=true;
  try{
   let state={};try{state=JSON.parse(fs.readFileSync(statePath,'utf8'))}catch{}
   const approved=await readApprovedAnswers();
   const fingerprint=crypto.createHash('sha256').update(JSON.stringify(approved.map(x=>[x.question,x.answer]).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');
   const original=getQueue().filter(j=>!j.submitted&&j.status!=='closed_not_accepting_applications');
   let saved={status:'not_checked',jobs:[]};
   try{saved=await discoverSavedLinkedInJobs(getContext())}
   catch(e){console.error('[saved-jobs] discovery error '+String(e.message).slice(0,100))}
   console.log('[saved-jobs] status='+saved.status+' count='+saved.jobs.length);
   const ledger=await readApplicationLedger();
   const existingIds=new Set(ledger.map(x=>x.id));
   const submittedIds=new Set(ledger.filter(x=>/submitted|applied|hired|interview/i.test(x.status)).map(x=>x.id));
   const jobsById=new Map(original.map(j=>[j.id,j]));
   for(const job of saved.jobs){
    if(submittedIds.has(job.id))continue;
    if(!jobsById.has(job.id))jobsById.set(job.id,job);
    if(!existingIds.has(job.id)){
     try{await upsertApplicationStatus(job,'Queued - LinkedIn saved','Discovered in saved jobs; awaiting application attempt',{source:'LinkedIn saved'});existingIds.add(job.id)}
     catch(e){console.error('[saved-jobs] could not queue '+job.id+': '+String(e.message).slice(0,100))}
    }
   }
   const jobs=[...jobsById.values()].filter(j=>!submittedIds.has(j.id)&&!['Submission unverified - Verify before retry'].includes(ledger.find(x=>x.id===j.id)?.status));
   // Revisit blocked jobs as soon as approved answers change; otherwise limit retries.
   const eligible=jobs.filter(j=>{
    const entry=state[j.id];
    if(!entry)return true;
    const last=typeof entry==='number'?entry:entry.at;
    const previous=typeof entry==='number'?'':entry.answers;
    const version=typeof entry==='number'?'':entry.engine;
    const retryHours=['technical_failure','job_timeout','login_required'].includes(entry?.status)?1:24;
    return previous!==fingerprint||version!==engineVersion||Date.now()-last>retryHours*60*60*1000;
   });
   if(!eligible.length)return;
   const ids=eligible.slice(0,5).map(j=>j.id);
   const result=await triageQueue(getContext(),{limit:5,ids,jobsOverride:jobs});
   for(const item of result.results||[]){
    if(item.jobId)state[item.jobId]={at:Date.now(),answers:fingerprint,status:item.status,engine:engineVersion};
   }
   if(result.results?.length){
    fs.mkdirSync(path.dirname(statePath),{recursive:true});
    fs.writeFileSync(statePath,JSON.stringify(state));
    console.log('[auto-triage] processed='+result.results.length+' statuses='+result.results.map(x=>x.status).join(','));
    for(const item of result.results){
     console.log('[auto-triage] job='+item.jobId+' status='+item.status+' steps='+String(item.stepsCompleted||0)+' fields='+String(item.diagnostic?.visibleFields??'n/a')+' buttons='+JSON.stringify((item.diagnostic?.buttons||[]).slice(0,8))+' logged='+String(item.logged||0));
    }
   }
  }catch(e){console.error('[auto-triage] '+String(e.message).slice(0,150))}
  finally{busy=false}
 };
 setTimeout(()=>{void run()},120000).unref();
 setInterval(()=>{void run()},60*60*1000).unref();
}
