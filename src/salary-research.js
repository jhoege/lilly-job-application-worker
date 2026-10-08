import {annualSalaryRange,excludedEmployer} from './job-policy.js';
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function comparableTitle(a,b){
 const rank=s=>/\bvp\b|vice president/.test(s)?'vp':/\bdirector\b/.test(s)?'director':/general manager/.test(s)?'gm':/\bhead\b/.test(s)?'head':'';
 const x=normalize(a),y=normalize(b);if(!rank(x)||rank(x)!==rank(y))return false;
 const words=x.split(' ').filter(w=>!['vp','vice','president','director','senior','of','the','and'].includes(w));
 return words.length>0&&words.some(w=>y.split(' ').includes(w));
}
export function comparableBaseline(samples){
 const unique=[...new Map(samples.filter(s=>s.range&&s.url).map(s=>[s.url,s])).values()];
 if(unique.length<2)return null;
 const median=values=>{values.sort((a,b)=>a-b);const i=Math.floor(values.length/2);return values.length%2?values[i]:(values[i-1]+values[i])/2;};
 return {min:Math.round(median(unique.map(s=>s.range.min))),max:Math.round(median(unique.map(s=>s.range.max))),samples:unique};
}
export async function researchComparableSalary(context,job){
 const page=await context.newPage(),samples=[];
 const url=new URL('https://www.linkedin.com/jobs/search/');url.searchParams.set('keywords',job.title);url.searchParams.set('location',job.location||'United States');url.searchParams.set('f_TPR','r2592000');url.searchParams.set('f_AL','true');
 try{
  await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:18000});
  await page.locator('a[href*="/jobs/view/"],a[href*="currentJobId="]').first().waitFor({timeout:7000}).catch(()=>{});
  if(/login|checkpoint|authwall/.test(page.url()))throw Error('Salary research requires LinkedIn sign-in/verification');
  const candidates=await page.evaluate(()=>[...new Map([...document.querySelectorAll('a[href*="/jobs/view/"],a[href*="currentJobId="]')].map(a=>{const h=a.href,id=h.match(/\/jobs\/view\/(\d{8,12})/)?.[1]||h.match(/[?&]currentJobId=(\d{8,12})/)?.[1];return [id,{id,title:(a.innerText||a.getAttribute('aria-label')||'').trim()}];})).values()].filter(j=>j.id));
  for(const candidate of candidates.filter(c=>c.id!==job.id&&comparableTitle(job.title,c.title)).slice(0,6)){
   const postingUrl='https://www.linkedin.com/jobs/view/'+candidate.id+'/';
   try{
    await page.goto(postingUrl,{waitUntil:'domcontentloaded',timeout:10000});
    await page.locator('[id^="JobDetails_AboutTheJob_"],.jobs-description__content').first().waitFor({timeout:5000}).catch(()=>{});
    const text=await page.locator('main').innerText({timeout:3000});
    if(/no longer accepting applications/.test(text)||excludedEmployer(text.slice(0,300)))continue;
    const range=annualSalaryRange(text);if(range)samples.push({title:candidate.title,url:postingUrl,range,locationBasis:job.location||'United States; comparable leadership title'});
    if(samples.length>=3)break;
   }catch{}
  }
  const baseline=comparableBaseline(samples);if(!baseline)throw Error('Comparable salary research found fewer than two current matching salary ranges');
  return {...baseline,basis:'researched_comparable_range',researchedAt:new Date().toISOString()};
 }finally{await page.close().catch(()=>{});}
}
export function salaryChoice(options,target){
 const amount=s=>Number(s.replace(/[$,\s]/g,'').replace(/k$/i,''))*(/k$/i.test(s)?1000:1);
 const candidates=options.filter(o=>{
  const label=o.label||'',range=label.match(/(\$?\s*[\d,]+\s*k?)\s*(?:-|–|—|to)\s*(\$?\s*[\d,]+\s*k?)/i);
  if(range){const lo=amount(range[1].trim()),hi=amount(range[2].trim());return lo>=10000&&target>=lo&&target<=hi;}
  const above=label.match(/(?:more than|greater than|above|>)\s*(\$?\s*[\d,]+\s*k?)/i);if(above)return target>amount(above[1].trim());
  const open=label.match(/(\$?\s*[\d,]+\s*k?)\s*(?:\+|or more|and above|and over)/i);if(open)return target>=amount(open[1].trim());
  return /^\$?[\d,]+$/.test(label.trim())&&amount(label.trim())===target;
 });
 return candidates.length===1?candidates[0]:null;
}
