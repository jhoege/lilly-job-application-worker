import {readSearchLedger,recordSearchAttempt,readApplicationLedger} from './google-answers.js';
import {excludedEmployer} from './job-policy.js';
export async function processSearchBatch(context,primaryResults=[],dependencies={readSearchLedger,recordSearchAttempt,readApplicationLedger}){
 const rows=await dependencies.readSearchLedger(),ledger=await dependencies.readApplicationLedger(),results=[];
 for(const row of rows.slice(1)){
  const url=row[11],oldStatus=row[16]||'';
  if(!url||/applied|submitted|interview|excluded|closed|reject/i.test(oldStatus)||excludedEmployer(row[3]))continue;
  const id=url.match(/linkedin\.com\/jobs\/view\/(\d+)/)?.[1];
  const primary=primaryResults.find(x=>x.jobId===id);
  if(primary){
   const current=ledger.find(x=>x.id===id);
   const reason=current?.reason||primary.reason||primary.status;
   const status=primary.status==='submitted_verified'?'Applied':current?.status||'Saved - application blocked';
   try{await dependencies.recordSearchAttempt(url,status,reason);}
   catch(e){console.log('[search-batch-sync] '+JSON.stringify({url,status,reason,ledgerError:String(e.message).slice(0,140)}));}
   continue;
  }
  let page,result={company:row[3],title:row[4],url,status:'Saved - application blocked',reason:''};
  try{
   page=await context.newPage();
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
   await page.waitForTimeout(1800);
   const observed=await page.evaluate(()=>({url:location.href,title:document.title,text:(document.querySelector('main')?.innerText||document.body.innerText||'').slice(0,30000),captcha:!!document.querySelector('iframe[src*="hcaptcha"],iframe[src*="recaptcha"]')}));
   result.finalUrl=observed.url;
   if(/no longer accepting applications|position (?:has been )?filled|job (?:is )?no longer available|job not found|position no longer available/i.test(observed.text)){
    result.status='Closed';result.reason='Current posting reports closed or unavailable.';
   }else if(observed.captcha||/verify you are human|checking your browser|access denied|security verification/i.test(observed.text))result.reason='Site security/CAPTCHA blocks access; no bypass or application submission attempted.';
   else if(/authwall|\/login|\/signin|\/sign-in/i.test(observed.url))result.reason='Application source requires an authenticated session unavailable to the worker.';
   else if((Number(row[8])||0)<120000)result.reason='Authoritative qualifying compensation is not established; application blocked by search rules.';
   else if(row[14])result.reason='Role-specific resume packet is prepared, but the worker cannot yet select/upload that exact packet for this application. No default resume substituted.';
   else result.reason='Current source was opened, but its external application adapter is not implemented in the worker. No submission attempted.';
   result.reason+=' Observed page: '+observed.title.slice(0,120)+'; destination: '+observed.url.slice(0,300);
  }catch(e){result.reason='Posting/application access failed: '+String(e.message).slice(0,180);}
  finally{if(page)await page.close().catch(()=>{});}
  try{await dependencies.recordSearchAttempt(url,result.status,result.reason);}catch(e){result.ledgerError=String(e.message).slice(0,140);}
  results.push(result);console.log('[search-batch-job] '+JSON.stringify(result));
 }
 return results;
}
