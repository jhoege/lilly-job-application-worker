import fs from 'node:fs';
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
   const jobs=getQueue().filter(j=>!j.submitted&&j.status!=='closed_not_accepting_applications');
   const eligible=jobs.filter(j=>!state[j.id]||Date.now()-state[j.id]>24*60*60*1000);
   if(!eligible.length)return;
   const ids=eligible.slice(0,5).map(j=>j.id);
   const result=await triageQueue(getContext(),{limit:5,ids});
   for(const item of result.results||[]){
    if(item.jobId)state[item.jobId]=Date.now();
   }
   if(result.results?.length){
    fs.mkdirSync(path.dirname(statePath),{recursive:true});
    fs.writeFileSync(statePath,JSON.stringify(state));
    console.log('[auto-triage] processed='+result.results.length+' statuses='+result.results.map(x=>x.status).join(','));
   }
  }catch(e){console.error('[auto-triage] '+String(e.message).slice(0,150))}
  finally{busy=false}
 };
 setTimeout(()=>{void run()},120000).unref();
 setInterval(()=>{void run()},60*60*1000).unref();
}
