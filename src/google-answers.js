import crypto from 'node:crypto';
import {verifiedSubmission,uncertainSubmission} from './job-policy.js';

const SHEET_ID='1g4eUIwU1-zyZWuNyMCxradZLhtDnjBcTS34DkxUcItg';
const TOKEN_URL='https://oauth2.googleapis.com/token';
const SCOPE='https://www.googleapis.com/auth/spreadsheets';
const base64url=x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url');

function credential(){
 const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
 if(!raw)throw Error('Google service-account credential not configured');
 const c=JSON.parse(raw);
 if(c.type!=='service_account'||!c.client_email||!c.private_key)throw Error('Invalid service-account credential structure');
 return c;
}
async function token(scope=SCOPE){
 const c=credential(),now=Math.floor(Date.now()/1000);
 const header=base64url({alg:'RS256',typ:'JWT'});
 const claims=base64url({iss:c.client_email,scope,aud:TOKEN_URL,iat:now,exp:now+3000});
 const unsigned=header+'.'+claims;
 const signature=crypto.sign('RSA-SHA256',Buffer.from(unsigned),c.private_key).toString('base64url');
 const response=await fetch(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Google token exchange failed: HTTP '+response.status);
 const body=await response.json();
 return body.access_token;
}
export async function serviceDriveToken(){return token('https://www.googleapis.com/auth/drive.readonly');}
const SEARCH_SHEET='1ksa_XvJIOR0oa-NW7LFxjBY7Ax29bnGX4jVVHCco66g';
export async function readSearchLedger(){
 const access=await token();
 const r=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+SEARCH_SHEET+'/values/'+encodeURIComponent("'Job Search'!A1:R2000"),{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Job Search read failed HTTP '+r.status);
 return (await r.json()).values||[];
}
export async function recordSearchAttempt(url,status,reason){
 const rows=await readSearchLedger(),index=rows.findIndex((r,i)=>i>0&&r[11]===url);
 if(index<1)throw Error('Job Search row no longer found');
 const old=rows[index];
 if(/applied|submitted|interview|excluded|closed|reject/i.test(old[16]||''))return {updated:false,reason:'protected_status'};
 const access=await token(),note=(old[17]||'')+'\nBatch attempt '+new Date().toISOString()+': '+reason;
 const r=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+SEARCH_SHEET+'/values/'+encodeURIComponent("'Job Search'!Q"+(index+1)+':R'+(index+1))+'?valueInputOption=RAW',{method:'PUT',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({values:[[status,note]]}),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Job Search outcome write failed HTTP '+r.status);
 return {updated:true};
}
export async function readApprovedAnswers(){
 const access=await token();
 const range=encodeURIComponent("'Approved Answers'!A1:F500");
 const url='https://sheets.googleapis.com/v4/spreadsheets/'+SHEET_ID+'/values/'+range;
 const response=await fetch(url,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});
 if(!response.ok){const body=await response.json().catch(()=>({}));const reason=body.error?.errors?.[0]?.reason||body.error?.status||'unknown';throw Error('Google Sheets read failed: HTTP '+response.status+'; reason='+reason);}
 const data=await response.json();
 const rows=(data.values||[]).slice(1);
 const approved=rows.filter(row=>String(row[4]||'').trim().toLowerCase()==='approved').map(row=>({id:row[0],category:row[1],question:row[2],answer:row[3]}));
 // User approvals in Questions To Answer are authoritative immediately;
 // no manual copying into Approved Answers is required.
 const qrange=encodeURIComponent("'Questions To Answer'!A1:G1000");
 const qresponse=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+SHEET_ID+'/values/'+qrange,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});
 if(!qresponse.ok)throw Error('Approved question bank read failed HTTP '+qresponse.status);
 const qrows=((await qresponse.json()).values||[]).slice(1);
 const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const byQuestion=new Map(approved.map(x=>[norm(x.question),x]));
 for(const row of qrows){
  if(String(row[6]||'').trim().toLowerCase()!=='approved')continue;
  const question=String(row[3]||'').trim(),answer=String(row[5]||'').trim();
  if(!question||!answer)continue;
  byQuestion.set(norm(question),{id:row[0],category:'Screening',question,answer});
 }
 return [...byQuestion.values()];
}
export async function checkAnswerConnector(){
 const rows=await readApprovedAnswers();
 return {connected:true,approvedCount:rows.length,hasFirstName:rows.some(x=>x.question==='First name'),hasLocation:rows.some(x=>x.question==='Current location')};
}

