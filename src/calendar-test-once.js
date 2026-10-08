import fs from 'node:fs';
import path from 'node:path';
const file='/data/calendar-test-2026-10-08.json';
export function startOneTimeCalendarTest(){
 if(process.env.CALENDAR_TEST_SEND_ONCE!=='calendar-2026-10-08')return;
 const endpoint=process.env.JOB_SMS_GATEWAY_URL;
 const secret=process.env.JOB_ALERT_SHARED_SECRET;
 if(!endpoint||!secret){console.error('[calendar-test] missing gateway configuration');return}
 // Wait for gateway redeployment, then make exactly one attempt across worker restarts.
 setTimeout(async()=>{
  if(fs.existsSync(file)){console.log('[calendar-test] already attempted; will not resend');return}
  try{
   fs.mkdirSync(path.dirname(file),{recursive:true});
   fs.writeFileSync(file,JSON.stringify({attemptedAt:new Date().toISOString(),status:'attempted'}),{flag:'wx'});
  }catch(e){console.error('[calendar-test] unable to record one-time attempt');return}
  try{
   const url=new URL('/internal/calendar-test',endpoint);
   if(url.protocol!=='https:')throw Error('HTTPS required');
   const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({testId:'calendar-2026-10-08'}),signal:AbortSignal.timeout(15000)});
   const result=await response.json().catch(()=>({}));
   const status=response.ok&&result.sent===true?'accepted':'failed';
   fs.writeFileSync(file,JSON.stringify({attemptedAt:new Date().toISOString(),status,httpStatus:response.status,providerStatus:result.providerStatus||null,providerCode:result.providerCode||null}));
   console.log('[calendar-test] status='+status+' http='+response.status+' provider='+String(result.providerStatus||result.providerCode||'unknown'));
  }catch(e){console.error('[calendar-test] send failed '+String(e.message).slice(0,100))}
 },90000).unref();
}
