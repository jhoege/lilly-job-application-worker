import {readPostingSalaryText} from './posting-salary.js';
import {resolveSalaryBaseline} from './salary-validation.js';
import {researchComparableSalary} from './salary-research.js';
import {annualSalaryRange,excludedEmployer,QUALIFICATION_TARGET} from './job-policy.js';
export function searchUrls(command){
 const queries=command.mode==='remote'?[{location:'United States',remote:true}]:[{location:'Madison, Wisconsin',remote:false},{location:'United States',remote:true}];
 return queries.map(q=>{const u=new URL('https://www.linkedin.com/jobs/search/');u.searchParams.set('keywords',command.role);u.searchParams.set('location',q.location);u.searchParams.set('f_TPR','r604800');u.searchParams.set('f_AL','true');if(q.remote)u.searchParams.set('f_WT','2');else u.searchParams.set('distance','25');return {url:u.href,...q};});
}
export function evaluateSearchCandidate(job,role){
 if(job.easyApply===false)return {eligible:false,reason:'easy_apply_required'};
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
export async function searchJobs(context,command,{maxCards=10,maxResults=6}={}){
 if(!context)throw Error('LinkedIn browser is not ready');
 const results=[],seen=new Set(),issues=[];
 for(const query of searchUrls(command)){
  const page=await context.newPage();
  try{
   await page.goto(query.url,{waitUntil:'domcontentloaded',timeout:20000});
   await page.locator('a[href*="/jobs/view/"],a[href*="currentJobId="],li[data-occludable-job-id],[data-job-id],[data-entity-urn*="jobPosting"]').first().waitFor({timeout:10000}).catch(()=>{});
   for(let scroll=0;scroll<3;scroll++){
    await page.evaluate(()=>{const list=document.querySelector('.jobs-search-results-list,.scaffold-layout__list,.jobs-search-results__list');if(list)list.scrollTop=list.scrollHeight;else window.scrollTo(0,document.body.scrollHeight)}).catch(()=>{});
    await page.waitForTimeout(700);
   }
   if(/\/login|\/checkpoint|\/authwall/.test(page.url())||await page.locator('input#username,input[name="session_key"]').count()) {issues.push('LinkedIn sign-in or verification required');continue;}
   const cards=await page.evaluate(()=>{
    const jobs=new Map();
    const nodes=[...document.querySelectorAll(
     'li[data-occludable-job-id],[data-job-id],[data-entity-urn*="jobPosting"],.job-card-container,.jobs-search-results__list-item,a[href*="/jobs/view/"],a[href*="currentJobId="]'
    )];
    for(const node of nodes){
     const card=node.closest('li,.job-card-container,.base-card,.jobs-search-results__list-item')||node;
     const anchor=card.querySelector('a[href*="/jobs/view/"],a[href*="currentJobId="]')||
      (node.matches('a')?node:null);
     const href=anchor?.getAttribute('href')||'';
     const urn=card.getAttribute('data-entity-urn')||node.getAttribute('data-entity-urn')||'';
     const id=href.match(/\/jobs\/view\/(\d{8,12})/)?.[1]||
      href.match(/[?&]currentJobId=(\d{8,12})/)?.[1]||
      String(card.getAttribute('data-occludable-job-id')||card.getAttribute('data-job-id')||node.getAttribute('data-job-id')||'').match(/\d{8,12}/)?.[0]||
      urn.match(/jobPosting:(\d{8,12})/)?.[1];
     if(!id)continue;
     const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
     const title=clean(card.querySelector('.job-card-list__title,.job-card-container__link,.artdeco-entity-lockup__title,.base-search-card__title')?.textContent||
      anchor?.innerText||anchor?.getAttribute('aria-label')||'');
     if(!title)continue;
     const company=clean(card.querySelector('.artdeco-entity-lockup__subtitle,.job-card-container__primary-description,.base-search-card__subtitle')?.textContent||'');
     const location=clean(card.querySelector('.artdeco-entity-lockup__caption,.job-card-container__metadata-wrapper,.job-search-card__location,.job-card-container__metadata-item')?.textContent||'');
     if(!jobs.has(id))jobs.set(id,{id,title:title.slice(0,160),company:company.slice(0,100),location:location.slice(0,150),salaryText:clean(card.innerText).slice(0,1500)});
    }
    return [...jobs.values()].slice(0,12);
   });
   if(!cards.length){
    const diagnostic=await page.evaluate(()=>({
     url:location.href.slice(0,150),title:document.title.slice(0,110),
     links:document.querySelectorAll('a[href*="/jobs/view/"],a[href*="currentJobId="]').length,
     cards:document.querySelectorAll('[data-job-id],[data-occludable-job-id],.job-card-container').length,
     excerpt:(document.querySelector('main')?.innerText||document.body.innerText||'').replace(/\s+/g,' ').slice(0,180)
    })).catch(()=>({error:'page unavailable'}));
    console.log('[job-search-diagnostic] '+JSON.stringify({role:command.role,remote:query.remote,...diagnostic}));
   }
   for(const job of cards.slice(0,Math.max(1,Math.min(10,maxCards)))){
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
     const easy=details.getByRole('button',{name:/Easy Apply/i}).first();
     job.easyApply=await easy.waitFor({state:'visible',timeout:4000}).then(()=>true).catch(()=>false);
     if(!job.easyApply)continue;
     const scoped=await readPostingSalaryText(details,job);
     const verifiedSalary=resolveSalaryBaseline(scoped);
     job.salaryText=scoped.description+'\n'+scoped.header;
     check=evaluateSearchCandidate(job,command.role);
     check.salary=verifiedSalary;
     if(check.eligible&&!check.salary){
      const baseline=await researchComparableSalary(context,job);
      if(baseline.max<QUALIFICATION_TARGET)continue;
      job.salaryResearch=baseline;check={...check,salary:{min:baseline.min,max:baseline.max},qualification:'comparable_range_matches'};
     }
     if(check.eligible)results.push({...job,...check});
    }catch{issues.push('Some posting details could not be verified');}
    finally{await details.close().catch(()=>{});}
    if(results.length>=maxResults)break;
   }
   if(!cards.length)issues.push('LinkedIn returned no readable job cards');
  }catch{issues.push('LinkedIn search timed out or was unavailable');}
  finally{await page.close().catch(()=>{});}
 }
 results.sort((a,b)=>Number(!!b.salary)-Number(!!a.salary)||Number(a.remoteSearch)-Number(b.remoteSearch));
 const lines=results.slice(0,4).map((j,i)=>`${i+1}) ${j.title.slice(0,85)} | ${j.company.slice(0,45)} | ${j.location.slice(0,60)} | ${j.salary?'$'+j.salary.min.toLocaleString('en-US')+'–$'+j.salary.max.toLocaleString('en-US'):'salary undisclosed'}${j.salaryResearch?' (comparable estimate)':''} ${j.url}`);
 const reply=lines.length?`Lilly search: ${command.role}. Easy Apply only; Madison area / fully remote; $120K minimum.\n${lines.join('\n')}\nUnposted salaries use researched comparable ranges; comparable figures are labeled in results. No applications submitted.`:`Lilly search: No verified Easy Apply matches for ${command.role} were returned. ${[...new Set(issues)].join('; ')||'No postings met application method, role, location and salary criteria'}. No applications submitted.`;
 return {reply:reply.slice(0,1500),results,issues:[...new Set(issues)]};
}

