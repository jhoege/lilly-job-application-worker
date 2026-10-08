import {readApplicationLedger,recordSearchAttempt} from './google-answers.js';
export async function diagnoseApply(context){
 const page=await context.newPage(),failures=[];
 page.on('requestfailed',r=>failures.push({url:r.url().split('?')[0],error:r.failure()?.errorText}));
 try{
  await page.goto('https://www.linkedin.com/jobs/view/4457377785/',{waitUntil:'domcontentloaded',timeout:25000});
  await page.locator('[id^="JobDetails_AboutTheJob_"],.jobs-description__content').first().waitFor({state:'visible',timeout:12000}).catch(()=>{});
  let action,activation;
  const before=new Set(context.pages());
  for(const role of ['button','link']){
   for(const name of [/^Continue(?: application)?$/i,/Easy Apply/i]){
    const candidate=page.getByRole(role,{name}).first();
    if(await candidate.isVisible().catch(()=>false)){action=candidate;break;}
   }
   if(action)break;
  }
  if(action){await action.click();activation='clicked';}else activation='No matching button or link';
  await page.waitForTimeout(15000);
  const snapshots=[];
  const inspectPages=[page,...context.pages().filter(p=>!before.has(p)&&p!==page)];
  for(const frame of inspectPages.flatMap(p=>p.frames())){
   try{snapshots.push({url:frame.url().split('?')[0],dom:await frame.evaluate(()=>{
    const visible=e=>e.getClientRects().length>0;
    const descriptor=e=>({tag:e.tagName,id:e.id,classes:String(e.className).slice(0,100),role:e.getAttribute('role'),testId:e.getAttribute('data-testid')});
    return {headings:[...document.querySelectorAll('h1,h2,h3')].filter(visible).map(e=>e.innerText).slice(0,20),
     links:[...document.querySelectorAll('a')].filter(visible).filter(e=>/apply|continue|resume/i.test(e.innerText||'')).map(e=>({text:e.innerText.slice(0,100),href:e.getAttribute('href')?.split('?')[0]})).slice(0,15),
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
  return {activation,snapshots,trackerWrite,failures:failures.slice(0,20),pages:context.pages().map(p=>p.url().split('?')[0])};
 }finally{await page.close().catch(()=>{});}
}
