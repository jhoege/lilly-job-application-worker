import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_REDIRECT_URI = 'https://lilly-job-worker-app-production.up.railway.app/integrations/google-drive/callback';
export const ARCHIVE_FOLDER = '1NtyYD40oT4mU7CBbd0tJZ260Jm6_GXS9';
const COOKIE = 'lilly_drive_oauth';
const TTL = 10 * 60 * 1000;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function createDriveOAuth({env=process.env, fetcher=(...args)=>fetch(...args), now=Date.now}={}) {
  const pending = new Map();
  let cached = null;
  let refreshing = null;
  const tokenFile = () => path.join(env.GOOGLE_DRIVE_OAUTH_TOKEN_DIR || '/data/lilly-drive-auth', 'tokens.enc');
  const client = () => {
    if (!env.GOOGLE_DRIVE_OAUTH_CLIENT_ID || !env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET) throw Error('Google Drive OAuth client not configured');
    return {client_id:env.GOOGLE_DRIVE_OAUTH_CLIENT_ID, client_secret:env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET};
  };
  const encryptionKey = () => {
    if (Buffer.byteLength(env.BROWSER_ACCESS_KEY || '') < 32) throw Error('Secure Drive token storage unavailable');
    return crypto.createHash('sha256').update('lilly-drive-token-v1\0'+env.BROWSER_ACCESS_KEY).digest();
  };
  const headers = res => {
    res.set('Cache-Control','no-store');
    res.set('Referrer-Policy','no-referrer');
    res.set('X-Content-Type-Options','nosniff');
    res.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  };
  async function save(refreshToken) {
    const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv);
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify({refreshToken,clientId:client().client_id,scope:DRIVE_SCOPE}),'utf8'),cipher.final()]);
    const payload=JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:ciphertext.toString('base64')});
    const file=tokenFile(), dir=path.dirname(file), temporary=file+'.'+crypto.randomBytes(8).toString('hex');
    await fs.mkdir(dir,{recursive:true,mode:0o700});
    await fs.chmod(dir,0o700);
    try {await fs.writeFile(temporary,payload,{mode:0o600,flag:'wx'}); await fs.rename(temporary,file)}
    finally {await fs.unlink(temporary).catch(()=>{})}
  }
  async function load() {
    if (env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN) return env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN;
    try {
      const p=JSON.parse(await fs.readFile(tokenFile(),'utf8'));
      if(p.version!==1)throw Error();
      const d=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(p.iv,'base64'));
      d.setAuthTag(Buffer.from(p.tag,'base64'));
      const saved=JSON.parse(Buffer.concat([d.update(Buffer.from(p.data,'base64')),d.final()]).toString('utf8'));
      if(saved.clientId!==client().client_id || saved.scope!==DRIVE_SCOPE || !saved.refreshToken)throw Error();
      return saved.refreshToken;
    } catch {throw Error('Google Drive authorization required')}
  }
  async function exchange(values) {
    const r=await fetcher(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...client(),...values}),signal:AbortSignal.timeout(12000)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok || !j.access_token)throw Error(j.error==='invalid_grant' ? 'Google Drive authorization expired; reconnect Google' : 'Google Drive token exchange failed');
    if(j.scope && !j.scope.split(' ').includes(DRIVE_SCOPE))throw Error('Google Drive file permission was not granted');
    return j;
  }
  const cache = j => {cached={token:j.access_token,until:now()+Math.min(Number(j.expires_in)||3600,3600)*1000-60000};return cached.token};
  async function accessToken() {
    client();
    if(cached && cached.until>now())return cached.token;
    if(!refreshing)refreshing=(async()=>cache(await exchange({grant_type:'refresh_token',refresh_token:await load()})))().finally(()=>{refreshing=null});
    return refreshing;
  }
  function start(req,res) {
    headers(res);
    try {
      const c=client(); encryptionKey();
      for(const [k,v] of pending)if(v.until<=now())pending.delete(k);
      if(pending.size>=8)return res.status(429).json({error:'Too many pending Google connections; wait ten minutes'});
      const state=crypto.randomBytes(32).toString('base64url'), nonce=crypto.randomBytes(32).toString('base64url'), verifier=crypto.randomBytes(48).toString('base64url');
      pending.set(state,{nonceHash:crypto.createHash('sha256').update(nonce).digest(),verifier,until:now()+TTL});
      res.cookie(COOKIE,nonce,{httpOnly:true,secure:true,sameSite:'lax',path:'/integrations/google-drive',maxAge:TTL});
      const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      for(const [k,v] of Object.entries({client_id:c.client_id,redirect_uri:DRIVE_REDIRECT_URI,response_type:'code',scope:DRIVE_SCOPE,access_type:'offline',prompt:'consent',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))u.searchParams.set(k,v);
      res.json({authorizationUrl:u.toString()});
    } catch {res.status(503).json({error:'Google Drive OAuth client needs configuration in Railway'})}
  }
  async function callback(req,res) {
    headers(res);
    const state=typeof req.query.state==='string'?req.query.state:'';
    const entry=pending.get(state);
    const nonce=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
    const hash=crypto.createHash('sha256').update(nonce).digest();
    if(req.get('host')!==new URL(DRIVE_REDIRECT_URI).host || !entry || entry.until<=now() || !nonce || !crypto.timingSafeEqual(hash,entry.nonceHash))return res.status(400).type('text').send('Invalid or expired Google connection. Start again from Lilly’s authenticated interface.');
    pending.delete(state);
    res.clearCookie(COOKIE,{httpOnly:true,secure:true,sameSite:'lax',path:'/integrations/google-drive'});
    if(req.query.error)return res.redirect(303,'/auth-browser?drive=declined');
    const code=typeof req.query.code==='string'?req.query.code:'';
    if(!code || code.length>2048)return res.status(400).type('text').send('Google did not return a valid authorization code.');
    try {
      const j=await exchange({grant_type:'authorization_code',code,redirect_uri:DRIVE_REDIRECT_URI,code_verifier:entry.verifier});
      if(!j.refresh_token)throw Error('Offline authorization required');
      await save(j.refresh_token);
      cache(j);
      res.redirect(303,'/auth-browser?drive=connected');
    } catch {res.redirect(303,'/auth-browser?drive=failed')}
  }
  async function status(_req,res) {
    headers(res);
    try {
      const token=await accessToken();
      const r=await fetcher('https://www.googleapis.com/drive/v3/files/'+ARCHIVE_FOLDER+'?fields=id,mimeType,capabilities(canAddChildren)',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
      if(!r.ok)return res.json({connected:true,archiveReady:false,reason:r.status===404||r.status===403?'Existing archive folder must be authorized through Google Picker':'Archive folder check failed'});
      const folder=await r.json();
      res.json({connected:true,archiveReady:folder.mimeType==='application/vnd.google-apps.folder' && folder.capabilities?.canAddChildren===true});
    } catch(e){res.status(503).json({connected:false,archiveReady:false,error:e.message})}
  }
  return {start,callback,status,accessToken};
}

export const driveOAuth=createDriveOAuth();
