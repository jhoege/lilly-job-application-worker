import fs from 'node:fs';
import crypto from 'node:crypto';
import {readApprovedAnswers} from './google-answers.js';
import path from 'node:path';
import {getQueue} from './application-support.js';
import {triageQueue} from './queue-triage.js';
const statePath=process.env.TRIAGE_STATE_FILE||'/data/job-triage-state.json';
let busy=false;
export function startAutoTriage(getContext){
 if(process.env.AUTO_TRIAGE_ENABLED!=='true'){console.log('[auto-triage] disabled until supervised pilot passes');return}
 const run=async()=>{
  if(busy||!getContext())return;
  busy=true;
  try{
   let state={};try{state=JSON.parse(fs.readFileSync(statePath,'utf8'))}catch{}
   const approved=await readApprovedAnswers();
   const fingerprint=crypto.createHash('sha256').update(JSON.stringify(approved.map(x=>[x.question,x.answer]).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');
   const jobs=getQueue().filter(j=>!j.submitted&&j.status!=='closed_not_accepting_applications');
   // Revisit blocked jobs as soon as approved answers change; otherwise limit retries.
   const eligible=jobs.filter(j=>{
    const entry=state[j.id];
    if(!entry)return true;
    const last=typeof entry==='number'?entry:entry.at;
    const previous=typeof entry==='number'?'':entry.answers;
    return previous!==fingerprint||Date.now()-last>24*60*60*1000;
   });
   if(!eligible.length)return;
   const ids=eligible.slice(0,5).map(j=>j.id);
   const result=await triageQueue(getContext(),{limit:5,ids});
   for(const item of result.results||[]){
    if(item.jobId)state[item.jobId]={at:Date.now(),answers:fingerprint,status:item.status};
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
