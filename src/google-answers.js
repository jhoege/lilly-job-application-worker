import crypto from 'node:crypto';

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
async function token(){
 const c=credential(),now=Math.floor(Date.now()/1000);
 const header=base64url({alg:'RS256',typ:'JWT'});
 const claims=base64url({iss:c.client_email,scope:SCOPE,aud:TOKEN_URL,iat:now,exp:now+3000});
 const unsigned=header+'.'+claims;
 const signature=crypto.sign('RSA-SHA256',Buffer.from(unsigned),c.private_key).toString('base64url');
 const response=await fetch(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Google token exchange failed: HTTP '+response.status);
 const body=await response.json();
 return body.access_token;
}
export async function readApprovedAnswers(){
 const access=await token();
 const range=encodeURIComponent("'Approved Answers'!A1:F500");
 const url='https://sheets.googleapis.com/v4/spreadsheets/'+SHEET_ID+'/values/'+range;
 const response=await fetch(url,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});
 if(!response.ok){const body=await response.json().catch(()=>({}));const reason=body.error?.errors?.[0]?.reason||body.error?.status||'unknown';const msg=String(body.error?.message||'').replace(/[\\r\\n]/g,' ').slice(0,180);throw Error('Google Sheets read failed: HTTP '+response.status+'; reason='+reason+'; detail='+msg);}
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
  if(/^[0-9]{8,12}$/.test(id)&&/submitted|applied|hired|interview/.test(status))submitted.add(id);
 }
 return submitted;
}

export async function logVerifiedLinkedInApplication(job){
 const id=String(job?.id||'');
 if(!/^[0-9]{8,12}$/.test(id))throw Error('Invalid LinkedIn job ID');
 const existing=await readSubmittedJobIds();
 if(existing.has(id))return {added:false,reason:'already_logged'};
 const result=await upsertApplicationStatus(job,'Submitted verified','LinkedIn confirmation shown after application submission');
 return {added:result.updated};
}

const SHEETS_BASE='https://sheets.googleapis.com/v4/spreadsheets/'+SHEET_ID+'/values/';
async function ledgerRows(access){
 const range=encodeURIComponent("'Applications'!A1:K2000");
 const response=await fetch(SHEETS_BASE+range,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Application ledger read failed HTTP '+response.status);
 return (await response.json()).values||[];
}
export async function readApplicationLedger(){
 const access=await token();
 const rows=await ledgerRows(access);
 return rows.slice(1).filter(r=>r[0]).map(r=>({id:String(r[0]),status:r[4]||'',reason:r[9]||'',source:r[10]||''}));
}
export async function upsertApplicationStatus(job,status,reason='',extra={}){
 const id=String(job?.id||'').trim();
 if(!/^[0-9]{8,12}$/.test(id))throw Error('Cannot log job without valid LinkedIn ID');
 const access=await token();
 const rows=await ledgerRows(access);
 const index=rows.findIndex((r,i)=>i>0&&String(r[0]||'').trim()===id);
 const existing=index>0?rows[index]:null;
 if(existing&&/submitted|applied|hired|interview/i.test(existing[4]||''))
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
