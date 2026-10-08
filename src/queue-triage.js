import {getQueue,salaryRequest} from './application-support.js';
import {readApprovedAnswers,appendUnknownQuestions,readSubmittedJobIds,readApplicationLedger,logVerifiedLinkedInApplication,upsertApplicationStatus,setSalaryBaseline} from './google-answers.js';
import {excludedEmployer,excludedApplication,annualSalaryRange} from './job-policy.js';
import {archivePosting} from './posting-archive.js';
import {researchComparableSalary,salaryChoice} from './salary-research.js';
import {exportResumePacket,uploadResumePacket,verifyResumeSelection} from './resume-packet.js';
let running=false;
let cancelRequested=false;
let activePage=null;
let progress={running:false,processed:0,total:0,currentJob:null,stage:'idle',stageSince:null,startedAt:null,updatedAt:null,lastResult:null,results:[]};
function setStage(stage){progress.stage=stage;progress.stageSince=new Date().toISOString();progress.updatedAt=progress.stageSince;}
function recordResult(result){progress.results.push(result);progress.processed++;progress.updatedAt=new Date().toISOString();}
export function getTriageStatus(){return {...progress};}
export async function cancelTriage(){if(!running)return {running:false};cancelRequested=true;if(activePage)await activePage.close().catch(()=>{});return {cancelRequested:true};}
export function startTriage(context,options={}){if(running)return {started:false,reason:'already_running',progress:getTriageStatus()};void triageQueue(context,options).then(result=>{progress.lastResult=result}).catch(e=>{progress.lastResult={error:String(e.message).slice(0,180)}});return {started:true,progress:getTriageStatus()};}
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const aliases=new Map([
 ['email address','email'],['mobile phone number','mobile'],['phone number','mobile'],
 ['first name','first name'],['last name','last name'],['current location','current location'],
 ['what is your current location','current location'],
 ['are you legally authorized to work in the united states','authorized to work in us'],
 ['will you now or in the future require sponsorship for employment visa status e g h 1b visa status','require visa sponsorship now or later']
]);
function lookupAnswer(label,approved,advertisedSalary){
 const n=normalize(label).replace(/ required$/,'');
 let key=aliases.get(n)||n;
 if(/(furnish|provide|show).*(documentation|documents|proof)/.test(n))return approved.find(a=>normalize(a.question)===n)?.answer;
 if(/(desired|expected|salary expectation|compensation expectation)/.test(n)&&/(salary|compensation|pay)/.test(n)){
  return advertisedSalary==null?undefined:String(advertisedSalary);
 }
 const exact=approved.find(a=>normalize(a.question).replace(/ required$/,'')===n);
 if(exact)return exact.answer;
 if(/(years|how long)/.test(n)&&/(management|managing people)/.test(n))key='management years';
 else if(/(years|how long)/.test(n)&&/(marina|real estate)/.test(n))key='marina or real estate experience years';
 else if(/legally authorized|eligible to work|work authorization/.test(n))key='authorized to work in us';
 else if(/(visa|immigration|employment).*sponsor|sponsor.*(visa|employment)/.test(n))key='require visa sponsorship now or later';
 else if(/security clearance/.test(n))key='security clearance held';
 else if(/willing to relocate/.test(n))key='willing to relocate';
 else if(/phone number|mobile phone/.test(n))key='mobile';
 return approved.find(a=>normalize(a.question)===key)?.answer;
}
const FORM_SELECTOR='[data-lilly-application="true"]';
async function fieldsOnPage(page){
 return page.evaluate(()=>{
  const candidates=[...document.querySelectorAll('dialog,.jobs-easy-apply-modal,[role="dialog"],[aria-modal="true"]')].filter(d=>d.getClientRects().length);
  for(const el of candidates)el.removeAttribute('data-lilly-application');
  const ranked=candidates.map(d=>{
   const buttons=[...d.querySelectorAll('button')].map(b=>(b.innerText||b.getAttribute('aria-label')||'').trim()).filter(Boolean);
   const title=(d.querySelector('h1,h2,h3,legend')?.innerText||'').slice(0,120);
   const text=(d.innerText||'').slice(0,600);
   const controls=d.querySelectorAll('input:not([type="hidden"]),textarea,select').length;
   const action=buttons.some(b=>/^(next|continue|review|submit application|review application)/i.test(b));
   const score=(d.classList.contains('jobs-easy-apply-modal')?20:0)+(action?12:0)+
    (/contact info|resume|additional questions|application|apply to/i.test(title+' '+text)?5:0)+
    (controls>1?3:0)-(buttons.length===1&&/show all/i.test(buttons[0])?20:0);
   return {d,score};
  }).sort((a,b)=>b.score-a.score);
  const dialog=ranked[0]?.score>=7?ranked[0].d:null;
  if(!dialog)return null;
  dialog.setAttribute('data-lilly-application','true');
  for(const old of dialog.querySelectorAll('[data-lilly-field]'))old.removeAttribute('data-lilly-field');
  const fields=[...dialog.querySelectorAll('input,textarea,select')].filter(el=>{
   const style=window.getComputedStyle(el);
   return el.type!=='hidden'&&style.visibility!=='hidden'&&style.display!=='none'&&el.getClientRects().length>0;
  });
  const normalizeText=s=>String(s||'').replace(/\s+/g,' ').replace(/\s*\*\s*$/,'').trim();
  return fields.map((el,index)=>{
   el.setAttribute('data-lilly-field',String(index));
   const fieldset=el.closest('fieldset');
   let group=fieldset;
   if(el.type==='radio'||el.type==='checkbox'){
    for(let n=el.parentElement;n&&n!==dialog;n=n.parentElement){
     const peers=[...n.querySelectorAll('input')].filter(x=>x.type===el.type&&x.name===el.name);
     if(peers.length>1&&/[*?]/.test(n.innerText||'')){group=n;break;}
    }
   }
   const groupText=(group?.innerText||'').split(/\n/).map(s=>s.trim()).filter(Boolean);
   let checkboxQuestion='';
   if(el.type==='checkbox')for(let n=el.parentElement;n&&n!==dialog;n=n.parentElement){
    if(n.querySelectorAll('input[type=checkbox]').length>1)break;
    const lines=(n.innerText||'').split(/\n/).map(x=>x.trim()).filter(Boolean);
    const question=lines.find(x=>/[*]\s*$/.test(x)||/^You declare that/i.test(x));
    if(question){checkboxQuestion=question;break;}
   }
   const questionText=groupText.slice(0,groupText.findIndex(s=>/^(yes|no|[0-9]+.*years?)$/i.test(s))<0?1:groupText.findIndex(s=>/^(yes|no|[0-9]+.*years?)$/i.test(s))).join(' ');

   const wrapper=el.closest('.fb-dash-form-element, .jobs-easy-apply-form-element, .artdeco-text-input, .fb-dash-form-element-group');
   const label=normalizeText(
    (el.type==='radio'||el.type==='checkbox'?checkboxQuestion||fieldset?.querySelector('legend')?.innerText||questionText:null)||
    el.getAttribute('aria-label')||
    el.labels?.[0]?.innerText||
    (el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.innerText).filter(Boolean).join(' ')||
    fieldset?.querySelector('legend')?.innerText||
    wrapper?.querySelector('label, .fb-dash-form-element__label')?.innerText||
    el.getAttribute('placeholder')
   );
   const required=el.required||el.getAttribute('aria-required')==='true'||
    !!wrapper?.querySelector('label .visually-hidden, .fb-dash-form-element__label .visually-hidden')||
    /[*]\s*$/.test(el.labels?.[0]?.innerText||'')||/[*]\s*$/.test(fieldset?.querySelector('legend')?.innerText||'')||((el.type==='radio'||el.type==='checkbox')&&/[*]/.test(checkboxQuestion||questionText));
   const filled=el.type==='radio'
    ? !![...dialog.querySelectorAll('input[type="radio"]')].find(other=>other.name===el.name&&(other.checked||other.closest('[role=radio]')?.getAttribute('aria-checked')==='true'))
    : el.type==='checkbox' ? el.checked||el.closest('[role=checkbox]')?.getAttribute('aria-checked')==='true'
    : el.tagName==='SELECT' ? !!el.value&&!/^(select|choose|please select)$/i.test(el.selectedOptions?.[0]?.textContent?.trim()||'')
    : el.type==='file' ? !!el.files?.length
    : !!String(el.value||'').trim();
   return {index,label:label.slice(0,350),type:el.type||el.tagName.toLowerCase(),required,filled,
    tag:el.tagName.toLowerCase(),name:String(el.name||'').slice(0,100)};
  });
 });
}
async function saveDraftIfSupported(page){
 const dialog=page.locator(FORM_SELECTOR).first();
 try{
  const save=dialog.getByRole('button',{name:/^save( application| draft)?$/i}).first();
  if(await save.isVisible({timeout:800}).catch(()=>false)){
   await save.click({timeout:3000});
   return {saved:true,reason:'LinkedIn Save action clicked'};
  }
  const dismiss=dialog.locator('button[aria-label*="dismiss" i],button[aria-label*="close" i]').first();
  if(await dismiss.isVisible({timeout:800}).catch(()=>false)){
   await dismiss.click({timeout:3000});
   const confirmation=page.getByRole('dialog').getByRole('button',{name:/^save( application| draft)?$/i}).last();
   if(await confirmation.waitFor({state:"visible",timeout:1800}).then(()=>true).catch(()=>false)){
    await confirmation.click({timeout:3000});
    return {saved:true,reason:'LinkedIn Save draft confirmation clicked'};
   }
  }
 }catch(e){return {saved:false,reason:'Save attempt failed: '+String(e.message).slice(0,90)}}
 return {saved:false,reason:'No supported LinkedIn Save draft control'};
}
async function saveJobForLater(page,source){
 if(source==='LinkedIn saved')return {saved:true,reason:'Already on LinkedIn saved-jobs list'};
 try{
  const saved=page.locator('button[aria-label*="Saved" i], .jobs-save-button[aria-pressed="true"]').first();
  if(await saved.isVisible({timeout:500}).catch(()=>false))return {saved:true,reason:'Job already saved'};
  const save=page.locator('button.jobs-save-button, button[aria-label^="Save "],button[aria-label="Save"]').first();
  if(await save.isVisible({timeout:900}).catch(()=>false)){
   await save.click({timeout:3000});
   return {saved:true,reason:'Clicked LinkedIn Save job'};
  }
 }catch(e){return {saved:false,reason:'Save job failed: '+String(e.message).slice(0,80)}}
 return {saved:false,reason:'No LinkedIn Save job control detected'};
}
const displayStatus={
 excluded_qualification:'Excluded - required qualification',needs_answers:'Needs answers',ready_for_review:'Ready for review',
 needs_manual_review:'Needs review',submission_blocked:'Submission blocked',
 submission_unverified:'Submission unverified - Verify before retry',
 technical_failure:'Technical error',job_timeout:'Timed out',
 login_required:'Login required',closed:'Closed',
 external_application:'External application required',
 easy_apply_not_detected:'Easy Apply unavailable',
 form_unavailable:'Form unavailable',application_modal_not_found:'Application window not found',no_easy_apply:'Easy Apply unavailable',
 already_applied_logged:'Submitted verified',submitted_verified:'Submitted verified',
 cancelled:'Cancelled',requires_review:'Needs review'
};
export async function triageQueue(context,{limit=5,offset=0,ids=null,jobsOverride=null}={}){
 if(running)throw Error('A triage run is already active');
 if(!context)throw Error('Browser unavailable');
 running=true;
 cancelRequested=false;
 const results=[];
 progress={running:true,processed:0,total:0,currentJob:null,stage:'loading_answers',stageSince:new Date().toISOString(),startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),lastResult:null,results:[]};
 try{
  setStage('loading_answer_database');
  const [approved,submittedIds,ledger]=await Promise.all([readApprovedAnswers(),readSubmittedJobIds(),readApplicationLedger()]);
  const excludedIds=new Set(ledger.filter(j=>excludedApplication(j.status)).map(j=>j.id));
  const jobs=(Array.isArray(jobsOverride)?jobsOverride:getQueue()).filter(x=>!x.submitted&&x.status!=='closed_not_accepting_applications'&&(!Array.isArray(ids)||ids.includes(x.id))).slice(Math.max(0,Number(offset)||0),Math.max(0,Number(offset)||0)+Math.max(1,Math.min(10,Number(limit)||5)));
  progress.total=jobs.length;
  try{
   for(const job of jobs){
    if(cancelRequested)break;
    progress.currentJob=job.id;
    setStage('checking_submission_history');
    if(submittedIds.has(job.id)){const result={jobId:job.id,status:'skipped_already_logged',visited:false};results.push(result);recordResult(result);continue;}
    if(excludedIds.has(job.id)){const result={jobId:job.id,status:'skipped_excluded',visited:false};results.push(result);recordResult(result);continue;}
    let stage='navigation';
    let page=null;
    let watchdog=null;
    let timedOut=false;
    let submissionAttempted=false;
    try{
     page=await context.newPage();
     activePage=page;
     // Abort a single slow job without blocking the remaining queue.
     watchdog=setTimeout(()=>{timedOut=true;void page.close().catch(()=>{})},240000);
     setStage('opening_job');
     await page.goto(job.url,{waitUntil:'domcontentloaded',timeout:25000});
     await page.locator('h1').first().waitFor({state:'visible',timeout:9000}).catch(()=>{});
     await page.waitForTimeout(1200);
     setStage('checking_linkedin_application_status');
     const currentJobStatus=await page.locator('main').first().innerText({timeout:4000}).catch(()=>'');
     const liveCompany=await page.locator('.job-details-jobs-unified-top-card__company-name,.jobs-unified-top-card__company-name,.topcard__org-name-link').first().innerText({timeout:1500}).catch(()=>'');
     if(liveCompany)job.company=liveCompany.trim();
     if(excludedEmployer(job.company)){results.push({jobId:job.id,status:'excluded_employer',reason:'User excluded this employer'});continue;}
     if(!job.company){results.push({jobId:job.id,status:'needs_manual_review',reason:'Employer could not be verified; application not opened'});continue;}
     if(/application status[\s\S]{0,100}application submitted/i.test(currentJobStatus)){
      setStage('recording_verified_application');
      const logged=await logVerifiedLinkedInApplication(job);
      submittedIds.add(job.id);
      results.push({jobId:job.id,status:'already_applied_logged',logged:logged.added});continue;
     }
     let advertisedSalary=null;
     setStage('archiving_job_posting');
     const archive=await archivePosting(page,job);
     if(!archive.ok){
      results.push({jobId:job.id,status:'needs_manual_review',reason:'Posting PDF archive failed: '+archive.reason});
      continue;
     }
     const postingText=await page.locator('[id^="JobDetails_AboutTheJob_"],.jobs-description__content').first().innerText().catch(()=>'');
     if(/active top secret|top secret.{0,35}must have clearance to start/i.test(postingText)&&/not currently|^no$/i.test(lookupAnswer('Security clearance held?',approved)||'')){
      results.push({jobId:job.id,status:'excluded_qualification',reason:'Active Top Secret clearance required; approved answer says no current clearance'});continue;
     }
     setStage('finding_easy_apply');
     // LinkedIn uses both native buttons and custom aria-labels for Easy Apply.
     // Inspect multiple grounded controls; do not infer availability from an incomplete load.
     const selectors=[
      'button.jobs-apply-button',
      'button[aria-label*="Easy Apply" i]',
      'button:has-text("Easy Apply")',
      '[role="button"][aria-label*="Easy Apply" i]'
     ];
     let easy=null;
     // A saved Easy Apply draft replaces the initial button with Continue.
     // Only resume that control when the current job explicitly identifies a saved application.
     if(/last modified this application|saved this application/i.test(currentJobStatus)){
      for(const role of ['button','link']){
       const candidate=page.getByRole(role,{name:/^Continue(?: application)?$/i}).first();
       if(await candidate.isVisible().catch(()=>false)){easy=candidate;break;}
      }
     }
     for(const selector of selectors){
      if(easy)break;
      const candidate=page.locator(selector).first();
      if(await candidate.waitFor({state:"visible",timeout:2000}).then(()=>true).catch(()=>false)){
       const label=((await candidate.innerText().catch(()=>''))+' '+(await candidate.getAttribute('aria-label').catch(()=>''))).trim();
       if(/easy apply/i.test(label)){easy=candidate;break}
      }
     }
     if(!easy){
      const login=await page.locator('input[name="session_key"], input#username').count();
      const text=(await page.locator('main').first().innerText({timeout:3000}).catch(()=>'' )).slice(0,1800);
      const status=login?'login_required':/no longer accepting applications/i.test(text)?'closed':/apply on company website|apply externally/i.test(text)?'external_application':'easy_apply_not_detected';
      const jobSaved=status==='closed'?{saved:false,reason:'Closed posting'}:await saveJobForLater(page,job.source);
      results.push({jobId:job.id,status,jobSaved:jobSaved.saved,saveNote:jobSaved.reason,diagnostic:'No visible Easy Apply control after page loaded'});continue;
     }
     setStage('resolving_salary_baseline');
     let salaryBaseline=annualSalaryRange(currentJobStatus+'\n'+postingText);
     if(!salaryBaseline)salaryBaseline=await researchComparableSalary(context,job);
     advertisedSalary=salaryRequest(salaryBaseline).amount;
     job.salaryRequest=advertisedSalary;
     await setSalaryBaseline(job,salaryBaseline,advertisedSalary);
     const resumeVersion=ledger.find(x=>x.id===job.id)?.resumeVersion||job.resumeVersion||'';
     const packet=resumeVersion?await exportResumePacket({...job,resumeVersion}):null;
     let packetSelected=false,resumeRepairAttempted=false;
     setStage('opening_application');
     await easy.click({timeout:8000});
     let modalReady=false;
     for(let attempt=0;attempt<9;attempt++){
      if(await fieldsOnPage(page)){modalReady=true;break}
      await page.waitForTimeout(700);
     }
     if(!modalReady){
      const diagnostic=await page.evaluate(()=>({
       url:location.href.slice(0,180),
       title:document.title.slice(0,110),
       dialogs:[...document.querySelectorAll('[role="dialog"]')].map(d=>({
        heading:(d.querySelector('h1,h2,h3')?.innerText||'').slice(0,70),
        buttons:[...d.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,6),
        inputs:d.querySelectorAll('input,textarea,select').length
       })).slice(0,4),
       loginVisible:!!document.querySelector('input[name="session_key"],input#username'),
       formCount:document.querySelectorAll('form').length
      }));
      results.push({jobId:job.id,status:'application_modal_not_found',diagnostic:JSON.stringify(diagnostic).slice(0,450)});continue;
     }
     // The modal shell often renders before the LinkedIn application questions.
     // Wait for real form controls instead of treating the loading shell as an empty application.
     setStage('waiting_for_application_fields');
     await page.waitForFunction(()=>{
      const d=document.querySelector('[data-lilly-application="true"]');
      return !!d&&(d.querySelectorAll('input:not([type="hidden"]),select,textarea').length>0||
        [...d.querySelectorAll('button')].some(b=>/next|review|submit application|continue/i.test(b.innerText||'')));
     },null,{timeout:9000}).catch(()=>{});
     stage='form';
     let steps=0,unknown=[],status='requires_review',diagnostic=null;
     for(let step=0;step<20;step++){
      setStage('reading_form_page_'+(step+1));
      const fields=await fieldsOnPage(page);
      if(!fields){status='form_unavailable';break}
      const missing=[],fillErrors=[],unknownFields=[];
      const resumePage=packet&&!packetSelected&&await page.locator(FORM_SELECTOR).evaluate(d=>/^Resume\s*[*]?$/m.test(d.innerText||'')&&![...d.querySelectorAll('button')].some(b=>/^submit application$/i.test((b.innerText||'').trim())));
      if(packet&&!packetSelected&&(resumePage||await page.locator(FORM_SELECTOR+' input[type=file]').count())){
       const uploaded=await uploadResumePacket(page,FORM_SELECTOR,packet);
       if(!uploaded.ok){status='needs_manual_review';diagnostic={reason:uploaded.reason};break;}
       packetSelected=true;
      }
      setStage('matching_approved_answers');
      for(const f of fields){
       // Trust pre-filled values from the user's prior applications; never overwrite them.
       if(packetSelected&&f.type==='file')continue;
       const salaryField=/(desired|expected|salary expectation|compensation expectation)/i.test(f.label)&&/(salary|compensation|pay)/i.test(f.label);
       if((!f.required||f.filled)&&!salaryField)continue;
       const answer=lookupAnswer(f.label,approved,advertisedSalary);
       // Only fill clearly labeled text-like fields. No guessed dropdown, radio, checkbox, file or identity answers.
       if(answer!==undefined&&f.label){
        const currentFields=await fieldsOnPage(page);
        const currentField=currentFields?.find(x=>x.index===f.index&&x.label===f.label);
        if(currentField?.filled&&!salaryField)continue;
        if(currentField)f.name=currentField.name;
        let input=page.locator(FORM_SELECTOR+' [data-lilly-field="'+f.index+'"]');
        try{
         if(['text','email','tel','number','textarea'].includes(f.type)){
          await input.fill(String(answer),{timeout:2500});
         }else if(f.type==='radio'){
          const wanted=normalize(/willing to work overtime as needed/i.test(f.label)&&/^I am open to working as required/i.test(answer)?'Yes':answer);
          const group=page.locator(FORM_SELECTOR+' input[type=radio][data-lilly-field]');
          const names=await group.evaluateAll(nodes=>nodes.map(n=>{
           let label=n.getAttribute('aria-label')||(n.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.innerText||'').join(' ').trim()||n.labels?.[0]?.innerText||n.closest('label')?.innerText||'';
           if(!label.trim())for(let a=n.parentElement;a;a=a.parentElement){
            const peers=[...a.querySelectorAll('input[type=radio]')].filter(x=>x.name===n.name);
            if(peers.length>1)break;
            if((a.innerText||'').trim()){label=a.innerText.trim();break;}
           }
           return {name:n.name,value:n.value,label};
          }));
          const selected=names.findIndex(x=>x.name===f.name&&(normalize(x.value)===wanted||normalize(x.label)===wanted));
          if(selected<0)throw Error('No exact approved radio choice');
          await checkNativeChoice(page,group.nth(selected),f.label);
         }else if(f.type==='checkbox'&&/indicate all shifts/i.test(f.label)&&/^I am open to any required hours and shifts/i.test(answer)){
          await checkNativeChoice(page,input,f.label);
         }else if(f.type==='checkbox'&&/^(yes|i consent|i agree|true)$/i.test(String(answer).trim())){
          await checkNativeChoice(page,input,f.label);
         }else if(f.tag==='select'){
          const choices=await input.evaluate(n=>[...(n.options||[])].map(o=>({label:o.textContent,value:o.value})),null,{timeout:1200});
          const choice=choices.find(o=>normalize(o.label)===normalize(answer)||normalize(o.value)===normalize(answer))||(/salary|compensation|pay/i.test(f.label)&&Number(answer)>0?salaryChoice(choices,Number(answer)):null);
          if(!choice)throw Error('No matching approved select choice');
          await input.selectOption({value:choice.value},{timeout:2500});
         }else throw Error('Unsupported field type');
        }catch(e){fillErrors.push({label:f.label,type:f.type,error:String(e.message).slice(0,1200),nativeChoice:e.nativeChoice||null,target:await input.evaluate(n=>({tag:n.tagName,type:n.type,label:n.getAttribute('aria-label'),id:n.id}),null,{timeout:800}).catch(()=>null)});missing.push(f)}
       }else {missing.push(f);unknownFields.push(f);}
      }
      if(missing.length){setStage('collecting_unanswered_questions');
       unknown=[...new Set(unknownFields.map(x=>x.label||('Unlabeled required '+x.type+' field')))];
       diagnostic={page:step+1,visibleFields:fields.length,unfilledRequired:missing.length,reason:'required_answers_missing',fillErrors,missing:missing.map(f=>({label:f.label,type:f.type})),fields:fields.map(f=>({label:f.label,type:f.type,name:f.name,required:f.required,filled:f.filled})),choices:await page.locator(FORM_SELECTOR+' input[type=radio],'+FORM_SELECTOR+' select').evaluateAll(ns=>ns.map(n=>({name:n.name,value:n.type==='radio'?n.value:null,label:n.labels?.[0]?.innerText||n.closest('label')?.innerText||n.parentElement?.innerText||n.getAttribute('aria-label')||'',options:n.options?[...n.options].map(o=>({label:o.textContent,value:o.value})):[]})))};
       status=unknown.length?'needs_answers':'submission_blocked';break;
      }
      const dialog=page.locator(FORM_SELECTOR);
      const review=dialog.getByRole('button',{name:/^(review|review application)$/i});
      const next=dialog.getByRole('button',{name:/^(next|continue|continue to next step)$/i});
      const submit=dialog.getByRole('button',{name:/^submit application$/i});
      diagnostic={page:step+1,visibleFields:fields.length,unfilledRequired:missing.length,
       buttons:(await dialog.locator('button').allTextContents().catch(()=>[])).map(s=>s.trim()).filter(Boolean).slice(-12)};
      if(await submit.isVisible().catch(()=>false)){
       if(process.env.AUTO_SUBMIT_ENABLED==='true'&&process.env.TEST_MODE==='false'&&!submittedIds.has(job.id)){
        // Submit only after all observed required fields are complete, and verify LinkedIn's confirmation.
        setStage('validating_before_submission');
        // Re-check submitted IDs immediately before submitting to avoid a stale queue.
        if((await readSubmittedJobIds()).has(job.id)){status='already_applied_logged';break}
        if(excludedApplication((await readApplicationLedger()).find(j=>j.id===job.id)?.status)){status='skipped_excluded';break}
        if(packet&&(!packetSelected||!await verifyResumeSelection(page,FORM_SELECTOR,packet.name))){
         const edit=page.locator(FORM_SELECTOR).getByRole('button',{name:/^Edit Resume$/i});
         if(!resumeRepairAttempted&&await edit.isVisible().catch(()=>false)){resumeRepairAttempted=true;packetSelected=false;await edit.click({timeout:4000});await page.waitForTimeout(700);continue;}
         status='submission_blocked';diagnostic={reason:'Exact approved resume selection not verified on review',packetName:packet.name,form:await formDiagnostic(page)};break;}
        const validation=await page.evaluate(()=>{
         const dialog=document.querySelector('[data-lilly-application="true"]');
         if(!dialog)return {invalid:1,reason:'Application dialog missing'};
         const invalid=[...dialog.querySelectorAll('input,textarea,select')].filter(el=>el.getClientRects().length&&
          (el.getAttribute('aria-invalid')==='true'||(el.required&&!el.checkValidity())));
         return {invalid:invalid.length};
        });
        if(validation.invalid>0){status='submission_blocked';diagnostic={...diagnostic,reason:'Unresolved invalid required fields',invalidFields:validation.invalid};break}
        if(!await submit.isEnabled()) {status='submission_blocked';diagnostic={...diagnostic,reason:'Submit disabled'};break}
        setStage('submitting_completed_application');
        submissionAttempted=true;
        await upsertApplicationStatus(job,'Submission unverified - Verify before retry','Submission action about to be attempted; verification required before any retry');
        await submit.click({timeout:8000});
        const confirmation=page.getByText(/your application was sent to|application submitted successfully|application was submitted/i).first();
        if(await confirmation.waitFor({state:'visible',timeout:12000}).then(()=>true).catch(()=>false)){
         setStage('logging_verified_submission');
         const logged=await logVerifiedLinkedInApplication(job);
         submittedIds.add(job.id);
         status='submitted_verified';
         diagnostic={...diagnostic,logged:logged.added};
        }else status='submission_unverified';
       }else status='ready_for_review';
       break;
      }
      if(await review.count()&&await review.first().isEnabled()){
       setStage('advancing_to_review');
       if(!await advanceForm(page,review.first())){status='submission_blocked';diagnostic={...diagnostic,reason:'Review did not advance',form:await formDiagnostic(page)};break;}steps++;continue;
      }
      if(await next.count()&&await next.first().isEnabled()){
       setStage('advancing_form_page');
       if(!await advanceForm(page,next.first())){status='submission_blocked';diagnostic={...diagnostic,reason:'Next did not advance',form:await formDiagnostic(page)};break;}steps++;continue;
      }
      // If LinkedIn disables Next/Review, capture blank fields rather than silently stalling.
      // These become exceptions for the user's approval; never guess the missing response.
      const emptyFields=fields.filter(f=>!f.filled&&f.label&&f.type!=='checkbox');
      const invalid=await dialog.locator('[aria-invalid="true"], .artdeco-inline-feedback--error, .fb-dash-form-element__error-field').count();
      if(emptyFields.length&&(invalid>0||await next.count()||await review.count())){
       unknown=[...new Set(emptyFields.map(f=>f.label))];
       status='needs_answers';
       diagnostic={...diagnostic,reason:'validation_blocked_or_disabled_next',invalidFields:invalid};
      }else{
       status='needs_manual_review';
       diagnostic={...diagnostic,reason:'no_supported_navigation_action',invalidFields:invalid};
      }
      break;
     }
     let added=0;
     if(unknown.length){setStage('saving_questions_to_sheet');added=(await appendUnknownQuestions(unknown.map(question=>({jobId:job.id,platform:'LinkedIn',question,url:job.url,employer:job.company})))).added;}
     let draft={saved:false,reason:'No draft save attempted'};
     let jobSaved={saved:false,reason:'Not checked'};
     if(!['submitted_verified','submission_unverified'].includes(status)){
      setStage('saving_unfinished_application');
      draft=await saveDraftIfSupported(page);
      jobSaved=await saveJobForLater(page,job.source);
     }
     results.push({jobId:job.id,status,stepsCompleted:steps,unknownQuestions:unknown.length,logged:added,diagnostic,draftSaved:draft.saved,jobSaved:jobSaved.saved,draftNote:draft.reason,saveNote:jobSaved.reason,submitted:status==='submitted_verified'});
     // Submission occurs only with standing authorization and observed confirmation.
    }catch(e){results.push({jobId:job.id,status:submissionAttempted?'submission_unverified':cancelRequested?'cancelled':timedOut?'job_timeout':'technical_failure',stage,reason:String(e.message).slice(0,120)})}
    finally{
     if(watchdog)clearTimeout(watchdog);
     activePage=null;
     if(page)await page.close().catch(()=>{});
     const last=results[results.length-1];
     const outcome=last?.jobId===job.id?last:{jobId:job.id,status:'unknown'};
     if(!submittedIds.has(job.id)&&!['skipped_already_logged','skipped_excluded','submitted_verified','already_applied_logged'].includes(outcome.status)){
      const label=displayStatus[outcome.status]||'Needs review';
      const display=(outcome.draftSaved||outcome.jobSaved)&&!['closed','submitted_verified','submission_unverified'].includes(outcome.status)?'Saved - '+label:label;
      const reason=[outcome.diagnostic?.reason||outcome.reason||outcome.diagnostic||'',outcome.diagnostic?.form?.text||'',outcome.draftNote||'',outcome.saveNote||''].filter(x=>typeof x==='string'&&x).join('; ').slice(0,450);
      try{await upsertApplicationStatus(job,display,reason,{source:job.source})}
      catch(e){outcome.ledgerError=String(e.message).slice(0,120);console.error('[application-ledger] job='+job.id+' '+outcome.ledgerError)}
     }
     console.log('[triage-job-result] '+JSON.stringify(outcome));
     recordResult(outcome);
     setStage('moving_to_next_job');
    }
   }
  }finally{activePage=null}
  return {mode:process.env.AUTO_SUBMIT_ENABLED==='true'&&process.env.TEST_MODE==='false'?'guarded_submission':'safe_multistep_triage',submitted:results.filter(x=>x.submitted).length,results};
 }finally{running=false;progress.running=false;progress.currentJob=null;setStage(cancelRequested?'cancelled':'finished')}
}



