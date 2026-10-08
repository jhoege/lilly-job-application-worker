import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createDriveOAuth,DRIVE_REDIRECT_URI,DRIVE_SCOPE} from '../src/drive-oauth.js';

function response(){return {statusCode:200,cookies:[],set(){return this},status(v){this.statusCode=v;return this},type(){return this},send(v){this.body=v;return this},json(v){this.body=v;return this},cookie(n,v,o){this.cookies.push({n,v,o});return this},clearCookie(){return this},redirect(status,url){this.statusCode=status;this.location=url;return this}}}
async function fixture(t,fetcher){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lilly-oauth-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const env={GOOGLE_DRIVE_OAUTH_CLIENT_ID:'test-client',GOOGLE_DRIVE_OAUTH_CLIENT_SECRET:'test-secret',BROWSER_ACCESS_KEY:'x'.repeat(64),GOOGLE_DRIVE_OAUTH_TOKEN_DIR:dir};
  let time=100000;const auth=createDriveOAuth({env,fetcher,now:()=>time});
  const r=response();auth.start({},r);const url=new URL(r.body.authorizationUrl);
  const request={query:{state:url.searchParams.get('state'),code:'test-code'},headers:{cookie:r.cookies[0].n+'='+r.cookies[0].v},get:()=>new URL(DRIVE_REDIRECT_URI).host};
  return {auth,env,dir,url,request,start:r,advance:()=>{time+=11*60*1000}};
}
test('start uses limited Drive access, offline authorization, PKCE and a secure browser cookie',async t=>{
  const x=await fixture(t,()=>{throw Error('unexpected request')});
  assert.equal(x.url.searchParams.get('scope'),DRIVE_SCOPE);assert.equal(x.url.searchParams.get('redirect_uri'),DRIVE_REDIRECT_URI);
  assert.equal(x.url.searchParams.get('access_type'),'offline');assert.equal(x.url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(x.start.cookies[0].o.httpOnly,true);assert.equal(x.start.cookies[0].o.secure,true);assert.equal(x.start.cookies[0].o.sameSite,'lax');
  assert.ok(!x.start.body.authorizationUrl.includes('test-secret'));
});
test('callback rejects missing state, a different browser and expired authorization without contacting Google',async t=>{
  let calls=0;const x=await fixture(t,()=>{calls++;throw Error('unexpected')});
  for(const req of [{...x.request,query:{code:'test-code'}},{...x.request,headers:{cookie:'lilly_drive_oauth=other'}}]){const r=response();await x.auth.callback(req,r);assert.equal(r.statusCode,400)}
  x.advance();const r=response();await x.auth.callback(x.request,r);assert.equal(r.statusCode,400);assert.equal(calls,0);
});
test('callback saves an encrypted refresh token, binds the client and rejects replay',async t=>{
  let calls=0;
  const x=await fixture(t,async(u,o)=>{calls++;assert.equal(u,'https://oauth2.googleapis.com/token');assert.ok(o.body.get('code_verifier'));return new Response(JSON.stringify({access_token:'access-value',refresh_token:'refresh-value',scope:DRIVE_SCOPE,expires_in:3600}),{status:200})});
  const r=response();await x.auth.callback(x.request,r);assert.equal(r.location,'/auth-browser?drive=connected');
  const file=path.join(x.dir,'tokens.enc');const content=await fs.readFile(file,'utf8');assert.ok(!content.includes('refresh-value'));assert.ok(!content.includes('access-value'));
  assert.equal((await fs.stat(file)).mode&0o777,0o600);assert.equal((await fs.stat(x.dir)).mode&0o777,0o700);
  assert.equal(await x.auth.accessToken(),'access-value');const replay=response();await x.auth.callback(x.request,replay);assert.equal(replay.statusCode,400);assert.equal(calls,1);
  const restarted=createDriveOAuth({env:x.env,fetcher:async(u,o)=>{assert.equal(o.body.get('refresh_token'),'refresh-value');return new Response(JSON.stringify({access_token:'refreshed',expires_in:3600}))}});
  assert.equal(await restarted.accessToken(),'refreshed');
});
test('denied consent and missing refresh token never report success',async t=>{
  const x=await fixture(t,async()=>new Response(JSON.stringify({access_token:'a',scope:DRIVE_SCOPE})));
  const r=response();await x.auth.callback({...x.request,query:{...x.request.query,error:'access_denied'}},r);assert.equal(r.location,'/auth-browser?drive=declined');
  const y=await fixture(t,async()=>new Response(JSON.stringify({access_token:'a',scope:DRIVE_SCOPE})));
  const s=response();await y.auth.callback(y.request,s);assert.equal(s.location,'/auth-browser?drive=failed');assert.deepEqual(await fs.readdir(y.dir),[]);
});
test('folder authorization must succeed before archiveReady is true',async t=>{
  let folderAllowed=false;
  const x=await fixture(t,async(u)=>u.includes('/token')?new Response(JSON.stringify({access_token:'a',refresh_token:'r',scope:DRIVE_SCOPE})):folderAllowed?new Response(JSON.stringify({mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}})):new Response('{}',{status:404}));
  await x.auth.callback(x.request,response());const r=response();await x.auth.status({},r);assert.equal(r.body.connected,true);assert.equal(r.body.archiveReady,false);
  folderAllowed=true;const s=response();await x.auth.status({},s);assert.equal(s.body.archiveReady,true);
});
test('missing configuration fails closed and token errors never expose credential text',async t=>{
  const auth=createDriveOAuth({env:{}}),r=response();auth.start({},r);assert.equal(r.statusCode,503);
  const x=await fixture(t,async()=>new Response(JSON.stringify({error:'invalid_grant',error_description:'test-secret refresh-value'}),{status:400}));
  const s=response();await x.auth.callback(x.request,s);assert.equal(s.location,'/auth-browser?drive=failed');assert.deepEqual(await fs.readdir(x.dir),[]);
});
