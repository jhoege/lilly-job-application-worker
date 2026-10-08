import crypto from 'node:crypto';
import {driveOAuth} from './drive-oauth.js';
import {drivePickerPage} from './drive-picker.js';
import { startTriage,getTriageStatus,cancelTriage } from './queue-triage.js';
import { pendingQuestionCount,readSubmittedJobIds } from './google-answers.js';
import { batchInspect, inspectForm, salaryRequest } from './application-support.js';
import express from 'express';
import {archivePosting} from './posting-archive.js';
import { loadCandidateQueue, inspectCandidate } from './job-inspector.js';

const SESSION_MS = 20 * 60 * 1000;
const sessions = new Map();
const attempts = new Map();
const cookieName = 'lilly_auth_session';
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lilly secure browser login</title><style>body{font:16px system-ui;max-width:1100px;margin:24px auto;padding:0 16px;background:#101521;color:#fff}button,input{padding:10px;margin:4px;border-radius:6px}button{cursor:pointer}#screen{max-width:100%;border:1px solid #667;cursor:crosshair}input{max-width:95%}p{color:#bbc}#secret{width:360px}</style></head><body><h2>Lilly — supervised LinkedIn sign-in</h2><p>Only use this page over HTTPS. Never share the access key. This session expires after 20 minutes. Passwords and codes are sent directly to your own Railway worker and are not saved by this interface.</p><section id="login"><input id="secret" type="password" autocomplete="off" placeholder="Temporary access key"><button id="unlock">Unlock</button></section><section id="controls" hidden><p id="status">Connected</p><button id="open">Open LinkedIn</button><button id="jobs">Find remote operations jobs</button><select id="role"><option>Director of Operations</option><option>Director of Quality</option><option>Director of Process Improvement</option><option>Director of Operational Excellence</option><option>Director of Continuous Improvement</option><option>Vice President of Operations</option></select><input id="joburl" placeholder="Paste LinkedIn job URL"><button id="gotojob">Open job URL</button><button id="down">Scroll down</button><p><strong>Candidate queue (inspection only)</strong></p><select id="candidate"></select><button id="inspect">Inspect selected job</button><button id="batch">Inspect next 5 jobs</button><button id="triage">Triage 5 Easy Apply forms and log questions</button><button id="stoptriage" hidden>Stop triage safely</button><p id="triageprogress" aria-live="polite"></p><button id="driveconnect">Connect Google Drive archive</button><button id="drivestatus">Check archive storage</button><button id="drivefolder">Authorize archive folder</button><p id="drivemessage" aria-live="polite"></p><button id="googlecheck">Test Google answer connection</button><button id="pendingcheck">Check unanswered questions</button><button id="formcheck">Inspect open application questions</button><pre id="inspection" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto"></pre><button id="up">Scroll up</button><button id="refresh">Refresh screen</button><button id="pressEnter">Press Enter</button><button id="close">End access</button><p>Click the screenshot to focus a field. Type into the box below and press “Type into focused field.”</p><input id="typing" type="password" autocomplete="off" placeholder="Type text / password / verification code"><button id="type">Type into focused field</button><button id="replace">Replace field text</button><button id="clear">Clear selected field</button><label><input id="plain" type="checkbox">Show typing</label><p><img id="screen" alt="Remote Chromium browser screenshot"></p></section><script>
const $=id=>document.getElementById(id);
async function api(path,data){const r=await fetch('/auth-browser'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})});const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||body.reason||'Request failed ('+r.status+')');return body}
async function loadQueue(){const r=await fetch('/auth-browser/queue',{credentials:'same-origin'});if(!r.ok)throw Error('Queue unavailable');const j=await r.json();$('candidate').replaceChildren();for(const item of j.jobs){const o=document.createElement('option');o.value=item.id;o.textContent=item.id;$('candidate').append(o)}}
async function snapshot(){const r=await fetch('/auth-browser/screenshot',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('Screenshot failed');$('screen').src=URL.createObjectURL(await r.blob())}
async function run(fn){try{await fn();$('status').textContent='Connected';await snapshot()}catch(e){$('status').textContent=e.message}}
$('unlock').onclick=async()=>{try{await api('/unlock',{key:$('secret').value});$('secret').value='';$('login').hidden=true;$('controls').hidden=false;await snapshot();await loadQueue();await refreshTriageStatus()}catch(e){alert('Access denied')}}
async function restoreSession(){try{const r=await fetch('/auth-browser/session',{credentials:'same-origin',cache:'no-store'});if(!r.ok)return;$('login').hidden=true;$('controls').hidden=false;await run(async()=>{await loadQueue();await refreshTriageStatus()})}catch{}}
void restoreSession();
$('open').onclick=()=>run(()=>api('/open'));
$('refresh').onclick=()=>run(async()=>{});
$('jobs').onclick=()=>run(()=>api('/jobs',{role:$('role').value}));
$('gotojob').onclick=()=>run(()=>api('/navigate',{url:$('joburl').value}));
$('inspect').onclick=()=>run(async()=>{const j=await api('/inspect',{id:$('candidate').value});$('inspection').textContent=JSON.stringify(j,null,2)});
$('pendingcheck').onclick=()=>run(async()=>{const j=await api('/pendingcheck');$('inspection').textContent=JSON.stringify(j,null,2)});
$('driveconnect').onclick=async()=>{try{const j=await api('/drive/start');location.assign(j.authorizationUrl)}catch(e){$('drivemessage').textContent=e.message}};
$('drivefolder').onclick=()=>{location.assign('/auth-browser/drive/folder')};
$('drivestatus').onclick=async()=>{try{const j=await api('/drive/status');$('drivemessage').textContent=j.archiveReady?'Archive storage is ready':(j.reason||j.error||'Archive folder authorization is still needed')}catch(e){$('drivemessage').textContent=e.message}};
const archiveTest=document.createElement('button');archiveTest.textContent='Test posting PDF upload';$('drivestatus').after(archiveTest);
archiveTest.onclick=async()=>{archiveTest.disabled=true;$('drivemessage').textContent='Testing PDF capture and Drive upload; no application will be submitted.';try{const j=await api('/drive/archive-test');$('drivemessage').textContent=j.ok?'Posting PDF uploaded and tracker updated.':('Archive test failed: '+j.reason);if(j.ok&&j.url){const link=document.createElement('a');link.href=j.url;link.textContent=' Open test PDF';link.target='_blank';link.rel='noopener';$('drivemessage').append(link)}}catch(e){$('drivemessage').textContent=e.message}finally{archiveTest.disabled=false}};
const driveResult=new URLSearchParams(location.search).get('drive'); if(driveResult){$('drivemessage').textContent=driveResult==='connected'?'Google authorization saved. Unlock and check archive storage.':'Google connection was not completed; unlock and try again';history.replaceState(null,'','/auth-browser')};
$('googlecheck').onclick=()=>run(async()=>{const j=await api('/googlecheck');$('inspection').textContent=JSON.stringify(j,null,2)});
async function refreshTriageStatus(){
 try{
  const r=await fetch('/auth-browser/triage/status',{credentials:'same-origin'});
  if(!r.ok)return;
  const j=await r.json();
  $('triage').disabled=!!j.running;
  $('stoptriage').hidden=!j.running;
  const stage=String(j.stage||'idle').replaceAll('_',' ');
  const elapsed=j.stageSince?Math.max(0,Math.floor((Date.now()-Date.parse(j.stageSince))/1000)):0;
  const last=(j.results||[]).slice(-1)[0];
  $('triageprogress').textContent=j.running
   ? 'Working: '+j.processed+'/'+j.total+' processed; current job '+(j.currentJob||'starting')+'; stage: '+stage+' ('+elapsed+'s)'+(elapsed>120?' — stage may be stuck; you can stop safely':'')
   : 'Triage '+stage+(last?' — last job '+last.jobId+': '+last.status:'');
  if(j.running&&j.results?.length){$('inspection').textContent=JSON.stringify({liveResults:j.results},null,2)}
  if(j.lastResult&&JSON.stringify(j.lastResult)!==$('inspection').dataset.lastResult){
   $('inspection').textContent=JSON.stringify(j.lastResult,null,2);
   $('inspection').dataset.lastResult=JSON.stringify(j.lastResult);
  }
 }catch{}
}
$('triage').onclick=()=>run(async()=>{const j=await api('/triage',{limit:5});$('inspection').textContent=JSON.stringify(j,null,2);await refreshTriageStatus()});
$('stoptriage').onclick=()=>run(async()=>{await api('/triage/cancel');await refreshTriageStatus()});
setInterval(()=>{if(!$('controls').hidden)void refreshTriageStatus()},4000);
$('batch').onclick=()=>run(async()=>{const j=await api('/batch',{limit:5});$('inspection').textContent=JSON.stringify(j,null,2)});
$('formcheck').onclick=()=>run(async()=>{const j=await api('/formcheck');$('inspection').textContent=JSON.stringify(j,null,2)});
$('down').onclick=()=>run(()=>api('/scroll',{delta:600}));
$('up').onclick=()=>run(()=>api('/scroll',{delta:-600}));
$('pressEnter').onclick=()=>run(()=>api('/key',{key:'Enter'}));
$('type').onclick=()=>run(async()=>{await api('/type',{text:$('typing').value});$('typing').value=''});
$('replace').onclick=()=>run(async()=>{await api('/replace',{text:$('typing').value});$('typing').value=''});
$('clear').onclick=()=>run(()=>api('/replace',{text:''}));
$('plain').onchange=()=>{$('typing').type=$('plain').checked?'text':'password'};
$('screen').onclick=e=>run(()=>{const rect=e.target.getBoundingClientRect();return api('/click',{x:Math.round((e.clientX-rect.left)*e.target.naturalWidth/rect.width),y:Math.round((e.clientY-rect.top)*e.target.naturalHeight/rect.height)})});
$('close').onclick=async()=>{await api('/close');location.reload()};
</script></body></html>`;

export function mountAuthBrowser(app, getContext, checkAnswerConnector) {
  const key = process.env.BROWSER_ACCESS_KEY;
  if (!key || Buffer.byteLength(key) < 32) {
    console.log('[auth-browser] disabled: BROWSER_ACCESS_KEY must be at least 32 bytes');
    return;
  }
  const router = express.Router();
  router.use(express.json({limit:'8kb'}));
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    res.set('X-Content-Type-Options','nosniff');
    res.set('Referrer-Policy','no-referrer');
    res.set('Content-Security-Policy',"default-src 'none'; img-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    if(req.method==='POST'){
      const origin=req.get('origin');
      if(!origin || origin!==('https://'+req.get('host'))) return res.sendStatus(403);
    }
    next();
  });
  function authorized(req,res,next){
    const sid=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.split('=')[1];
    const expiry=sid&&sessions.get(sid);
    if(!expiry || expiry<Date.now()){if(sid)sessions.delete(sid);return res.sendStatus(401)}
    next();
  }
  function page(){const context=getContext();if(!context)throw Error('Browser not ready');return context.pages()[0]||context.newPage()}
  router.get('/',(_req,res)=>res.type('html').send(html));
  router.get('/session',authorized,(_req,res)=>res.json({authenticated:true}));
  router.post('/unlock',(req,res)=>{
    const ip=req.ip||'unknown', state=attempts.get(ip)||{count:0,until:0};
    if(state.until>Date.now())return res.sendStatus(429);
    const supplied=Buffer.from(String(req.body.key||''));
    const expected=Buffer.from(key);
    const valid=supplied.length===expected.length&&crypto.timingSafeEqual(supplied,expected);
    if(!valid){state.count++;if(state.count>=5){state.count=0;state.until=Date.now()+15*60*1000}attempts.set(ip,state);return res.sendStatus(401)}
    attempts.delete(ip);
    const sid=crypto.randomBytes(32).toString('hex');
    sessions.set(sid,Date.now()+SESSION_MS);
    res.cookie(cookieName,sid,{httpOnly:true,secure:true,sameSite:'strict',maxAge:SESSION_MS,path:'/auth-browser'});
    res.json({ok:true});
  });
  router.post('/drive/start',authorized,driveOAuth.start);
  router.post('/drive/status',authorized,driveOAuth.status);
  router.get('/drive/folder',authorized,drivePickerPage);
  router.post('/drive/picker-config',authorized,driveOAuth.pickerConfig);
  router.post('/drive/confirm-folder',authorized,driveOAuth.confirmFolder);
  router.post('/drive/archive-test',authorized,async(_req,res)=>{
    const context=getContext();
    if(!context)return res.status(503).json({ok:false,reason:'Browser unavailable'});
    let p;
    try{
      p=await context.newPage();
      const job={id:'4470079202',url:'https://www.linkedin.com/jobs/view/4470079202/',company:'Lyra Health',title:'Director Operations - Provider Performance'};
      await p.goto(job.url,{waitUntil:'domcontentloaded',timeout:25000});
      if(/\/login|\/checkpoint|\/authwall/.test(p.url()))return res.status(422).json({ok:false,reason:'LinkedIn sign-in or verification required'});
      await p.locator('main').first().waitFor({state:'visible',timeout:8000});
      const text=await p.locator('main').innerText({timeout:4000});
      if(!/Lyra/i.test(text)||text.length<1000)return res.status(422).json({ok:false,reason:'Full posting could not be verified; refusing to archive an unrelated page'});
      const result=await archivePosting(p,job);
      res.status(result.ok?200:502).json(result);
    }catch(e){res.status(502).json({ok:false,reason:String(e.message).slice(0,120)})}
    finally{if(p)await p.close().catch(()=>{})}
  });
  router.get('/screenshot',authorized,async(_req,res)=>{
    try{const p=await page();res.type('png').send(await p.screenshot({timeout:10000}))}catch{res.sendStatus(503)}
  });
  router.post('/open',authorized,async(_req,res)=>{try{const p=await page();await p.goto('https://www.linkedin.com/login',{waitUntil:'domcontentloaded',timeout:20000});res.json({ok:true})}catch{res.sendStatus(503)}});
  router.get('/queue',authorized,async(_req,res)=>{try{const submitted=await readSubmittedJobIds();res.json({jobs:loadCandidateQueue().filter(j=>!submitted.has(j.id))})}catch(e){res.status(503).json({error:'Application ledger unavailable; refusing to expose unverified queue'})}});
  router.post('/inspect',authorized,async(req,res)=>{try{const submitted=await readSubmittedJobIds();if(submitted.has(String(req.body.id)))return res.status(409).json({error:'Already applied and logged; inspection blocked'});const result=await inspectCandidate(getContext(),req.body.id);res.json(result)}catch(e){res.status(422).json({error:'Job inspection failed; check LinkedIn session and job availability'})}});
  router.post('/pendingcheck',authorized,async(_req,res)=>{
   try{
    const count=await pendingQuestionCount();
    let sms={ready:false,missing:['gateway configuration']};
    if(process.env.JOB_SMS_GATEWAY_URL&&process.env.JOB_ALERT_SHARED_SECRET){
     try{
      const url=new URL('/internal/job-alert-status',process.env.JOB_SMS_GATEWAY_URL);
      const r=await fetch(url,{headers:{Authorization:'Bearer '+process.env.JOB_ALERT_SHARED_SECRET},signal:AbortSignal.timeout(8000)});
      sms=r.ok?await r.json():{ready:false,missing:['gateway unavailable: HTTP '+r.status]};
     }catch{sms={ready:false,missing:['gateway connection failed']}}
    }
    res.json({pendingQuestions:count,smsReady:!!sms.ready,smsMissing:sms.missing||[],autoTriageEnabled:process.env.AUTO_TRIAGE_ENABLED==='true',autoSubmissionEnabled:process.env.AUTO_SUBMIT_ENABLED==='true'&&process.env.TEST_MODE==='false',testMode:process.env.TEST_MODE!=='false'});
   }catch(e){res.status(503).json({error:String(e.message).slice(0,140)})}
  });
  router.post('/googlecheck',authorized,async(_req,res)=>{try{res.json(await checkAnswerConnector())}catch(e){res.status(503).json({connected:false,error:String(e.message).slice(0,140)})}});
  router.post('/triage',authorized,(req,res)=>{try{res.json(startTriage(getContext(),{limit:req.body.limit}))}catch(e){res.status(503).json({error:String(e.message).slice(0,140)})}});
  router.get('/triage/status',authorized,(_req,res)=>res.json(getTriageStatus()));
  router.post('/triage/cancel',authorized,async(_req,res)=>{res.json(await cancelTriage())});
  router.post('/batch',authorized,async(req,res)=>{try{res.json(await batchInspect(getContext(),{limit:req.body.limit}))}catch{res.sendStatus(503)}});
  router.post('/formcheck',authorized,async(_req,res)=>{try{res.json(await inspectForm(getContext()))}catch{res.sendStatus(503)}});
  router.post('/salary',authorized,(req,res)=>{res.json(salaryRequest(req.body))});
  router.post('/jobs',authorized,async(req,res)=>{try{const roles=['Director of Operations','Director of Quality','Director of Process Improvement','Director of Operational Excellence','Director of Continuous Improvement','Vice President of Operations'];const role=roles.includes(req.body.role)?req.body.role:roles[0];const p=await page();const u=new URL('https://www.linkedin.com/jobs/search/');u.searchParams.set('keywords',role);u.searchParams.set('f_WT','2');u.searchParams.set('f_AL','true');u.searchParams.set('location','United States');await p.goto(u.toString(),{waitUntil:'domcontentloaded',timeout:25000});res.json({ok:true})}catch{res.sendStatus(503)}});
  router.post('/navigate',authorized,async(req,res)=>{try{const u=new URL(String(req.body.url||''));if(u.protocol!=='https:'||!['www.linkedin.com','linkedin.com'].includes(u.hostname)||!(u.pathname.startsWith('/jobs/view/')||u.pathname.startsWith('/jobs/search/')))return res.sendStatus(400);const p=await page();await p.goto(u.toString(),{waitUntil:'domcontentloaded',timeout:25000});res.json({ok:true})}catch{res.sendStatus(503)}});
  router.post('/scroll',authorized,async(req,res)=>{const delta=Number(req.body.delta);if(delta!==600&&delta!==-600)return res.sendStatus(400);try{const p=await page();const outcome=await p.evaluate((amount)=>{const dialog=document.querySelector('[role="dialog"]');if(!dialog)return {scrolled:false,reason:'no_dialog'};const nodes=[dialog,...dialog.querySelectorAll('*')];const scrollable=nodes.filter(el=>{const st=getComputedStyle(el);return el.scrollHeight>el.clientHeight+12&&/(auto|scroll)/.test(st.overflowY)}).sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight));const target=scrollable[0];if(!target)return {scrolled:false,reason:'no_scrollable_dialog_area'};const before=target.scrollTop;target.scrollBy({top:amount,behavior:'instant'});return {scrolled:true,before,after:target.scrollTop};},delta);if(!outcome.scrolled)await p.mouse.wheel(0,delta);res.json({ok:true,...outcome})}catch{res.sendStatus(503)}});
  router.post('/click',authorized,async(req,res)=>{try{const x=Number(req.body.x),y=Number(req.body.y);if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>1920||y>1200)return res.sendStatus(400);const p=await page();await p.mouse.click(x,y);res.json({ok:true})}catch{res.sendStatus(503)}});
  router.post('/type',authorized,async(req,res)=>{try{const value=req.body.text;if(typeof value!=='string'||value.length>2000)return res.sendStatus(400);const p=await page();await p.keyboard.insertText(value);res.json({ok:true})}catch{res.sendStatus(503)}});
  router.post('/replace',authorized,async(req,res)=>{try{const value=req.body.text;if(typeof value!=='string'||value.length>2000)return res.sendStatus(400);const p=await page();await p.keyboard.press('ControlOrMeta+A');if(value)await p.keyboard.insertText(value);else await p.keyboard.press('Backspace');res.json({ok:true})}catch{res.sendStatus(503)}});
  router.post('/key',authorized,async(req,res)=>{if(req.body.key!=='Enter')return res.sendStatus(400);try{const p=await page();await p.keyboard.press('Enter');res.json({ok:true})}catch{res.sendStatus(503)}});
  router.post('/close',authorized,(req,res)=>{const sid=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.split('=')[1];if(sid)sessions.delete(sid);res.clearCookie(cookieName,{path:'/auth-browser'});res.json({ok:true})});
  app.use('/auth-browser',router);
}