async function formDiagnostic(page){return page.locator(FORM_SELECTOR).evaluate(d=>({text:(d.innerText||'').slice(0,2200),files:[...d.querySelectorAll('input[type=file]')].map(n=>({accept:n.accept,required:n.required})),radios:[...d.querySelectorAll('input[type=radio]')].map(n=>({label:n.labels?.[0]?.innerText,checked:n.checked,value:n.value})),attachments:[...d.querySelectorAll('a,[title],[aria-label]')].map(n=>({text:n.innerText?.slice(0,160),title:n.title,label:n.getAttribute('aria-label'),href:n.getAttribute('href')})).filter(n=>/pdf|resume|Lilly/i.test(JSON.stringify(n))).slice(0,15),checkboxes:[...d.querySelectorAll('input[type=checkbox]')].map(n=>({checked:n.checked,html:n.closest('[role=checkbox]')?.outerHTML?.slice(0,1800)}))})).catch(()=>({}));}
async function advanceForm(page,button){
 const before=await page.locator(FORM_SELECTOR).innerText();
 await button.click({timeout:5000});
 const changed=await page.waitForFunction(({selector,before})=>{const d=document.querySelector(selector);return d&&d.innerText!==before;},{selector:FORM_SELECTOR,before},{timeout:7000}).then(()=>true).catch(()=>false);
 await page.waitForTimeout(700);return changed;
}

