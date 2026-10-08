import crypto from 'node:crypto';
import express from 'express';
import { GoogleAuth } from 'google-auth-library';
import twilio from 'twilio';
import {parseCommand,isJobCommand} from './commands.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedPhone = process.env.ALLOWED_PHONE || '';
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN || '';
const spreadsheetId = process.env.LILLY_TASK_SPREADSHEET_ID || '';
const taskSheetTab = process.env.TASK_SHEET_TAB || 'Tasks';
const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';

app.use(express.urlencoded({ extended: false }));

function xmlEscape(value = '') {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function twiml(message) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(message)}</Message></Response>`;
}

function getPublicUrl(req) {
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (configured) return `${configured}${req.originalUrl}`;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}${req.originalUrl}`;
}

function validateTwilio(req) {
  if (!twilioAuthToken) return false;
  const signature = req.get('x-twilio-signature') || '';
  return twilio.validateRequest(twilioAuthToken, signature, getPublicUrl(req), req.body);
}

async function getSheetsToken() {
  if (!serviceAccountJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON missing');
  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });

  try {
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token?.token) throw new Error('Google returned no access token');
    return token.token;
  } catch (error) {
    const code = error?.code || error?.response?.status || 'unknown';
    const googleError = error?.response?.data?.error || error?.message || 'unknown_error';
    const description = error?.response?.data?.error_description || '';
    console.error(`[google-auth] code=${code} error=${String(googleError).slice(0,180)} description=${String(description).slice(0,220)}`);
    throw new Error('Google authentication failed');
  }
}

function parseDate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]));
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function todayChicago() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: 'numeric', day: 'numeric'
  }).formatToParts(new Date());
  const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return new Date(Number(obj.year), Number(obj.month) - 1, Number(obj.day));
}

async function fetchTasks() {
  if (!spreadsheetId) throw new Error('LILLY_TASK_SPREADSHEET_ID missing');
  const token = await getSheetsToken();
  const range = encodeURIComponent(`${taskSheetTab}!A1:X1000`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const text = await response.text();
    console.error(`[google-sheets] status=${response.status} body=${text.slice(0,300)}`);
    throw new Error('Google Sheets read failed');
  }
  const data = await response.json();
  const rows = data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => String(h).trim());
  return rows.slice(1).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
}

function activeTasks(tasks) {
  return tasks.filter(t => {
    const s = String(t.Status || '').toLowerCase();
    return s && !['completed', 'dismissed', 'deferred'].includes(s);
  });
}

function summarizeTasks(tasks, mode) {
  const today = todayChicago();
  let filtered = activeTasks(tasks);
  if (mode === 'past-due') {
    filtered = filtered.filter(t => {
      const d = parseDate(t['Due Date']);
      return d && d < today;
    });
  } else if (mode === 'due-today') {
    filtered = filtered.filter(t => {
      const d = parseDate(t['Due Date']);
      return d && d.getTime() === today.getTime();
    });
  }

  filtered.sort((a, b) => {
    const pa = Number(a['Priority Score'] || 999);
    const pb = Number(b['Priority Score'] || 999);
    return pa - pb;
  });

  if (!filtered.length) {
    if (mode === 'past-due') return 'No open past-due tasks.';
    if (mode === 'due-today') return 'No open tasks are due today.';
    return 'No open tasks found.';
  }

  const top = filtered.slice(0, 5).map(t => {
    const name = t['Task / Commitment'] || 'Untitled task';
    const status = t.Status && t.Status !== 'Open' ? ` (${t.Status})` : '';
    const due = t['Due Date'] ? ` [${t['Due Date']}]` : '';
    return `• ${name}${status}${due}`;
  });
  const more = filtered.length > 5 ? ` +${filtered.length - 5} more.` : '';
  return `${top.join(' ')}${more}`.slice(0, 1500);
}

async function jobsCommand(message,requestId){
 const endpoint=process.env.JOB_WORKER_URL,secret=process.env.JOB_ALERT_SHARED_SECRET;
 if(!endpoint||!secret)return 'Jobs connector is not configured. Contact Lilly administrator.';
 const url=new URL('/internal/sms-command',endpoint);
 if(url.protocol!=='https:')throw Error('Jobs endpoint must be HTTPS');
 const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({message,requestId}),signal:AbortSignal.timeout(10000)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error('Jobs connector HTTP '+response.status);
 return String(data.reply||'Jobs connector returned no response').slice(0,1400);
}

async function routeMessage(body,requestId) {
  const cmd=parseCommand(body);
  if(isJobCommand(cmd))return jobsCommand(String(body||''),requestId);
  if(cmd.kind==='help')return 'Commands: JOB SEARCH <role>, JOBS RETRY, JOBS STATUS, JOBS DETAILS, JOBS QUESTIONS, ANSWER <ID> <answer>, TASKS, PAST DUE, DUE TODAY, STATUS. Natural job search requests are supported. Calendar/email/briefing require a live assistant bridge.';
  if(cmd.kind==='status')return 'Lilly SMS is online. Jobs worker '+(process.env.JOB_WORKER_URL&&process.env.JOB_ALERT_SHARED_SECRET?'configured':'not configured')+'. Calendar/email bridge '+(process.env.PERSONAL_ASSISTANT_URL&&process.env.PERSONAL_ASSISTANT_SECRET?'configured':'not connected')+'. JOBS STATUS checks processing.';
  if(cmd.kind==='hello'||cmd.kind==='hi')return 'Hello. Text HELP for available commands.';
  if(cmd.kind==='past_due')return summarizeTasks(await fetchTasks(),'past-due');
  if(cmd.kind==='due_today')return summarizeTasks(await fetchTasks(),'due-today');
  if(cmd.kind==='tasks')return summarizeTasks(await fetchTasks(),'all');
  if(['calendar','email','briefing'].includes(cmd.kind)) {
   const endpoint=process.env.PERSONAL_ASSISTANT_URL,secret=process.env.PERSONAL_ASSISTANT_SECRET;
   if(!endpoint||!secret)return 'Lilly '+cmd.kind+': SMS access to your connected accounts is not available yet. The calendar test was a fixed test message, not a live calendar read. No account changes made.';
   const url=new URL('/internal/sms-command',endpoint);
   if(url.protocol!=='https:')throw Error('Assistant bridge requires HTTPS');
   const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({message:String(body||''),requestId}),signal:AbortSignal.timeout(10000)});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error('Assistant bridge unavailable');
   return String(data.reply||'Assistant bridge returned no result').slice(0,1500);
  }
  if(cmd.kind==='bills')return 'Bills data is not connected to SMS. No changes made.';
  return 'Command not recognized. Text HELP, or JOB SEARCH VP of Operations.';
}

