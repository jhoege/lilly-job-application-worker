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
 const name=('Lilly-'+job.id+'-'+file.name).replace(/[^a-zA-Z0-9 ._-]/g,'').slice(0,155)+'.pdf';
 return {name,mimeType:'application/pdf',buffer,sourceId:id};
}
export async function verifyResumeSelection(page,selector,name){
 return page.locator(selector).evaluate((d,name)=>{
  const selected=[...d.querySelectorAll('input[type=radio]:checked,[role=radio][aria-checked=true],[aria-selected=true]')];
  const onReview=[...d.querySelectorAll('button')].some(b=>/^submit application$/i.test((b.innerText||'').trim()));
  if(onReview&&(d.innerText||'').includes(name))return true;
  return selected.some(n=>[n.labels?.[0],n.parentElement,n.parentElement?.parentElement].filter(Boolean).some(e=>(e.innerText||'').includes(name)));
 },name).catch(()=>false);
}
export async function uploadResumePacket(page,selector,packet){
 const dialog=page.locator(selector),input=dialog.locator('input[type=file]').first();
 try{
  if(!await verifyResumeSelection(page,selector,packet.name)){
   await input.setInputFiles({name:packet.name,mimeType:packet.mimeType,buffer:packet.buffer},{timeout:10000});
   await dialog.getByText(packet.name,{exact:false}).first().waitFor({state:'visible',timeout:15000});
   const choices=dialog.locator('input[type=radio]');
   const index=await choices.evaluateAll((ns,name)=>ns.findIndex(n=>[n.labels?.[0],n.parentElement,n.parentElement?.parentElement].filter(Boolean).some(e=>(e.innerText||'').includes(name))),packet.name);
   if(index>=0)await choices.nth(index).check({timeout:3000});
  }
  return await verifyResumeSelection(page,selector,packet.name)?{ok:true}:{ok:false,reason:'Uploaded approved resume but selected attachment could not be verified'};
 }catch(e){return {ok:false,reason:'Approved resume upload failed: '+String(e.message).slice(0,160)};}
}