export async function appendUnknownQuestions(items){
 if(!Array.isArray(items)||!items.length)return {added:0};
 const access=await token();
 const base='https://sheets.googleapis.com/v4/spreadsheets/'+SHEET_ID+'/values/';
 const range=encodeURIComponent("'Questions To Answer'!A1:I1000");
 const headers={Authorization:'Bearer '+access};
 const existingResponse=await fetch(base+range,{headers,signal:AbortSignal.timeout(12000)});
 if(!existingResponse.ok)throw Error('Question bank read failed HTTP '+existingResponse.status);
 const existing=(await existingResponse.json()).values||[];
 const seen=new Set(existing.slice(1).map(r=>[r[1]||'',r[2]||'',String(r[3]||'').trim().toLowerCase()].join('|')));
 const rows=[];
 for(const q of items){
  const question=String(q.question||'').trim().slice(0,500);
  const jobId=String(q.jobId||'').trim();
  const platform=String(q.platform||'LinkedIn').slice(0,50);
  if(!question||!jobId)continue;
  const key=[platform,jobId,question.toLowerCase()].join('|');
  if(seen.has(key))continue;
  seen.add(key);
  rows.push(['Q'+Date.now().toString(36)+'-'+rows.length,platform,jobId,question,'','','Needs answer',String(q.employer||''),String(q.url||'')]);
 }
 if(!rows.length)return {added:0};
 const url=base+encodeURIComponent("'Questions To Answer'!A:I")+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
 const response=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({values:rows}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Question bank append failed HTTP '+response.status);
 return {added:rows.length};
}

export async function pendingQuestionCount(){
 const access=await token();
 const range=encodeURIComponent("'Questions To Answer'!A1:G1000");
 const response=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+SHEET_ID+'/values/'+range,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Pending question check failed HTTP '+response.status);
 const rows=(await response.json()).values||[];
 return rows.slice(1).filter(r=>String(r[3]||'').trim()&&String(r[6]||'').trim().toLowerCase()!=='approved').length;
}

export async function readSubmittedJobIds(){
 const access=await token();
 const range=encodeURIComponent("'Applications'!A1:G1000");
 const response=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+SHEET_ID+'/values/'+range,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Application log read failed HTTP '+response.status);
 const rows=(await response.json()).values||[];
 const submitted=new Set();
 for(const r of rows.slice(1)){
  const id=String(r[0]||'').trim();
  const status=String(r[4]||'').trim().toLowerCase();
  if(/^[0-9]{8,12}$/.test(id)&&(verifiedSubmission(status)||uncertainSubmission(status)))submitted.add(id);
 }
 return submitted;
}

export async function logVerifiedLinkedInApplication(job){
 const id=String(job?.id||'');
 if(!/^[0-9]{8,12}$/.test(id))throw Error('Invalid LinkedIn job ID');
 const existing=await readApplicationLedger();
 if(existing.some(row=>row.id===id&&verifiedSubmission(row.status)))return {added:false,reason:'already_logged'};
 const result=await upsertApplicationStatus(job,'Submitted verified','LinkedIn confirmation shown after application submission');
 return {added:result.updated};
}

const SHEETS_BASE='https://sheets.googleapis.com/v4/spreadsheets/'+SHEET_ID+'/values/';
async function ledgerRows(access){
 const range=encodeURIComponent("'Applications'!A1:Q2000");
 const response=await fetch(SHEETS_BASE+range,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Application ledger read failed HTTP '+response.status);
 return (await response.json()).values||[];
}
export async function readApplicationLedger(){
 const access=await token();
 const rows=await ledgerRows(access);
 return rows.slice(1).filter(r=>r[0]).map(r=>({id:String(r[0]),company:r[2]||'',title:r[3]||'',status:r[4]||'',salaryRequest:r[5]||null,url:r[8]||'',reason:r[9]||'',source:r[10]||'',resumeVersion:r[15]||''}));
}
export async function upsertApplicationStatus(job,status,reason='',extra={}){
 const id=String(job?.id||'').trim();
 if(!/^[0-9]{8,12}$/.test(id))throw Error('Cannot log job without valid LinkedIn ID');
 const access=await token();
 const rows=await ledgerRows(access);
 const index=rows.findIndex((r,i)=>i>0&&String(r[0]||'').trim()===id);
 const existing=index>0?rows[index]:null;
 if(existing&&(verifiedSubmission(existing[4])||uncertainSubmission(existing[4])&&!verifiedSubmission(status)))
  return {updated:false,reason:'already_submitted'};
 const now=new Date().toISOString();
 const normalizedStatus=String(status||'Needs review').slice(0,90);
 const salary=String(existing?.[5]||job.salaryRequest||'');
 const url=String(job.url||'https://www.linkedin.com/jobs/view/'+id+'/');
 const values=existing
  ? [[normalizedStatus,salary,existing[6]||'',now,url,String(reason||'').slice(0,450),String(extra.source||job.source||'Original queue')]]
  : [[id,'LinkedIn',String(job.company||''),String(job.title||''),normalizedStatus,salary,'',now,url,String(reason||'').slice(0,450),String(extra.source||job.source||'Original queue')]];
 const range=existing?"'Applications'!E"+(index+1)+":K"+(index+1):"'Applications'!A:K";
 const endpoint=SHEETS_BASE+encodeURIComponent(range)+(existing?'?valueInputOption=RAW':':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS');
 const response=await fetch(endpoint,{method:existing?'PUT':'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({values}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Application ledger write failed HTTP '+response.status);
 return {updated:true,status:normalizedStatus};
}

export async function smsJobSummary(command='jobs'){
 const access=await token();
 const ledger=await ledgerRows(access);
 const applications=ledger.slice(1).filter(r=>String(r[2]||r[3]||'').trim());
 const counts={submitted:0,blocked:0,closed:0,other:0};
 for(const r of applications){const st=String(r[4]||'').toLowerCase();if(/submitted verified|applied verified/.test(st))counts.submitted++;else if(/closed/.test(st))counts.closed++;else if(/saved|blocked|not found|unavailable|paused/.test(st))counts.blocked++;else counts.other++;}
 const qrange=encodeURIComponent("'Questions To Answer'!A1:G1000");
 const qr=await fetch(SHEETS_BASE+qrange,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});
 if(!qr.ok)throw Error('Question bank unavailable');
 const questions=((await qr.json()).values||[]).slice(1).filter(r=>String(r[3]||'').trim()&&String(r[6]||'').trim().toLowerCase()!=='approved');
 if(/details/i.test(command)){
  const pending=applications.filter(r=>!verifiedSubmission(r[4])&&!/closed/i.test(r[4]||''));
  return 'Lilly Jobs details: '+pending.length+' pending. '+pending.slice(0,4).map(r=>String(r[0])+': '+String(r[2]||'')+' '+String(r[3]||'').slice(0,70)+' — '+String(r[4]||'Needs review')+'; '+String(r[9]||'No blocker detail recorded').slice(0,120)).join(' | ')+' Text JOBS RETRY to start a new attempt; JOBS STATUS for progress.';
 }
 if(/question/i.test(command)){
  if(!questions.length)return 'Lilly Jobs: No unanswered screening questions in the tracker.';
  return 'Lilly Jobs: '+questions.length+' pending. '+questions.slice(0,3).map(r=>String(r[0])+': '+String(r[3]).slice(0,110)).join(' | ')+' Reply ANSWER <ID> <your answer> to record one.';
 }
 return 'Lilly Jobs tracker: '+counts.submitted+' verified submitted; '+counts.blocked+' saved/blocked; '+counts.closed+' closed; '+counts.other+' other; '+questions.length+' questions pending. Text JOBS QUESTIONS for details. These are tracker counts, not live application confirmations.';
}
export async function smsRecordAnswer(id,answer){
 if(!/^Q[A-Za-z0-9-]{1,55}$/.test(id)||!answer||answer.length>500)throw Error('Invalid question ID or answer');
 const access=await token(),range=encodeURIComponent("'Questions To Answer'!A1:G1000");
 const res=await fetch(SHEETS_BASE+range,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});
 if(!res.ok)throw Error('Question bank unavailable');
 const rows=(await res.json()).values||[];
 const index=rows.findIndex((r,i)=>i>0&&String(r[0]||'').toLowerCase()===id.toLowerCase());
 if(index<1)return 'Question ID not found. Text JOBS QUESTIONS.';
 if(String(rows[index][6]||'').trim().toLowerCase()==='approved')return 'Question '+id+' is already approved; no changes made.';
 const target=encodeURIComponent("'Questions To Answer'!F"+(index+1)+":G"+(index+1));
 const write=await fetch(SHEETS_BASE+target+'?valueInputOption=RAW',{method:'PUT',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({values:[[answer,'Approved']]}),signal:AbortSignal.timeout(12000)});
 if(!write.ok)throw Error('Unable to save answer');
 return 'Lilly Jobs: Answer saved and approved for '+id+'. The job worker can reuse it during its next processing attempt.';
}


export async function setPostingArchive(jobId,{url,status,archivedAt}){
 if(!/^[0-9]{8,12}$/.test(String(jobId)))throw Error('Invalid job ID');
 const access=await token(),rows=await ledgerRows(access);
 const index=rows.findIndex((r,i)=>i>0&&String(r[0]||'')===String(jobId));
 if(index<1)throw Error('Job not in application tracker');
 const range=encodeURIComponent("'Applications'!L"+(index+1)+":N"+(index+1));
 const res=await fetch(SHEETS_BASE+range+'?valueInputOption=RAW',{method:'PUT',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({values:[[url||'',status||'',archivedAt||'']]}),signal:AbortSignal.timeout(12000)});
 if(!res.ok)throw Error('Archive tracker update HTTP '+res.status);
 return true;
}

