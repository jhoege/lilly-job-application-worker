import fs from 'node:fs';
import crypto from 'node:crypto';
import {readApprovedAnswers,readApplicationLedger,upsertApplicationStatus} from './google-answers.js';
import {discoverSavedLinkedInJobs} from './linkedin-saved.js';
import path from 'node:path';
import {getQueue} from './application-support.js';
import {getTriageStatus,triageQueue} from './queue-triage.js';
const statePath=process.env.TRIAGE_STATE_FILE||'/data/job-triage-state.json';
let busy=false;
const engineVersion='2026-10-08-sms-repair-v8';
import {verifiedSubmission,uncertainSubmission,excludedEmployer} from './job-policy.js';
export async function runAutoTriage(context,{force=false}={}){
  if(busy||getTriageStatus().running)return {started:false,reason:'already_running'};
  if(!context)throw Error('Browser unavailable');
  busy=true;
  const allResults=[];
  try{
   let state={};try{state=JSON.parse(fs.readFileSync(statePath,'utf8'))}catch{}
   const approved=await readApprovedAnswers();
   const fingerprint=crypto.createHash('sha256').update(JSON.stringify(approved.map(x=>[x.question,x.answer]).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');
   const original=getQueue().filter(j=>!j.submitted&&j.status!=='closed_not_accepting_applications');
   let saved={status:'not_checked',jobs:[]};
   try{saved=await discoverSavedLinkedInJobs(context)}
   catch(e){console.error('[saved-jobs] discovery error '+String(e.message).slice(0,100))}
   console.log('[saved-jobs] status='+saved.status+' count='+saved.jobs.length);
   const ledger=await readApplicationLedger();
   const existingIds=new Set(ledger.map(x=>x.id));
   const submittedIds=new Set(ledger.filter(x=>verifiedSubmission(x.status)).map(x=>x.id));
   const jobsById=new Map(original.map(j=>[j.id,j]));
   for(const entry of ledger){
    if(!verifiedSubmission(entry.status)&&!uncertainSubmission(entry.status)&&!/closed/i.test(entry.status)&&entry.url&&/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d{8,12}\/?$/.test(entry.url)&&!jobsById.has(entry.id))jobsById.set(entry.id,{...entry,submitted:false});
   }
   for(const job of saved.jobs){
    if(submittedIds.has(job.id))continue;
    if(!jobsById.has(job.id))jobsById.set(job.id,job);
    if(!existingIds.has(job.id)){
     try{await upsertApplicationStatus(job,'Queued - LinkedIn saved','Discovered in saved jobs; awaiting application attempt',{source:'LinkedIn saved'});existingIds.add(job.id)}
     catch(e){console.error('[saved-jobs] could not queue '+job.id+': '+String(e.message).slice(0,100))}
    }
   }
   const jobs=[...jobsById.values()].filter(j=>!submittedIds.has(j.id)&&!uncertainSubmission(ledger.find(x=>x.id===j.id)?.status)&&!excludedEmployer(j.company)&&!/closed/i.test(ledger.find(x=>x.id===j.id)?.status||''));
   // Revisit blocked jobs as soon as approved answers change; otherwise limit retries.
   const eligible=jobs.filter(j=>{
    const entry=state[j.id];
    if(force||!entry)return true;
    const last=typeof entry==='number'?entry:entry.at;
    const previous=typeof entry==='number'?'':entry.answers;
    const version=typeof entry==='number'?'':entry.engine;
    const retryHours=['technical_failure','job_timeout','login_required'].includes(entry?.status)?1:24;
    return previous!==fingerprint||version!==engineVersion||Date.now()-last>retryHours*60*60*1000;
   });
   if(!eligible.length)return {started:true,results:[],reason:'no_eligible_jobs'};
   // Process the full eligible queue in consecutive batches, not just five per hour.
   // Cap at 25 per cycle to avoid overloading LinkedIn and Google Sheets.
   for(let offset=0;offset<Math.min(eligible.length,25);offset+=5){
    const ids=eligible.slice(offset,offset+5).map(j=>j.id);
    let result;
    try{result=await triageQueue(context,{limit:5,ids,jobsOverride:jobs})}
    catch(e){console.error('[auto-triage] batch failed '+String(e.message).slice(0,120));break}
    allResults.push(...(result.results||[]));
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
    if(offset+5<eligible.length)await new Promise(resolve=>setTimeout(resolve,4000));
   }
   return {started:true,results:allResults};
  }catch(e){console.error('[auto-triage] '+String(e.message).slice(0,150));throw e;}
  finally{busy=false}
}
export function startAutoTriage(getContext){
 if(process.env.AUTO_TRIAGE_ENABLED!=='true'){console.log('[auto-triage] disabled');return;}
 const run=()=>runAutoTriage(getContext()).catch(()=>{});
 setTimeout(()=>{void run()},15000).unref();
 setInterval(()=>{void run()},60*60*1000).unref();
}

