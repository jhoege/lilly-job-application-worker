import fs from 'node:fs';
import path from 'node:path';
import {pendingQuestionCount} from './google-answers.js';
const stateFile=process.env.JOB_ALERT_STATE_FILE||'/data/hourly-question-alert.json';
let busy=false;
let lastAttemptHour=null;
export function startQuestionAlerts(){
 const endpoint=process.env.JOB_SMS_GATEWAY_URL;
 const secret=process.env.JOB_ALERT_SHARED_SECRET;
 if(!endpoint||!secret){console.log('[question-alerts] disabled: gateway URL or shared secret missing');return}
 const run=async()=>{
  if(busy)return;
  const now=new Date();
  const hour=now.toISOString().slice(0,13);
  let prior={};
  try{prior=JSON.parse(fs.readFileSync(stateFile,'utf8'))}catch{}
  if(prior.lastSentHour===hour||lastAttemptHour===hour)return;
  lastAttemptHour=hour;
  busy=true;
  try{
   const count=await pendingQuestionCount();
   if(count===0)return;
   const url=new URL(endpoint);
   if(url.protocol!=='https:')throw Error('Gateway must use HTTPS');
   const response=await fetch(url.toString(),{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({count}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('SMS gateway failed HTTP '+response.status);
   const data=await response.json();
   if(data.sent!==true)throw Error('SMS delivery not confirmed');
   fs.mkdirSync(path.dirname(stateFile),{recursive:true});
   fs.writeFileSync(stateFile,JSON.stringify({lastSentHour:hour,questionCount:count,at:now.toISOString()}));
   console.log('[question-alerts] sent pending count='+count);
  }catch(e){console.error('[question-alerts] '+String(e.message).slice(0,160))}
  finally{busy=false}
 };
 // Runs shortly after the beginning of each UTC hour, at most once per hour.
 setInterval(()=>{void run()},60*1000).unref();
 void run();
}
