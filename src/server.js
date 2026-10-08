import express from 'express';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import fs from 'node:fs';
import { mountAuthBrowser } from './auth-browser.js';
import { checkAnswerConnector, smsJobSummary, smsRecordAnswer } from './google-answers.js';
import { startQuestionAlerts } from './question-alerts.js';
import { startAutoTriage } from './auto-triage.js';
import { startOneTimeCalendarTest } from './calendar-test-once.js';

const app = express();
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
  const match=message.match(/^ANSWER\\s+(Q[A-Za-z0-9-]+)\\s+([\\s\\S]+)$/i);
  const reply=match?await smsRecordAnswer(match[1],match[2].trim()):await smsJobSummary(message);
  return res.json({reply});
 }catch(e){console.error('[sms-command]',String(e.message).slice(0,100));return res.status(503).json({reply:'Lilly Jobs is temporarily unable to access the application tracker.'})}
});
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
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
  startOneTimeCalendarTest();
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
