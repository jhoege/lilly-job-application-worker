import crypto from 'node:crypto';
import {setPostingArchive} from './google-answers.js';
import {driveOAuth} from './drive-oauth.js';
import {capturePostingPdf} from './posting-pdf.js';

const FOLDER='1NtyYD40oT4mU7CBbd0tJZ260Jm6_GXS9';
const SCOPE='https://www.googleapis.com/auth/drive.file';
function b64(v){return Buffer.from(JSON.stringify(v)).toString('base64url')}
async function accessToken(){
 if(process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID || process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET)return driveOAuth.accessToken();
 const c=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON||'{}');
 if(!c.client_email||!c.private_key)throw Error('Drive credentials unavailable');
 const now=Math.floor(Date.now()/1000),h=b64({alg:'RS256',typ:'JWT'}),p=b64({iss:c.client_email,scope:SCOPE,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+1800});
 const input=h+'.'+p,signature=crypto.sign('RSA-SHA256',Buffer.from(input),c.private_key).toString('base64url');
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:input+'.'+signature}),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Drive authentication HTTP '+r.status);
 return (await r.json()).access_token;
}
export async function archivePosting(page,job){
 const id=String(job.id||'');
 if(!/^[0-9]{8,12}$/.test(id))throw Error('Invalid archive job ID');
 try{
  const token=await accessToken();
  const existingId=String(job.archiveUrl||'').match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/)?.[1];
  if(existingId&&job.archiveStatus==='Captured'){
   const existing=await fetch('https://www.googleapis.com/drive/v3/files/'+existingId+'?fields=id,mimeType,size,parents,appProperties,trashed,webViewLink,createdTime',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});
   if(existing.ok){const file=await existing.json();if(!file.trashed&&file.mimeType==='application/pdf'&&Number(file.size)>2000&&file.parents?.includes(FOLDER)&&(!file.appProperties?.lillyJobId||file.appProperties.lillyJobId===id))return {ok:true,url:file.webViewLink||job.archiveUrl,reused:true};}
  }
  // Recover a verified full-text capture even when a retry lost the tracker URL.
  const query="'"+FOLDER+"' in parents and trashed = false and mimeType = 'application/pdf' and appProperties has { key='lillyPostingSchema' and value='fulltext-v1' } and appProperties has { key='lillyJobId' and value='"+id+"' }";
  const lookupUrl=new URL('https://www.googleapis.com/drive/v3/files');
  lookupUrl.searchParams.set('q',query);lookupUrl.searchParams.set('fields','files(id,mimeType,size,parents,appProperties,trashed,webViewLink,createdTime)');
  lookupUrl.searchParams.set('orderBy','createdTime desc');lookupUrl.searchParams.set('pageSize','100');
  const lookup=await fetch(lookupUrl,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});
  if(!lookup.ok)throw Error('Existing archive lookup HTTP '+lookup.status);
  const recovered=(await lookup.json()).files?.find(file=>Number(file.size)>2000&&file.parents?.includes(FOLDER)&&file.appProperties?.lillyPostingSchema==='fulltext-v1'&&file.appProperties?.lillyJobId===id);
  if(recovered){
   const url=recovered.webViewLink||'https://drive.google.com/file/d/'+recovered.id+'/view';
   await setPostingArchive(id,{url,status:'Captured',archivedAt:recovered.createdTime||job.archivedAt||new Date().toISOString()});
   return {ok:true,url,reused:true};
  }
  const pdf=await capturePostingPdf(page,job);
  if(pdf.length<2000)throw Error('PDF unexpectedly small');
  const title=[job.company||'Employer',job.title||'Job',id].join(' - ').replace(/[^a-zA-Z0-9 ._-]/g,'').slice(0,160)+'.pdf';
  const boundary='lilly'+crypto.randomBytes(12).toString('hex');
  const metadata=JSON.stringify({name:title,mimeType:'application/pdf',parents:[FOLDER],description:'Original job posting captured before application; '+String(job.url||''),appProperties:{lillyPostingSchema:'fulltext-v1',lillyJobId:id}});
  const body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+metadata+'\r\n--'+boundary+'\r\nContent-Type: application/pdf\r\n\r\n'),pdf,Buffer.from('\r\n--'+boundary+'--\r\n')]);
  const response=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'multipart/related; boundary='+boundary},body,signal:AbortSignal.timeout(25000)});
  if(!response.ok){
   const detail=await response.json().catch(()=>({}));
   const code=String(detail.error?.errors?.[0]?.reason||detail.error?.status||'unknown').replace(/[^a-zA-Z0-9_]/g,'').slice(0,48);
   throw Error('Drive upload HTTP '+response.status+' ('+code+')');
  }
  const file=await response.json();
  if(!file.id)throw Error('Drive returned no file ID');
  const url=file.webViewLink||'https://drive.google.com/file/d/'+file.id+'/view';
  await setPostingArchive(id,{url,status:'Captured',archivedAt:new Date().toISOString()});
  return {ok:true,url};
 }catch(error){
  const reason=String(error.message||error).slice(0,110);
  try{await setPostingArchive(id,{status:'Failed: '+reason,archivedAt:new Date().toISOString()})}catch{}
  return {ok:false,reason};
 }
}


