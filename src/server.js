import express from 'express';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import fs from 'node:fs';
import { mountAuthBrowser } from './auth-browser.js';
import { checkAnswerConnector, smsJobSummary, smsRecordAnswer } from './google-answers.js';
import { startQuestionAlerts } from './question-alerts.js';
import { startAutoTriage } from './auto-triage.js';
import { handleSmsCommand } from './sms-operations.js';
import {archivePosting} from './posting-archive.js';
import {driveOAuth} from './drive-oauth.js';

const app = express();
app.get('/integrations/google-drive/callback', driveOAuth.callback);
const port = Number(process.env.PORT || 3000);
const testMode = process.env.TEST_MODE !== 'false';
const profilePath = process.env.BROWSER_PROFILE_PATH || '/data/browser-profile';

let browserContext = null;
let browserReady = false;
let browserError = null;

app.post('/internal/sms-command', express.json({limit:'2kb'}), async(req,res)=>{
 const secret=process.env.JOB_ALERT_SHARED_SECRET||'';
 const supplied=String(req.get('authorization')||'').replace(/^Bearer /i,'');
 const a=Buffer.from(secret),b=Buffer.from(supplied);
 if(!secret||a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.sendStatus(403);
 const message=String(req.body?.message||'').trim().slice(0,700);
 try{
  const reply=await handleSmsCommand(message,req.body?.requestId,browserContext);
  return res.json({reply});
 }catch(e){console.error('[sms-command]',String(e.message).slice(0,100));return res.status(503).json({reply:'Lilly Jobs is temporarily unable to access the application tracker.'})}
});
app.post('/internal/archive-test',express.json({limit:'1kb'}),async(req,res)=>{
 const secret=process.env.JOB_ALERT_SHARED_SECRET||'',provided=String(req.get('authorization')||'').replace(/^Bearer /i,'');
 const a=Buffer.from(secret),b=Buffer.from(provided);
 if(!secret||a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.sendStatus(403);
 if(!browserContext)return res.status(503).json({ok:false,reason:'browser_not_ready'});
 const id=String(req.body?.jobId||'');
 if(!/^[0-9]{8,12}$/.test(id))return res.sendStatus(400);
 const page=await browserContext.newPage();
 try{
  await page.goto('https://www.linkedin.com/jobs/view/'+id+'/',{waitUntil:'domcontentloaded',timeout:25000});
  const result=await archivePosting(page,{id,url:page.url(),company:'LinkedIn',title:'Posting'});
  res.status(result.ok?200:502).json(result);
 }catch(e){res.status(502).json({ok:false,reason:String(e.message).slice(0,120)})}
 finally{await page.close().catch(()=>{})}
});
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    release: '2026-10-08-drive-oauth-v1',
    service: 'lilly-job-application-worker',
    testMode,
    browserReady,
    timestamp: new Date().toISOString()
  });
});

app.get('/ready', (_req, res) => {
  const body = {
    ready: browserReady,
    testMode,
    profilePath,
    browserError
  };
  res.status(browserReady ? 200 : 503).json(body);
});

app.get('/integrations/google-answers/status', async (_req,res) => {res.status(404).json({error:'Use authenticated browser interface for connector diagnostics'});});

app.get('/', (_req, res) => {
  res.status(200).json({
    service: 'Lilly Job Application Worker',
    mode: testMode ? 'TEST' : 'LIVE',
    endpoints: ['/health', '/ready']
  });
});

async function initializeBrowser() {
  try {
    fs.mkdirSync(profilePath, { recursive: true });
    browserContext = await chromium.launchPersistentContext(profilePath, {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    browserReady = true;
    browserError = null;
    console.log(`[browser] Chromium ready; profile=${profilePath}; testMode=${testMode}`);
    if(process.env.ARCHIVE_CAPTURE_VERIFY_VERSION==='fulltext-v1'){
      const record='/data/archive-fulltext-v1-result.json';
      if(!fs.existsSync(record))void (async()=>{
        let p,result;
        try{
          p=await browserContext.newPage();
          const job={id:'4470079202',url:'https://www.linkedin.com/jobs/view/4470079202/',company:'Lyra Health',title:'Director Operations - Provider Performance'};
          await p.goto(job.url,{waitUntil:'domcontentloaded',timeout:25000});
          result=await archivePosting(p,job);
        }catch(e){result={ok:false,reason:String(e.message).slice(0,120)}}
        finally{
          if(p)await p.close().catch(()=>{});
          fs.writeFileSync(record,JSON.stringify({...result,checkedAt:new Date().toISOString()}),{mode:0o600});
          console.log('[archive-fulltext-test] '+JSON.stringify(result));
        }
      })();
    }
    if(process.env.SMS_REPAIR_PILOT_VERSION==='v8'){
      const reply=await handleSmsCommand('JOB SEARCH VP of Operations','repair-v8-vp-search',browserContext);
      console.log('[sms-pilot] '+reply);
    }
  } catch (error) {
    browserReady = false;
    browserError = error instanceof Error ? error.message : String(error);
    console.error('[browser] Chromium initialization failed:', browserError);
  }
}

mountAuthBrowser(app, () => browserContext, checkAnswerConnector);

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[server] listening on ${port}`);
  void initializeBrowser();
  startQuestionAlerts();
  startAutoTriage(() => browserContext);

});

async function shutdown(signal) {
  console.log(`[shutdown] ${signal}`);
  try {
    if (browserContext) await browserContext.close();
  } finally {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));