// Authenticated readiness check: reports missing configuration names, never secret values.
app.get('/internal/job-alert-status',(req,res)=>{
 const secret=process.env.JOB_ALERT_SHARED_SECRET||'';
 const supplied=String(req.get('authorization')||'').replace(/^Bearer /i,'');
 if(!secret||!requireSafeEqual(supplied,secret))return res.sendStatus(403);
 const required=['TWILIO_ACCOUNT_SID','TWILIO_FROM_PHONE','TWILIO_AUTH_TOKEN','ALLOWED_PHONE'];
 const missing=required.filter(name=>!process.env[name]);
 res.json({ready:missing.length===0,missing});
});

// Worker results go only to the configured, authorized owner; never a caller-supplied recipient.
const deliveredResults=new Map();
app.post('/internal/job-result',express.json({limit:'8kb'}),async(req,res)=>{
 const secret=process.env.JOB_ALERT_SHARED_SECRET||'',supplied=String(req.get('authorization')||'').replace(/^Bearer /i,'');
 if(!secret||!requireSafeEqual(supplied,secret))return res.sendStatus(403);
 const id=String(req.body?.requestId||''),message=String(req.body?.message||'');
 if(!/^[A-Za-z0-9_-]{8,80}$/.test(id)||!message||message.length>1600)return res.sendStatus(400);
 if(deliveredResults.has(id))return res.json({sent:true,duplicate:true});
 if(!allowedPhone||!process.env.TWILIO_ACCOUNT_SID||!process.env.TWILIO_FROM_PHONE||!twilioAuthToken)return res.status(503).json({sent:false});
 // Reserve before awaiting Twilio to prevent concurrent duplicate callbacks.
 deliveredResults.set(id,'sending');
 try{
  const result=await twilio(process.env.TWILIO_ACCOUNT_SID,twilioAuthToken).messages.create({to:allowedPhone,from:process.env.TWILIO_FROM_PHONE,body:message});
  deliveredResults.set(id,'accepted');
  if(deliveredResults.size>500)deliveredResults.delete(deliveredResults.keys().next().value);
  console.log('[job-result] accepted status='+result.status);
  return res.json({sent:true,providerStatus:result.status});
 }catch(e){deliveredResults.delete(id);console.error('[job-result] provider rejected code='+String(e.code||'unknown'));return res.status(502).json({sent:false});}
});

// Outbound job-question notices use a separate, secret-protected endpoint.
app.post('/internal/job-question-alert', express.json({limit:'4kb'}), async(req,res)=>{
 const secret=process.env.JOB_ALERT_SHARED_SECRET;
 const provided=String(req.get('authorization')||'').replace(/^Bearer /i,'');
 if(!secret||!provided||provided.length!==secret.length||
    !twilioAuthToken||!process.env.TWILIO_ACCOUNT_SID||!process.env.TWILIO_FROM_PHONE||
    !requireSafeEqual(provided,secret))return res.sendStatus(403);
 const count=Number(req.body?.count);
 if(!Number.isInteger(count)||count<1||count>999)return res.sendStatus(400);
 try{
  const client=twilio(process.env.TWILIO_ACCOUNT_SID,twilioAuthToken);
  const body='Lilly: '+count+' job application question(s) need your approved answers. Update: https://docs.google.com/spreadsheets/d/1g4eUIwU1-zyZWuNyMCxradZLhtDnjBcTS34DkxUcItg/edit';
  const msg=await client.messages.create({to:allowedPhone,from:process.env.TWILIO_FROM_PHONE,body});
  res.json({sent:true,messageId:msg.sid});
 }catch(e){console.error('[job-alert] delivery failed',String(e.code||e.message).slice(0,80));res.status(502).json({sent:false})}
});
function requireSafeEqual(a,b){
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&crypto.timingSafeEqual(x,y);
}

app.get('/health', (_req, res) => res.status(200).json({status:'ok',release:'2026-10-08-sms-repair-v8'}));

app.post('/twilio/incoming', async (req, res) => {
  if (!validateTwilio(req)) return res.status(401).send('Unauthorized');
  if ((req.body.From || '') !== allowedPhone) {
    return res.type('application/xml').status(200).send(twiml('Access denied.'));
  }

  try {
    const reply = await routeMessage(req.body.Body || '',req.body.MessageSid);
    return res.type('application/xml').status(200).send(twiml(reply));
  } catch (error) {
    console.error(`[router] ${error?.message || 'unknown error'}`);
    return res.type('application/xml').status(200).send(twiml('Lilly received your request, but the data connector is temporarily unavailable.'));
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`[server] lilly-sms-gateway listening on ${port}`);
});

