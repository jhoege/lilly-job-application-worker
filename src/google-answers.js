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
 return rows.filter(row=>String(row[4]||'').trim().toLowerCase()==='approved').map(row=>({id:row[0],category:row[1],question:row[2],answer:row[3]}));
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
