import fs from 'node:fs';
import path from 'node:path';

const queuePath=path.resolve('data/candidate-jobs-2026-10-07.json');
export function getQueue(){
 const data=JSON.parse(fs.readFileSync(queuePath,'utf8'));
 return data.jobs.map(j=>({id:String(j.linkedinJobId),url:'https://www.linkedin.com/jobs/view/'+j.linkedinJobId+'/',status:j.status||'needs_verification',submitted:!!j.submitted}));
}
export function salaryRequest({min,max,market}={}){
 const lo=Number(min),hi=Number(max),m=Number(market);
 if(min!==undefined&&max!==undefined&&Number.isFinite(lo)&&Number.isFinite(hi)&&lo>=0&&hi>=lo)
  return {amount:Math.max(120000,Math.round(lo+0.75*(hi-lo))),basis:'advertised_range'};
 if(market!==undefined&&Number.isFinite(m)&&m>0)
  return {amount:Math.max(120000,Math.round(m)),basis:'market_data'};
 return {amount:120000,basis:'no_reliable_data'};
}
export async function inspectForm(context){
 if(!context)throw Error('Browser unavailable');
 const p=context.pages()[0];if(!p)throw Error('No active page');
 return p.evaluate(()=>{
  const dialog=document.querySelector('[role="dialog"]');
  if(!dialog)return {open:false,fields:[],actions:[]};
  const fields=Array.from(dialog.querySelectorAll('input,select,textarea')).slice(0,70).map((el,i)=>{
   const label=el.labels?.[0]?.innerText||el.getAttribute('aria-label')||el.closest('fieldset')?.querySelector('legend')?.innerText||el.getAttribute('placeholder')||'';
   const type=el.type||el.tagName.toLowerCase();
   return {index:i,label:label.trim().slice(0,160),type,required:!!el.required,filled:type==='checkbox'||type==='radio'?!!el.checked:!!el.value};
  });
  const actions=Array.from(dialog.querySelectorAll('button')).map(x=>x.innerText.trim()).filter(Boolean).slice(0,25);
  return {open:true,fields,actions,inspectionOnly:true};
 });
}
export async function batchInspect(context,{limit=5}={}){
 if(!context)throw Error('Browser unavailable');
 const items=getQueue().filter(j=>!j.submitted).slice(0,Math.max(1,Math.min(10,Number(limit)||5)));
 const p=context.pages()[0]||await context.newPage();
 const results=[];
 for(const j of items){
  try{
   await p.goto(j.url,{waitUntil:'domcontentloaded',timeout:25000});
   const details=await p.evaluate(()=>{
    const text=(document.querySelector('main')?.innerText||document.body.innerText||'').replace(/\s+/g,' ').trim();
    const title=document.querySelector('h1')?.innerText||document.title;
    const buttons=Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim());
    return {title:title.slice(0,160),excerpt:text.slice(0,2500),easyApply:buttons.some(b=>/easy apply/i.test(b))};
   });
   results.push({id:j.id,url:p.url(),status:'inspected',...details});
  }catch(e){results.push({id:j.id,status:'technical_failure',reason:'Navigation or page inspection failed'});}
 }
 return {inspectionOnly:true,submitted:0,results};
}
