const DESCRIPTION='[id^="JobDetails_AboutTheJob_"],.jobs-description__content,.jobs-description-content__text,.jobs-description__text,.description__text';
const escape=text=>String(text||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function postingHtml({job,description,header,capturedAt}){
 if(String(description||'').trim().length<500)throw Error('Full job description unavailable; PDF capture blocked');
 return '<!doctype html><html><head><meta charset="utf-8"><title>'+escape(job.title)+'</title><style>@page{size:A4;margin:18mm}body{font:11pt Arial,sans-serif;color:#111;line-height:1.45}h1{font-size:19pt}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}a{overflow-wrap:anywhere}</style></head><body><h1>'+escape(job.title)+'</h1><p>'+escape(job.company)+' · Job '+escape(job.id)+'</p><p>Source: <a href="'+escape(job.url)+'">'+escape(job.url)+'</a><br>Captured: '+escape(capturedAt)+'</p><h2>Posting details</h2><pre>'+escape(header)+'</pre><h2>Original job description</h2><pre>'+escape(description)+'</pre></body></html>';
}

export async function capturePostingPdf(page,job){
 const descriptionNode=page.locator(DESCRIPTION).first();
 try{await descriptionNode.waitFor({state:'visible',timeout:12000})}
 catch{
  const diagnostic=await page.evaluate(()=>{
   const main=document.querySelector('main');
   return {headings:[...(main||document).querySelectorAll('h1,h2,h3')].map(e=>e.textContent.trim()).slice(0,15),
    candidates:[...(main||document).querySelectorAll('[id],[class],[data-testid]')].filter(e=>/description|job.*detail|about/i.test(e.id+' '+e.className+' '+e.getAttribute('data-testid'))).slice(0,20).map(e=>({tag:e.tagName,id:e.id,classes:String(e.className).slice(0,150),testId:e.getAttribute('data-testid'),textLength:(e.textContent||'').length})),
    containsAboutJob:/about the job/i.test(main?.textContent||''),textLength:(main?.textContent||'').length};
  });
  console.log('[posting-capture-diagnostic] '+JSON.stringify(diagnostic));
  throw Error('Full job description unavailable; PDF capture blocked');
 }
 const expand=page.locator('[id^="JobDetails_AboutTheJob_"] button,.jobs-description button,.jobs-description__container button,.description__text button').filter({hasText:/show more|see more/i}).first();
 if(await expand.isVisible().catch(()=>false))await expand.click({timeout:3000});
 // textContent includes collapsed original text; printing LinkedIn's scroll containers clips it.
 const description=(await descriptionNode.textContent({timeout:5000})||'').trim();
 const header=await page.locator('.job-details-jobs-unified-top-card,.jobs-unified-top-card,.top-card-layout').first().innerText({timeout:1000}).catch(async()=>{
  const text=await page.locator('main').first().innerText({timeout:3000});
  return text.split(/Use AI to assess|People you can reach|About the job/i)[0].slice(0,2000);
 });
 const html=postingHtml({job,description,header,capturedAt:new Date().toISOString()});
 const printPage=await page.context().newPage();
 try{
  await printPage.setContent(html,{waitUntil:'load',timeout:10000});
  return await printPage.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,timeout:20000});
 }finally{await printPage.close().catch(()=>{})}
}