async function checkNativeChoice(page,input,question){
 if(await input.evaluate(n=>n.checked||n.closest('[role=radio],[role=checkbox]')?.getAttribute('aria-checked')==='true',null,{timeout:1500}))return;
 const meta=await input.evaluate(n=>{
  const key=n.id||'choice-'+Math.random().toString(36).slice(2);
  let text=n.getAttribute('aria-label')||n.labels?.[0]?.innerText||'',wrapper=null,scope=null;
  for(let a=n.parentElement;a;a=a.parentElement){
   const peers=[...a.querySelectorAll('input')].filter(x=>x.type===n.type&&(n.type==='checkbox'||x.name===n.name));
   if(peers.length>1){scope=a;break;}
   const box=a.getBoundingClientRect();
   if(!text.trim()&&(a.innerText||'').trim())text=a.innerText.trim();
   if((a.innerText||'').trim()&&box.width>18&&box.height>12)wrapper=a;
  }
  if(scope)scope.setAttribute('data-lilly-choice-scope',key);
  if(wrapper)wrapper.setAttribute('data-lilly-choice-for',key);
  return {key,id:n.id,text:text.trim(),scope:!!scope,wrapper:!!wrapper,html:(wrapper?.outerHTML||n.parentElement?.outerHTML||'').slice(0,1800)};
 },null,{timeout:1200});
 let clicked=false;
 if(meta.scope&&meta.text){
  const scope=page.locator(FORM_SELECTOR+' [data-lilly-choice-scope='+JSON.stringify(meta.key)+']');
  for(const candidate of await scope.getByText(meta.text,{exact:true}).all()){
   const box=await candidate.boundingBox().catch(()=>null);
   if(box&&box.width>8&&box.height>8&&await candidate.isVisible()){await candidate.click({timeout:4000});clicked=true;break;}
  }
 }
 if(!clicked&&meta.wrapper){await page.locator(FORM_SELECTOR+' [data-lilly-choice-for='+JSON.stringify(meta.key)+']').click({timeout:4000});clicked=true;}
 if(!clicked)await input.check({timeout:2500});
 const checked=await page.waitForFunction(({text,question})=>{
  const norm=s=>String(s||'').replace(/\s+/g,' ').replace(/\s*\*/g,'').trim();
  const d=document.querySelector('[data-lilly-application="true"]')||[...document.querySelectorAll('dialog,[role=dialog]')].find(d=>d.getClientRects().length&&norm(d.innerText).includes(norm(question)));
  if(!d)return false;
  return [...d.querySelectorAll('input[type=radio],input[type=checkbox]')].some(n=>{
   const role=n.closest('[role=radio],[role=checkbox]');
   if(!(n.checked||role?.getAttribute('aria-checked')==='true'))return false;
   let choice='';
   for(let a=n.parentElement;a&&a!==d;a=a.parentElement){
    const peers=[...a.querySelectorAll('input')].filter(x=>x.type===n.type&&(n.type==='checkbox'||x.name===n.name));
    if(peers.length>1)break;
    const value=norm(a.innerText);if(value&&!choice)choice=value;
   }
   if(choice!==norm(text))return false;
   for(let a=n.parentElement;a&&a!==d;a=a.parentElement){
    const peers=[...a.querySelectorAll('input')].filter(x=>x.type===n.type&&(n.type==='checkbox'||x.name===n.name));
    if(peers.length>1&&norm(a.innerText).includes(norm(question)))return true;
   }
   return false;
  });
 },{text:meta.text,question},{timeout:3000}).then(()=>true).catch(()=>false);
 if(!checked){meta.after=await page.evaluate(id=>{const n=document.getElementById(id);return n?{checked:n.checked,role:n.closest('[role=radio],[role=checkbox]')?.outerHTML?.slice(0,2000)}:null;},meta.id);const error=Error('Approved visible '+meta.text+' choice did not select its control');error.nativeChoice=meta;throw error;}
}
