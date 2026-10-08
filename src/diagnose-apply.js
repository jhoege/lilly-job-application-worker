import {readApplicationLedger,recordSearchAttempt} from './google-answers.js';
export async function diagnoseApply(context){
 const page=await context.newPage(),failures=[];
 page.on('requestfailed',r=>failures.push({url:r.url().split('?')[0],error:r.failure()?.errorText}));
 try{
  await page.goto('https://www.linkedin.com/jobs/view/4457377785/',{waitUntil:'domcontentloaded',timeout:25000});
  await page.getByRole('button',{name:/^Continue(?: application)?$/i}).first().waitFor({state:'visible',timeout:12000});
  await page.getByRole('button',{name:/^Continue(?: application)?$/i}).first().click();
  await page.waitForTimeout(15000);
  const snapshots=[];
  for(const frame of page.frames()){
   try{snapshots.push({url:frame.url().split('?')[0],dom:await frame.evaluate(()=>{
    const visible=e=>e.getClientRects().length>0;
    const descriptor=e=>({tag:e.tagName,id:e.id,classes:String(e.className).slice(0,100),role:e.getAttribute('role'),testId:e.getAttribute('data-testid')});
    return {headings:[...document.querySelectorAll('h1,h2,h3')].filter(visible).map(e=>e.innerText).slice(0,20),
     buttons:[...document.querySelectorAll('button,[role="button"]')].filter(visible).map(e=>({text:(e.innerText||e.getAttribute('aria-label')||'').slice(0,100),...descriptor(e)})).slice(0,35),
     containers:[...document.querySelectorAll('dialog,[role="dialog"],[aria-modal="true"],form,iframe')].map(e=>({...descriptor(e),visible:visible(e),src:e.getAttribute('src')?.split('?')[0],text:(e.innerText||'').slice(0,350)})).slice(0,15),
     inputs:[...document.querySelectorAll('input,select,textarea')].filter(visible).map(e=>({type:e.type,name:e.name,label:e.labels?.[0]?.innerText||e.getAttribute('aria-label'),ancestors:[e.parentElement,e.parentElement?.parentElement,e.parentElement?.parentElement?.parentElement].filter(Boolean).map(descriptor)})).slice(0,25)};
   })});}catch(e){snapshots.push({url:frame.url().split('?')[0],error:String(e.message).slice(0,120)});}
  }
  let trackerWrite;
  try{
   const job=(await readApplicationLedger()).find(j=>j.id==='4457377785');
   trackerWrite=await recordSearchAttempt(job.url,job.status,'Worker tracker-write verification succeeded. Existing application outcome preserved: '+job.reason);
  }catch(e){trackerWrite={error:String(e.message).slice(0,130)};}
  return {snapshots,trackerWrite,failures:failures.slice(0,20),pages:context.pages().map(p=>p.url().split('?')[0])};
 }finally{await page.close().catch(()=>{});}
}
