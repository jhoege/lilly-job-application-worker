import {getQueue} from './application-support.js';
import {readApprovedAnswers,appendUnknownQuestions} from './google-answers.js';
let running=false;
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const aliases=new Map([
 ['email address','email'],['mobile phone number','mobile'],['phone number','mobile'],
 ['first name','first name'],['last name','last name'],['current location','current location'],
 ['what is your current location','current location'],
 ['are you legally authorized to work in the united states','authorized to work in us'],
 ['will you now or in the future require sponsorship for employment visa status e g h 1b visa status','require visa sponsorship now or later']
]);
function lookupAnswer(label,approved){
 const n=normalize(label).replace(/ required$/,'');
 const key=aliases.get(n)||n;
 return approved.find(a=>normalize(a.question)===key)?.answer;
}
async function fieldsOnPage(page){
 return page.evaluate(()=>{
  const dialog=document.querySelector('[role="dialog"]');
  if(!dialog)return null;
  const fields=[...dialog.querySelectorAll('input,textarea,select')].filter(el=>el.type!=='hidden'&&el.getClientRects().length);
  return fields.map((el,index)=>{
   const parent=el.closest('fieldset');
   const label=(el.labels?.[0]?.innerText||el.getAttribute('aria-label')||parent?.querySelector('legend')?.innerText||el.getAttribute('placeholder')||'').replace(/\\s+/g,' ').trim();
   const required=el.required||el.getAttribute('aria-required')==='true'||!!el.closest('.fb-dash-form-element')?.querySelector('.fb-dash-form-element__label .visually-hidden');
   const filled=el.type==='checkbox'||el.type==='radio'?el.checked:!!el.value;
   return {index,label:label.slice(0,350),type:el.type||el.tagName.toLowerCase(),required,filled};
  });
 });
}
export async function triageQueue(context,{limit=5,offset=0}={}){
 if(running)throw Error('A triage run is already active');
 if(!context)throw Error('Browser unavailable');
 running=true;
 const results=[];
 try{
  const approved=await readApprovedAnswers();
  const jobs=getQueue().filter(x=>!x.submitted&&x.status!=='closed_not_accepting_applications').slice(Math.max(0,Number(offset)||0),Math.max(0,Number(offset)||0)+Math.max(1,Math.min(10,Number(limit)||5)));
  const page=await context.newPage();
  try{
   for(const job of jobs){
    let stage='navigation';
    try{
     await page.goto(job.url,{waitUntil:'domcontentloaded',timeout:25000});
     if(await page.getByText(/application submitted|already applied/i).count()){
      results.push({jobId:job.id,status:'already_applied'});continue;
     }
     const easy=page.getByRole('button',{name:/^easy apply$/i}).first();
     if(!await easy.isVisible({timeout:3500}).catch(()=>false)){
      results.push({jobId:job.id,status:'no_easy_apply'});continue;
     }
     await easy.click({timeout:8000});
     stage='form';
     let steps=0,unknown=[],status='requires_review';
     for(let step=0;step<6;step++){
      const fields=await fieldsOnPage(page);
      if(!fields){status='form_unavailable';break}
      const missing=[];
      for(const f of fields){
       if(!f.required||f.filled)continue;
       const answer=lookupAnswer(f.label,approved);
       // Only fill clearly labeled text-like fields. No guessed dropdown, radio, checkbox, file or identity answers.
       if(answer!==undefined&&f.label&&['text','email','tel','number','textarea'].includes(f.type)){
        const input=page.locator('[role="dialog"] input:not([type="hidden"]), [role="dialog"] textarea, [role="dialog"] select').filter({visible:true}).nth(f.index);
        try{await input.fill(String(answer),{timeout:2500})}catch{missing.push(f)}
       }else missing.push(f);
      }
      if(missing.length){
       unknown=missing.filter(x=>x.label).map(x=>x.label);
       status='needs_answers';break;
      }
      const dialog=page.locator('[role="dialog"]');
      const review=dialog.getByRole('button',{name:/^review$/i});
      const next=dialog.getByRole('button',{name:/^next$/i});
      if(await review.count()&&await review.first().isEnabled()){
       await review.first().click({timeout:5000});steps++;status='ready_for_review';break;
      }
      if(await next.count()&&await next.first().isEnabled()){
       await next.first().click({timeout:5000});steps++;continue;
      }
      status='ready_for_review';break;
     }
     let added=0;
     if(unknown.length)added=(await appendUnknownQuestions(unknown.map(question=>({jobId:job.id,platform:'LinkedIn',question,url:job.url})))).added;
     results.push({jobId:job.id,status,stepsCompleted:steps,unknownQuestions:unknown.length,logged:added,submitted:false});
     // Closing this isolated page abandons the form without submitting it.
    }catch(e){results.push({jobId:job.id,status:'technical_failure',stage,reason:String(e.message).slice(0,120)})}
   }
  }finally{await page.close().catch(()=>{})}
  return {mode:'safe_multistep_triage',submitted:0,results};
 }finally{running=false}
}
