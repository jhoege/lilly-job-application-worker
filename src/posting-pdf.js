const DESCRIPTION='.jobs-description__content,.jobs-description-content__text,.jobs-description__text,.description__text';
const escape=text=>String(text||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function postingHtml({job,description,header,capturedAt}){
 if(String(description||'').trim().length<500)throw Error('Full job description unavailable; PDF capture blocked');
 return '<!doctype html><html><head><meta charset="utf-8"><title>'+escape(job.title)+'</title><style>@page{size:A4;margin:18mm}body{font:11pt Arial,sans-serif;color:#111;line-height:1.45}h1{font-size:19pt}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}a{overflow-wrap:anywhere}</style></head><body><h1>'+escape(job.title)+'</h1><p>'+escape(job.company)+' · Job '+escape(job.id)+'</p><p>Source: <a href="'+escape(job.url)+'">'+escape(job.url)+'</a><br>Captured: '+escape(capturedAt)+'</p><h2>Posting details</h2><pre>'+escape(header)+'</pre><h2>Original job description</h2><pre>'+escape(description)+'</pre></body></html>';
}

export async function capturePostingPdf(page,job){
 const descriptionNode=page.locator(DESCRIPTION).first();
 await descriptionNode.waitFor({state:'visible',timeout:12000});
 const expand=page.locator('.jobs-description button,.jobs-description__container button,.description__text button').filter({hasText:/show more|see more/i}).first();
 if(await expand.isVisible().catch(()=>false))await expand.click({timeout:3000});
 // textContent includes collapsed original text; printing LinkedIn's scroll containers clips it.
 const description=(await descriptionNode.textContent({timeout:5000})||'').trim();
 const header=await page.locator('.job-details-jobs-unified-top-card,.jobs-unified-top-card,.top-card-layout').first().innerText({timeout:3000}).catch(()=>[job.company,job.title].join('\n'));
 const html=postingHtml({job,description,header,capturedAt:new Date().toISOString()});
 const printPage=await page.context().newPage();
 try{
  await printPage.setContent(html,{waitUntil:'load',timeout:10000});
  return await printPage.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,timeout:20000});
 }finally{await printPage.close().catch(()=>{})}
}
