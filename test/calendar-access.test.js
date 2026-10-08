import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {calendarQuery,CALENDAR_SCOPE,calendarConnectLink,mountCalendarConnect} from '../src/calendar-access.js';
import {createDriveOAuth,DRIVE_REDIRECT_URI} from '../src/drive-oauth.js';
import {parseCommand} from '../sms-gateway/src/commands.js';
function response(){return {cookies:[],set(){return this},status(v){this.statusCode=v;return this},type(){return this},send(v){this.body=v;return this},json(v){this.body=v;return this},cookie(n,v,o){this.cookies.push({n,v,o});return this},clearCookie(){return this},redirect(s,u){this.statusCode=s;this.location=u;return this}}}
test('calendar connection requests read-only permission and keeps its credentials separate from Drive',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lilly-calendar-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const env={GOOGLE_DRIVE_OAUTH_CLIENT_ID:'test-client',GOOGLE_DRIVE_OAUTH_CLIENT_SECRET:'secret',BROWSER_ACCESS_KEY:'x'.repeat(64),GOOGLE_CALENDAR_OAUTH_TOKEN_DIR:dir};
 const auth=createDriveOAuth({env,scope:CALENDAR_SCOPE,identity:'calendar',fetcher:async()=>new Response(JSON.stringify({access_token:'calendar-access',refresh_token:'calendar-refresh',scope:CALENDAR_SCOPE,expires_in:3600}))});
 const start=response();auth.start({},start);const url=new URL(start.body.authorizationUrl);
 assert.equal(url.searchParams.get('scope'),CALENDAR_SCOPE);assert.equal(url.searchParams.get('redirect_uri'),DRIVE_REDIRECT_URI);
 assert.ok(url.searchParams.get('state').startsWith('calendar-'));assert.equal(start.cookies[0].n,'lilly_calendar_oauth');
 const done=response();await auth.callback({query:{state:url.searchParams.get('state'),code:'code'},headers:{cookie:start.cookies[0].n+'='+start.cookies[0].v},get:()=>new URL(DRIVE_REDIRECT_URI).host},done);
 assert.equal(done.location,'/auth-browser?calendar=connected');assert.equal(await auth.accessToken(),'calendar-access');
 assert.ok(!(await fs.readFile(path.join(dir,'tokens.enc'),'utf8')).includes('calendar-refresh'));
});
test('SMS calendar questions include meetings and addresses and use Chicago date boundaries',()=>{
 for(const text of ['What meetings do I have tomorrow?','What is the address for my next appointment?','CALENDAR today'])assert.equal(parseCommand(text).kind,'calendar');
 assert.equal(parseCommand('JOB SEARCH VP of Operations').kind,'job_search');
 const now=new Date('2026-10-08T21:00:00Z');
 assert.deepEqual(calendarQuery('calendar tomorrow',now),{timeMin:'2026-10-09T05:00:00.000Z',timeMax:'2026-10-10T05:00:00.000Z',q:''});
 assert.equal(calendarQuery('calendar 2026-12-01',now).timeMin,'2026-12-01T06:00:00.000Z');
 const keyword=calendarQuery('meeting with WaterTech',now);assert.equal(keyword.q,'WaterTech');assert.equal(keyword.timeMax,'2026-10-22T05:00:00.000Z');
});

test('calendar connection ticket survives link previews, is single use, and begins cookie-bound Google consent',async t=>{
 const saved={...process.env};Object.assign(process.env,{GOOGLE_DRIVE_OAUTH_CLIENT_ID:'client',GOOGLE_DRIVE_OAUTH_CLIENT_SECRET:'secret',BROWSER_ACCESS_KEY:'x'.repeat(64)});
 t.after(()=>{for(const key of ['GOOGLE_DRIVE_OAUTH_CLIENT_ID','GOOGLE_DRIVE_OAUTH_CLIENT_SECRET','BROWSER_ACCESS_KEY'])if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];});
 const routes={};mountCalendarConnect({get:(url,fn)=>{routes.get=fn;},post:(url,fn)=>{routes.post=fn;}});
 const ticket=new URL(calendarConnectLink()).searchParams.get('ticket');
 for(let i=0;i<2;i++){const r=response();routes.get({query:{ticket}},r);assert.match(r.body,/Connect Google Calendar/);}
 const r=response();await routes.post({body:{ticket}},r);
 assert.equal(r.statusCode,303);assert.equal(new URL(r.location).searchParams.get('scope'),CALENDAR_SCOPE);assert.equal(r.cookies[0].n,'lilly_calendar_oauth');assert.equal(r.cookies[0].o.httpOnly,true);
 const expired=response();routes.get({query:{ticket}},expired);assert.equal(expired.statusCode,410);
});
