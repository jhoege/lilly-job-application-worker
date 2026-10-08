import {getQueue,inspectForm} from './application-support.js';
import {readApprovedAnswers,appendUnknownQuestions} from './google-answers.js';
let running=false;
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export async function triageQueue(context,{limit=5}={}){
 if(running)throw Error('A triage run is already active');
 if(!context)throw Error('Browser unavailable');
 running=true;
 const results=[];
 try{
  const approved=await readApprovedAnswers();
  const known=new Set(approved.map(x=>normalize(x.question)));
  const jobs=getQueue().filter(x=>!x.submitted&&!['closed_not_accepting_applications'].includes(x.status)).slice(0,Math.max(1,Math.min(10,Number(limit)||5)));
  const p=await context.newPage();
  try{
   for(const job of jobs){
    try{
     await p.goto(job.url,{waitUntil:'domcontentloaded',timeout:25000});
     const applied=await p.getByText(/application submitted|already applied/i).count();
     if(applied){results.push({jobId:job.id,status:'already_applied'});continue}
     const easy=p.getByRole('button',{name:/easy apply/i}).first();
     if(!await easy.isVisible({timeout:3000}).catch(()=>false)){results.push({jobId:job.id,status:'no_easy_apply'});continue}
     await easy.click({timeout:8000});
     const form=await inspectForm({pages:()=>[p]});
     if(!form.open){results.push({jobId:job.id,status:'form_unavailable'});continue}
     const unknown=form.fields.filter(f=>f.label&&f.type!=='hidden'&&!known.has(normalize(f.label))&&f.required);
     const logged=await appendUnknownQuestions(unknown.map(f=>({jobId:job.id,platform:'LinkedIn',question:f.label,url:job.url})));
     results.push({jobId:job.id,status:unknown.length?'needs_answers':'requires_form_review',unknownQuestions:unknown.length,logged:logged.added,stepsCompleted:0,submitted:false});
    }catch(e){results.push({jobId:job.id,status:'technical_failure',reason:String(e.message).slice(0,120)})}
   }
  }finally{await p.close().catch(()=>{})}
  return {mode:'safe_triage',submitted:0,results};
 }finally{running=false}
}
