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
 if(!response.ok)throw Error('Google Sheets read failed: HTTP '+response.status);
 const data=await response.json();
 const rows=(data.values||[]).slice(1);
 return rows.filter(row=>String(row[4]||'').trim().toLowerCase()==='approved').map(row=>({id:row[0],category:row[1],question:row[2],answer:row[3]}));
}
export async function checkAnswerConnector(){
 const rows=await readApprovedAnswers();
 return {connected:true,approvedCount:rows.length,hasFirstName:rows.some(x=>x.question==='First name'),hasLocation:rows.some(x=>x.question==='Current location')};
}
