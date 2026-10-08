const SAVED_URLS=[
 'https://www.linkedin.com/my-items/saved-jobs/',
 'https://www.linkedin.com/jobs/my-jobs/?cardType=SAVED'
];
export async function discoverSavedLinkedInJobs(context){
 if(!context)throw Error('LinkedIn browser is not ready');
 const page=await context.newPage();
 try{
  for(const url of SAVED_URLS){
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
   await page.waitForTimeout(1600);
   if(await page.locator('input[name="session_key"],input#username').count())
    return {status:'login_required',jobs:[]};
   const saved=await page.evaluate(()=>{
    const links=[...document.querySelectorAll('a[href*="/jobs/view/"],a[href*="currentJobId="]')];
    const jobs=new Map();
    for(const a of links){
     const href=a.getAttribute('href')||'';
     const id=href.match(/\/jobs\/view\/(\d{8,12})/)?.[1]||href.match(/[?&]currentJobId=(\d{8,12})/)?.[1];
     if(!id)continue;
     const card=a.closest('li,.job-card-container,.reusable-search__result-container,.entity-result')||a.parentElement;
     const text=(card?.innerText||a.innerText||'').replace(/\s+/g,' ').trim();
     const title=(a.innerText||a.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim().slice(0,140);
     if(!jobs.has(id))jobs.set(id,{id,title,excerpt:text.slice(0,220)});
    }
    return [...jobs.values()].slice(0,100);
   });
   if(saved.length){
    return {status:'ok',jobs:saved.map(j=>({
     id:j.id,url:'https://www.linkedin.com/jobs/view/'+j.id+'/',
     title:j.title||'',company:'',source:'LinkedIn saved',
     submitted:false,status:'saved_on_linkedin',salaryRequest:null
    }))};
   }
  }
  return {status:'no_saved_jobs_detected',jobs:[]};
 }finally{await page.close().catch(()=>{})}
}
