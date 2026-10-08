import {getQueue,salaryRequest} from './application-support.js';
import {readApprovedAnswers,appendUnknownQuestions,readSubmittedJobIds,logVerifiedLinkedInApplication,upsertApplicationStatus} from './google-answers.js';
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
 if(/(desired|expected|salary expectation|compensation expectation)/.test(n)&&/(salary|compensation|pay)/.test(n)){
  return advertisedSalary==null?undefined:String(advertisedSalary);
 }
 if(/(years|how long)/.test(n)&&/(management|managing people)/.test(n))key='management years';
 else if(/(years|how long)/.test(n)&&/(marina|real estate)/.test(n))key='marina or real estate experience years';
 else if(/legally authorized|eligible to work|work authorization/.test(n))key='authorized to work in us';
 else if(/(visa|immigration|employment).*sponsor|sponsor.*(visa|employment)/.test(n))key='require visa sponsorship now or later';
 else if(/security clearance/.test(n))key='security clearance held';
 else if(/willing to relocate/.test(n))key='willing to relocate';
 else if(/phone number|mobile phone/.test(n))key='mobile';
 return approved.find(a=>normalize(a.question)===key)?.answer;
}
function advertisedSalaryFromText(text){
 // Only infer a target from a clearly stated annual salary range.
 const match=String(text||'').match(/\$\s*([\d,.]+)\s*(k)?\s*(?:\/\s*yr|per year|annually)?\s*[-–]\s*\$\s*([\d,.]+)\s*(k)?\s*(?:\/\s*yr|per year|annually)?/i);
 if(!match)return null;
 const min=Number(match[1].replace(/,/g,''))*(match[2]?1000:1);
 const max=Number(match[3].replace(/,/g,''))*(match[4]?1000:1);
 if(min<40000||max>2000000||max<min)return null;
 return salaryRequest({min,max}).amount;
}
async function fieldsOnPage(page){
 return page.evaluate(()=>{
  const dialog=document.querySelector('[role="dialog"], .jobs-easy-apply-modal, .artdeco-modal');
  if(!dialog)return null;
  const fields=[...dialog.querySelectorAll('input,textarea,select')].filter(el=>{
   const style=window.getComputedStyle(el);
   return el.type!=='hidden'&&style.visibility!=='hidden'&&style.display!=='none'&&el.getClientRects().length>0;
  });
  const normalizeText=s=>String(s||'').replace(/\s+/g,' ').replace(/\s*\*\s*$/,'').trim();
  return fields.map((el,index)=>{
   const fieldset=el.closest('fieldset');
   const wrapper=el.closest('.fb-dash-form-element, .jobs-easy-apply-form-element, .artdeco-text-input, .fb-dash-form-element-group');
   const label=normalizeText(
    (el.type==='radio'||el.type==='checkbox'?fieldset?.querySelector('legend')?.innerText:null)||
    el.getAttribute('aria-label')||
    el.labels?.[0]?.innerText||
    (el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.innerText).filter(Boolean).join(' ')||
    fieldset?.querySelector('legend')?.innerText||
    wrapper?.querySelector('label, .fb-dash-form-element__label')?.innerText||
    el.getAttribute('placeholder')
   );
   const required=el.required||el.getAttribute('aria-required')==='true'||
    !!wrapper?.querySelector('label .visually-hidden, .fb-dash-form-element__label .visually-hidden')||
    /[*]\s*$/.test(el.labels?.[0]?.innerText||'');
   const filled=el.type==='radio'
    ? !![...dialog.querySelectorAll('input[type="radio"]')].find(other=>other.name===el.name&&other.checked)
    : el.type==='checkbox' ? el.checked
    : el.tagName==='SELECT' ? !!el.value&&!/^(select|choose|please select)$/i.test(el.selectedOptions?.[0]?.textContent?.trim()||'')
    : el.type==='file' ? !!el.files?.length
    : !!String(el.value||'').trim();
   return {index,label:label.slice(0,350),type:el.type||el.tagName.toLowerCase(),required,filled,
    tag:el.tagName.toLowerCase(),name:String(el.name||'').slice(0,100)};
  });
 });
}
async function saveDraftIfSupported(page){
 const dialog=page.locator('[role="dialog"]').first();
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
   if(await confirmation.isVisible({timeout:1800}).catch(()=>false)){
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
 needs_answers:'Needs answers',ready_for_review:'Ready for review',
 needs_manual_review:'Needs review',submission_blocked:'Submission blocked',
 submission_unverified:'Submission unverified - Verify before retry',
 technical_failure:'Technical error',job_timeout:'Timed out',
 login_required:'Login required',closed:'Closed',
 external_application:'External application required',
 easy_apply_not_detected:'Easy Apply unavailable',
 form_unavailable:'Form unavailable',no_easy_apply:'Easy Apply unavailable',
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
  const [approved,submittedIds]=await Promise.all([readApprovedAnswers(),readSubmittedJobIds()]);
  const jobs=(Array.isArray(jobsOverride)?jobsOverride:getQueue()).filter(x=>!x.submitted&&x.status!=='closed_not_accepting_applications'&&(!Array.isArray(ids)||ids.includes(x.id))).slice(Math.max(0,Number(offset)||0),Math.max(0,Number(offset)||0)+Math.max(1,Math.min(10,Number(limit)||5)));
  progress.total=jobs.length;
  try{
   for(const job of jobs){
    if(cancelRequested)break;
    progress.currentJob=job.id;
    setStage('checking_submission_history');
    if(submittedIds.has(job.id)){const result={jobId:job.id,status:'skipped_already_logged',visited:false};results.push(result);recordResult(result);continue;}
    let stage='navigation';
    let page=null;
    let watchdog=null;
    let timedOut=false;
    try{
     page=await context.newPage();
     activePage=page;
     // Abort a single slow job without blocking the remaining queue.
     watchdog=setTimeout(()=>{timedOut=true;void page.close().catch(()=>{})},120000);
     setStage('opening_job');
     await page.goto(job.url,{waitUntil:'domcontentloaded',timeout:25000});
     await page.locator('h1').first().waitFor({state:'visible',timeout:9000}).catch(()=>{});
     await page.waitForTimeout(1200);
     setStage('checking_linkedin_application_status');
     const currentJobStatus=await page.locator('main').first().innerText({timeout:4000}).catch(()=>'');
     if(/application status[\s\S]{0,100}application submitted/i.test(currentJobStatus)){
      setStage('recording_verified_application');
      const logged=await logVerifiedLinkedInApplication(job);
      submittedIds.add(job.id);
      results.push({jobId:job.id,status:'already_applied_logged',logged:logged.added});continue;
     }
     const advertisedSalary=advertisedSalaryFromText(currentJobStatus)??(Number(job.salaryRequest)>=120000?Number(job.salaryRequest):120000);
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
     for(const selector of selectors){
      const candidate=page.locator(selector).first();
      if(await candidate.isVisible({timeout:2000}).catch(()=>false)){easy=candidate;break}
     }
     if(!easy){
      const login=await page.locator('input[name="session_key"], input#username').count();
      const text=(await page.locator('main').first().innerText({timeout:3000}).catch(()=>'' )).slice(0,1800);
      const status=login?'login_required':/no longer accepting applications/i.test(text)?'closed':/apply on company website|apply externally/i.test(text)?'external_application':'easy_apply_not_detected';
      const jobSaved=status==='closed'?{saved:false,reason:'Closed posting'}:await saveJobForLater(page,job.source);
      results.push({jobId:job.id,status,jobSaved:jobSaved.saved,saveNote:jobSaved.reason,diagnostic:'No visible Easy Apply control after page loaded'});continue;
     }
     setStage('opening_application');
     await easy.click({timeout:8000});
     await page.locator('[role="dialog"], .jobs-easy-apply-modal, .artdeco-modal').first().waitFor({state:'visible',timeout:8000}).catch(()=>{});
     // The modal shell often renders before the LinkedIn application questions.
     // Wait for real form controls instead of treating the loading shell as an empty application.
     setStage('waiting_for_application_fields');
     await page.waitForFunction(()=>{
      const d=document.querySelector('[role="dialog"], .jobs-easy-apply-modal, .artdeco-modal');
      return !!d&&(d.querySelectorAll('input:not([type="hidden"]),select,textarea').length>0||
        [...d.querySelectorAll('button')].some(b=>/next|review|submit application|continue/i.test(b.innerText||'')));
     },null,{timeout:9000}).catch(()=>{});
     stage='form';
     let steps=0,unknown=[],status='requires_review',diagnostic=null;
     for(let step=0;step<6;step++){
      setStage('reading_form_page_'+(step+1));
      const fields=await fieldsOnPage(page);
      if(!fields){status='form_unavailable';break}
      const missing=[];
      setStage('matching_approved_answers');
      for(const f of fields){
       // Trust pre-filled values from the user's prior applications; never overwrite them.
       if(!f.required||f.filled)continue;
       const answer=lookupAnswer(f.label,approved,advertisedSalary);
       // Only fill clearly labeled text-like fields. No guessed dropdown, radio, checkbox, file or identity answers.
       if(answer!==undefined&&f.label){
        const input=page.locator('[role="dialog"] input:not([type="hidden"]), [role="dialog"] textarea, [role="dialog"] select').filter({visible:true}).nth(f.index);
        try{
         if(['text','email','tel','number','textarea'].includes(f.type)){
          await input.fill(String(answer),{timeout:2500});
         }else if(f.type==='radio'){
          const wanted=String(answer).trim().toLowerCase();
          const group=page.locator('[role="dialog"] input[type="radio"]').filter({visible:true});
          const names=await group.evaluateAll(nodes=>nodes.map(n=>({name:n.name,value:n.value,label:n.labels?.[0]?.innerText||''})));
          const selected=names.findIndex(x=>x.name===f.name&&(normalize(x.value)===wanted||normalize(x.label)===wanted));
          if(selected<0)throw Error('No exact approved radio choice');
          await group.nth(selected).check({timeout:2500});
         }else if(f.tag==='select'){
          await input.selectOption({label:String(answer)},{timeout:2500});
         }else throw Error('Unsupported field type');
        }catch{missing.push(f)}
       }else missing.push(f);
      }
      if(missing.length){setStage('collecting_unanswered_questions');
       unknown=[...new Set(missing.map(x=>x.label||('Unlabeled required '+x.type+' field')))];
       diagnostic={page:step+1,visibleFields:fields.length,unfilledRequired:missing.length,reason:'required_answers_missing'};
       status='needs_answers';break;
      }
      const dialog=page.locator('[role="dialog"]');
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
        const validation=await page.evaluate(()=>{
         const dialog=document.querySelector('[role="dialog"], .jobs-easy-apply-modal, .artdeco-modal');
         if(!dialog)return {invalid:1,reason:'Application dialog missing'};
         const invalid=[...dialog.querySelectorAll('input,textarea,select')].filter(el=>el.getClientRects().length&&
          (el.getAttribute('aria-invalid')==='true'||(el.required&&!el.checkValidity())));
         return {invalid:invalid.length};
        });
        if(validation.invalid>0){status='submission_blocked';diagnostic={...diagnostic,reason:'Unresolved invalid required fields',invalidFields:validation.invalid};break}
        if(!await submit.isEnabled()) {status='submission_blocked';diagnostic={...diagnostic,reason:'Submit disabled'};break}
        setStage('submitting_completed_application');
        await submit.click({timeout:8000});
        const confirmation=page.getByText(/your application was sent to|application submitted successfully|application was submitted/i).first();
        if(await confirmation.isVisible({timeout:12000}).catch(()=>false)){
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
       await review.first().click({timeout:5000});steps++;continue;
      }
      if(await next.count()&&await next.first().isEnabled()){
       setStage('advancing_form_page');
       await next.first().click({timeout:5000});steps++;continue;
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
     // This triage never presses Submit. Closing this isolated page abandons the form.
    }catch(e){results.push({jobId:job.id,status:cancelRequested?'cancelled':timedOut?'job_timeout':'technical_failure',stage,reason:String(e.message).slice(0,120)})}
    finally{
     if(watchdog)clearTimeout(watchdog);
     activePage=null;
     if(page)await page.close().catch(()=>{});
     const last=results[results.length-1];
     const outcome=last?.jobId===job.id?last:{jobId:job.id,status:'unknown'};
     if(!submittedIds.has(job.id)&&!['skipped_already_logged','submitted_verified','already_applied_logged'].includes(outcome.status)){
      const label=displayStatus[outcome.status]||'Needs review';
      const display=(outcome.draftSaved||outcome.jobSaved)&&!['closed','submitted_verified','submission_unverified'].includes(outcome.status)?'Saved - '+label:label;
      const reason=[outcome.diagnostic?.reason||outcome.reason||outcome.diagnostic||'',outcome.draftNote||'',outcome.saveNote||''].filter(x=>typeof x==='string'&&x).join('; ').slice(0,450);
      try{await upsertApplicationStatus(job,display,reason,{source:job.source})}
      catch(e){outcome.ledgerError=String(e.message).slice(0,120);console.error('[application-ledger] job='+job.id+' '+outcome.ledgerError)}
     }
     recordResult(outcome);
     setStage('moving_to_next_job');
    }
   }
  }finally{activePage=null}
  return {mode:process.env.AUTO_SUBMIT_ENABLED==='true'&&process.env.TEST_MODE==='false'?'guarded_submission':'safe_multistep_triage',submitted:results.filter(x=>x.submitted).length,results};
 }finally{running=false;progress.running=false;progress.currentJob=null;setStage(cancelRequested?'cancelled':'finished')}
}
