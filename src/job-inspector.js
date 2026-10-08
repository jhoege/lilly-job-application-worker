import fs from 'node:fs';
import path from 'node:path';

const QUEUE_PATH = path.resolve('data/candidate-jobs-2026-10-07.json');
const validId = /^\d{8,12}$/;

export function loadCandidateQueue() {
  const parsed = JSON.parse(fs.readFileSync(QUEUE_PATH,'utf8'));
  const seen = new Set();
  return (parsed.jobs || []).filter(job => {
    if(job.submitted===true || ['submitted_verified','closed_not_accepting_applications'].includes(job.status))return false;
    const id = String(job.linkedinJobId || '');
    if (!validId.test(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map(job => ({id:String(job.linkedinJobId),url:'https://www.linkedin.com/jobs/view/'+job.linkedinJobId+'/'}));
}

// Read-only job discovery: never clicks Apply, submits forms, or modifies profile.
// Do not persist page contents, authentication tokens, or personally identifying data.
export async function inspectCandidate(context, jobId) {
  const job = loadCandidateQueue().find(item => item.id === String(jobId));
  if (!job) throw new Error('Unknown candidate ID');
  if (!context) throw new Error('Browser not ready');
  const page = context.pages()[0] || await context.newPage();
  await page.goto(job.url, {waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(1200);
  const result = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    const text = (main.innerText || '').replace(/\s+/g,' ').trim();
    const title = document.querySelector('h1')?.innerText?.trim() || document.title;
    const buttons = Array.from(document.querySelectorAll('button')).map(b=>(b.innerText||b.getAttribute('aria-label')||'').trim());
    return {
      title: title.slice(0,180),
      excerpt: text.slice(0,6500),
      easyApplyVisible: buttons.some(b=>/easy apply/i.test(b)),
      applyVisible: buttons.some(b=>/^apply$/i.test(b)),
      signInRequired: /sign in|join now/i.test(document.title) && !/jobs/i.test(document.title),
    };
  });
  return {jobId:job.id,url:page.url(),...result,inspectionOnly:true,submitted:false};
}
