import {annualSalaryRange,excludedEmployer,QUALIFICATION_TARGET} from './job-policy.js';
export function searchUrls(command){
 const queries=command.mode==='remote'?[{location:'United States',remote:true}]:[{location:'Madison, Wisconsin',remote:false},{location:'United States',remote:true}];
 return queries.map(q=>{const u=new URL('https://www.linkedin.com/jobs/search/');u.searchParams.set('keywords',command.role);u.searchParams.set('location',q.location);u.searchParams.set('f_TPR','r604800');if(q.remote)u.searchParams.set('f_WT','2');else u.searchParams.set('distance','25');return {url:u.href,...q};});
}
export function evaluateSearchCandidate(job,role){
 if(excludedEmployer(job.company))return {eligible:false,reason:'excluded_employer'};
 const title=String(job.title||'');
 if(!/\b(?:vp|vice president|director|head)\b/i.test(title))return {eligible:false,reason:'seniority'};
 if(/\b(?:vp|vice president)\b/i.test(role)&&!/\b(?:vp|vice president)\b/i.test(title))return {eligible:false,reason:'role'};
 if(/\bhead\b/i.test(role)&&!/\bhead\b/i.test(title))return {eligible:false,reason:'role'};
 if(/operations/i.test(role)&&!/operations|operational/i.test(title))return {eligible:false,reason:'role'};
 const location=String(job.location||'');
 const remote=/\bremote\b/i.test(location)&&!/(hybrid|partially remote)/i.test(location);
 const local=/madison|middleton|verona|fitchburg|sun prairie|monona|waunakee|deforest|stoughton|oregon,?\s*(?:wi|wisconsin)|dane county/i.test(location);
 if(!(job.remoteSearch?remote:local))return {eligible:false,reason:'location_unverified'};
 const salary=annualSalaryRange(job.salaryText||'');
 if(salary&&salary.max<QUALIFICATION_TARGET)return {eligible:false,reason:'salary_below_target'};
 return {eligible:true,salary,qualification:salary?'salary_range_matches':'salary_not_disclosed'};
}
export async function searchJobs(context,command){
 if(!context)throw Error('LinkedIn browser is not ready');
 const results=[],seen=new Set(),issues=[];
 for(const query of searchUrls(command)){
  const page=await context.newPage();
  try{
   await page.goto(query.url,{waitUntil:'domcontentloaded',timeout:20000});
   await page.locator('a[href*="/jobs/view/"],a[href*="currentJobId="]').first().waitFor({timeout:8000}).catch(()=>{});
   if(/\/login|\/checkpoint|\/authwall/.test(page.url())||await page.locator('input#username,input[name="session_key"]').count()) {issues.push('LinkedIn sign-in or verification required');continue;}
   const cards=await page.evaluate(()=>{
    const jobs=new Map();
    for(const a of document.querySelectorAll('a[href*="/jobs/view/"],a[href*="currentJobId="]')){
     const href=a.getAttribute('href')||'',id=href.match(/\/jobs\/view\/(\d{8,12})/)?.[1]||href.match(/[?&]currentJobId=(\d{8,12})/)?.[1];
     if(!id)continue;
     const card=a.closest('li,.job-card-container,.base-card')||a.parentElement;
     const title=(a.innerText||a.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
     if(!title)continue;
     const company=(card?.querySelector('.artdeco-entity-lockup__subtitle,.job-card-container__primary-description,.base-search-card__subtitle')?.textContent||'').trim();
     const location=(card?.querySelector('.artdeco-entity-lockup__caption,.job-card-container__metadata-wrapper,.job-search-card__location')?.textContent||'').trim();
     if(!jobs.has(id))jobs.set(id,{id,title,company,location,salaryText:card?.innerText||''});
    }
    return [...jobs.values()].slice(0,10);
   });
   for(const job of cards){
    if(seen.has(job.id))continue;seen.add(job.id);
    job.remoteSearch=query.remote;job.url='https://www.linkedin.com/jobs/view/'+job.id+'/';
    let check=evaluateSearchCandidate(job,command.role);
    if(!check.eligible)continue;
    // Read the actual posting so salary excerpts aren't mistaken for confirmed ranges.
    const details=await context.newPage();
    try{
     await details.goto(job.url,{waitUntil:'domcontentloaded',timeout:12000});
     const text=await details.locator('main').innerText({timeout:4000}).catch(()=>'');
     if(/no longer accepting applications/i.test(text))continue;
     if(/\/login|\/checkpoint|\/authwall/.test(details.url())){issues.push('Posting details require sign-in');continue;}
     job.salaryText=text||job.salaryText;
     check=evaluateSearchCandidate(job,command.role);
     if(check.eligible)results.push({...job,...check});
    }catch{issues.push('Some posting details could not be verified');}
    finally{await details.close().catch(()=>{});}
    if(results.length>=6)break;
   }
   if(!cards.length)issues.push('LinkedIn returned no readable job cards');
  }catch{issues.push('LinkedIn search timed out or was unavailable');}
  finally{await page.close().catch(()=>{});}
 }
 results.sort((a,b)=>Number(!!b.salary)-Number(!!a.salary)||Number(a.remoteSearch)-Number(b.remoteSearch));
 const lines=results.slice(0,4).map((j,i)=>`${i+1}) ${j.title.slice(0,85)} | ${j.company.slice(0,45)} | ${j.location.slice(0,60)} | ${j.salary?'$'+j.salary.min.toLocaleString('en-US')+'–$'+j.salary.max.toLocaleString('en-US'):'salary undisclosed'} ${j.url}`);
 const reply=lines.length?`Lilly search: ${command.role}. Madison area / fully remote; $130K qualification target.\n${lines.join('\n')}\nUndisclosed salaries need review. No applications submitted.`:`Lilly search: No verified matches for ${command.role} were returned. ${[...new Set(issues)].join('; ')||'No postings met role, location and disclosed salary criteria'}. No applications submitted.`;
 return {reply:reply.slice(0,1500),results,issues:[...new Set(issues)]};
}
