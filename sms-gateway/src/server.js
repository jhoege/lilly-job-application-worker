import express from 'express';
import { GoogleAuth } from 'google-auth-library';
import twilio from 'twilio';

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

async function routeMessage(body) {
  const n = String(body || '').trim().toLowerCase();
  if (n === 'help') return 'Commands: HELP, STATUS, TASKS, PAST DUE, DUE TODAY, CALENDAR, BILLS, JOBS.';
  if (n === 'status') return 'Lilly SMS gateway is online and your number is authorized.';
  if (n === 'hello' || n === 'hi' || n.startsWith('hello lilly')) return 'Hello. Text HELP for available commands.';
  if (n.includes('past due')) return summarizeTasks(await fetchTasks(), 'past-due');
  if (n.includes('due today') || n.includes('what do i have due today')) return summarizeTasks(await fetchTasks(), 'due-today');
  if (n === 'tasks' || n.includes('task')) return summarizeTasks(await fetchTasks(), 'all');
  if (n.includes('calendar') || n.includes('schedule')) return 'Calendar command recognized. Calendar connector is not yet linked to this gateway.';
  if (n.includes('bill')) return 'Bills command recognized. Bills connector is not yet linked to this gateway.';
  if (n.includes('job')) return 'Jobs command recognized. Jobs connector is not yet linked to this gateway.';
  return 'Request received but not supported by text yet. Text HELP for available commands.';
}

app.get('/health', (_req, res) => res.status(200).send('OK'));

app.post('/twilio/incoming', async (req, res) => {
  if (!validateTwilio(req)) return res.status(401).send('Unauthorized');
  if ((req.body.From || '') !== allowedPhone) {
    return res.type('application/xml').status(200).send(twiml('Access denied.'));
  }

  try {
    const reply = await routeMessage(req.body.Body || '');
    return res.type('application/xml').status(200).send(twiml(reply));
  } catch (error) {
    console.error(`[router] ${error?.message || 'unknown error'}`);
    return res.type('application/xml').status(200).send(twiml('Lilly received your request, but the data connector is temporarily unavailable.'));
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`[server] lilly-sms-gateway listening on ${port}`);
});
