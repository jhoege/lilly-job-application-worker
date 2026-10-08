import crypto from 'node:crypto';
import {serviceDriveToken} from './google-answers.js';
export async function exportResumePacket(job,{getToken=serviceDriveToken,fetcher=fetch}={}){
 const id=String(job.resumeVersion||'').match(/https:\/\/(?:docs\.google\.com\/document\/d|drive\.google\.com\/file\/d)\/([A-Za-z0-9_-]+)/)?.[1];
 if(!id)throw Error('Exact approved resume version has no supported Drive document URL');
 const token=await getToken(),headers={Authorization:'Bearer '+token};
 const meta=await fetcher('https://www.googleapis.com/drive/v3/files/'+id+'?fields=name,mimeType',{headers,signal:AbortSignal.timeout(12000)});
 if(!meta.ok)throw Error('Approved resume read failed HTTP '+meta.status);
 const file=await meta.json();
 const endpoint=file.mimeType==='application/vnd.google-apps.document'?'/export?mimeType=application%2Fpdf':file.mimeType==='application/pdf'?'?alt=media':null;
 if(!endpoint)throw Error('Approved resume must be a Google Doc or PDF');
 const r=await fetcher('https://www.googleapis.com/drive/v3/files/'+id+endpoint,{headers,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Approved resume PDF export failed HTTP '+r.status);
 const buffer=Buffer.from(await r.arrayBuffer());
 if(buffer.length<2000||buffer.subarray(0,5).toString()!=='%PDF-')throw Error('Approved resume export is not a usable PDF');
 // Identify the exact exported PDF in a short name that LinkedIn can display on review.
 const name='Lilly-'+job.id+'-'+crypto.createHash('sha256').update(buffer).digest('hex').slice(0,12)+'.pdf';
 return {name,mimeType:'application/pdf',buffer,sourceId:id};
}
async function resumeChoices(page,selector,name,mark=false){
 return page.locator(selector).evaluate((d,{name,mark})=>{
  const contains=(n)=>{
   for(let a=n.closest('[role=radio]')||n.parentElement;a&&a!==d;a=a.parentElement){
    if(a.querySelectorAll('input[type=radio]').length>1)break;
    if((a.innerText||'').includes(name)){if(mark)a.setAttribute('data-lilly-resume-choice','true');return true;}
   }
   return false;
  };
  for(const old of d.querySelectorAll('[data-lilly-resume-choice]'))old.removeAttribute('data-lilly-resume-choice');
  const inputs=[...d.querySelectorAll('input[type=radio]')];
  const matching=inputs.filter(contains);
  const selected=matching.some(n=>n.closest('[role=radio]')?n.closest('[role=radio]').getAttribute('aria-checked')==='true':n.checked);
  const onReview=[...d.querySelectorAll('button')].some(b=>/^submit application$/i.test((b.innerText||'').trim()));
  const reviewName=(d.innerText||'').includes(name)||[...d.querySelectorAll('[aria-label]')].some(n=>n.getAttribute('aria-label')===('Download '+name));
  return {selected:selected||(onReview&&reviewName),matching:matching.length,onReview};
 },{name,mark});
}
export async function verifyResumeSelection(page,selector,name){
 return resumeChoices(page,selector,name).then(x=>x.selected).catch(()=>false);
}
export async function uploadResumePacket(page,selector,packet){
 try{
  if(await verifyResumeSelection(page,selector,packet.name))return {ok:true};
  let choices=await resumeChoices(page,selector,packet.name,true);
  if(!choices.matching){
   await page.locator(selector+' input[type=file]').first().setInputFiles({name:packet.name,mimeType:packet.mimeType,buffer:packet.buffer},{timeout:10000});
   await page.locator(selector).getByText(packet.name,{exact:false}).first().waitFor({state:'visible',timeout:15000});
   choices=await resumeChoices(page,selector,packet.name,true);
  }
  if(!choices.selected){
   const card=page.locator(selector+' [data-lilly-resume-choice=true]').first();
   if(!await card.count())throw Error('No unique resume choice card found');
   const label=card.locator('label[for]').first();
   const box=await label.boundingBox().catch(()=>null);
   if(await card.getAttribute('role')==='radio')await card.press('Space',{timeout:4000});
   else if(box&&box.width>8&&box.height>8)await label.click({timeout:4000});
   else await card.click({timeout:4000});
  }
  for(let attempt=0;attempt<10;attempt++){
   if(await verifyResumeSelection(page,selector,packet.name)){
    console.log('[resume-selection] '+JSON.stringify({name:packet.name,html:await page.locator(selector).evaluate(d=>[...d.querySelectorAll('input[type=radio]')].map(n=>({checked:n.checked,html:(n.closest('[role=radio]')||n.parentElement?.parentElement)?.outerHTML?.slice(0,2200)})))}));
    await page.waitForTimeout(1000);return {ok:true};
   }
   await page.waitForTimeout(250);
  }
  return {ok:false,reason:'Uploaded exact approved resume but selected attachment could not be verified'};
 }catch(e){return {ok:false,reason:'Approved resume upload failed: '+String(e.message).slice(0,160)};}
}
