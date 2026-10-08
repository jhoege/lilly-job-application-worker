import express from 'express';
import { chromium } from 'playwright';
import fs from 'node:fs';
import { mountAuthBrowser } from './auth-browser.js';
import { checkAnswerConnector } from './google-answers.js';
import { startQuestionAlerts } from './question-alerts.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const testMode = process.env.TEST_MODE !== 'false';
const profilePath = process.env.BROWSER_PROFILE_PATH || '/data/browser-profile';

let browserContext = null;
let browserReady = false;
let browserError = null;

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
