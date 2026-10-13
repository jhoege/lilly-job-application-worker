export async function readPostingSalaryText(page,job){
 const id=page.url().match(/\/jobs\/view\/(\d+)/)?.[1]||page.url().match(/[?&]currentJobId=(\d+)/)?.[1];
 if(id!==String(job.id))throw Error('Salary validation: current posting identity does not match job');
 const description=page.locator('[id^="JobDetails_AboutTheJob_"],.jobs-description__content,.jobs-description-content__text,.jobs-description__text,.description__text').first();
 await description.waitFor({state:'visible',timeout:12000});
 const text=(await description.textContent({timeout:5000})||'').trim();
 if(text.length<500)throw Error('Salary validation: complete job description unavailable');
 const header=await page.locator('.job-details-jobs-unified-top-card,.jobs-unified-top-card,.top-card-layout').first().innerText({timeout:1500}).catch(()=>'');
 return {description:text,header};
}
