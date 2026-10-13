import fs from 'node:fs';
import path from 'node:path';
import {searchJobs} from './sms-search.js';
import {readApplicationLedger,upsertApplicationStatus} from './google-answers.js';
import {salaryRequest} from './application-support.js';
import {verifiedSubmission,excludedApplication,uncertainSubmission} from './job-policy.js';

const file=process.env.DAILY_JOB_DISCOVERY_STATE_FILE||'/data/daily-job-discovery.json';
const roles=['Director of Operations','Vice President of Operations','Director of Continuous Improvement'];
function localDay(){
 return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
export async function discoverDailyJobs(context){
 if(!context)return {status:'browser_not_ready',newJobs:0};
 const today=localDay();
 let state={};
 try{state=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}
 if(state.date===today&&state.completed){console.log('[daily-discovery] cached '+JSON.stringify((state.results||[]).map(r=>({role:r.role,found:r.found,queued:r.queued,issues:r.issues}))).slice(0,900));return {status:'already_checked_today',newJobs:0,lastRun:state.finishedAt};}
 const ledger=await readApplicationLedger();
 const known=new Set(ledger.map(j=>j.id));
 const results=[],issues=[];
 let found=0;
 console.log('[daily-discovery] start date='+today);
 for(const role of roles){
  try{
   const search=await searchJobs(context,{role,mode:'local_and_remote'});
   let queued=0;
   for(const candidate of search.results||[]){
    const id=String(candidate.id||'');
    if(!/^\d{8,12}$/.test(id)||known.has(id))continue;
    const annual=candidate.salary;
    const target=annual?salaryRequest({min:annual.min,max:annual.max}).amount:
     candidate.salaryResearch?salaryRequest({market:candidate.salaryResearch.median||((candidate.salaryResearch.min+candidate.salaryResearch.max)/2)}).amount:null;
    if(target==null){issues.push('No salary basis for '+id);continue}
    const job={id,url:'https://www.linkedin.com/jobs/view/'+id+'/',company:candidate.company||'',title:candidate.title||'',salaryRequest:target,source:'Daily LinkedIn search'};
    const write=await upsertApplicationStatus(job,'Queued - daily discovery','Eligible Easy Apply result found by scheduled search',{source:'Daily LinkedIn search'});
    if(write.updated){known.add(id);queued++;found++;}
   }
   results.push({role,found:(search.results||[]).length,queued,issues:search.issues||[]});
   console.log('[daily-discovery] role='+role+' found='+(search.results||[]).length+' queued='+queued+' issues='+JSON.stringify((search.issues||[]).slice(0,4)));
  }catch(e){
   const message=String(e.message||e).slice(0,130);
   issues.push(role+': '+message);
   console.error('[daily-discovery] role='+role+' error='+message);
  }
 }
 const finishedAt=new Date().toISOString();
 const completed=results.length===roles.length;
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,JSON.stringify({date:today,completed,finishedAt,found,results,issues}),{mode:0o600});
 console.log('[daily-discovery] finished newJobs='+found+' completed='+completed);
 return {status:completed?'completed':'partial',newJobs:found,results,issues};
}
