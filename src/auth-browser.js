import crypto from 'node:crypto';
import express from 'express';

const SESSION_MS = 20 * 60 * 1000;
const sessions = new Map();
const attempts = new Map();
const cookieName = 'lilly_auth_session';
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lilly secure browser login</title><style>body{font:16px system-ui;max-width:1100px;margin:24px auto;padding:0 16px;background:#101521;color:#fff}button,input{padding:10px;margin:4px;border-radius:6px}button{cursor:pointer}#screen{max-width:100%;border:1px solid #667;cursor:crosshair}input{max-width:95%}p{color:#bbc}#secret{width:360px}</style></head><body><h2>Lilly — supervised LinkedIn sign-in</h2><p>Only use this page over HTTPS. Never share the access key. This session expires after 20 minutes. Passwords and codes are sent directly to your own Railway worker and are not saved by this interface.</p><section id="login"><input id="secret" type="password" autocomplete="off" placeholder="Temporary access key"><button id="unlock">Unlock</button></section><section id="controls" hidden><p id="status">Connected</p><button id="open">Open LinkedIn</button><button id="jobs">Find remote operations jobs</button><input id="joburl" placeholder="Paste LinkedIn job URL"><button id="gotojob">Open job URL</button><button id="down">Scroll down</button><button id="up">Scroll up</button><button id="refresh">Refresh screen</button><button id="pressEnter">Press Enter</button><button id="close">End access</button><p>Click the screenshot to focus a field. Type into the box below and press “Type into focused field.”</p><input id="typing" type="password" autocomplete="off" placeholder="Type text / password / verification code"><button id="type">Type into focused field</button><label><input id="plain" type="checkbox">Show typing</label><p><img id="screen" alt="Remote Chromium browser screenshot"></p></section><script>
const $=id=>document.getElementById(id);
async function api(path,data){const r=await fetch('/auth-browser'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})});if(!r.ok)throw Error('Request failed ('+r.status+')');return r.json()}
async function snapshot(){const r=await fetch('/auth-browser/screenshot',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('Screenshot failed');$('screen').src=URL.createObjectURL(await r.blob())}
async function run(fn){try{await fn();$('status').textContent='Connected';await snapshot()}catch(e){$('status').textContent=e.message}}
$('unlock').onclick=async()=>{try{await api('/unlock',{key:$('secret').value});$('secret').value='';$('login').hidden=true;$('controls').hidden=false;await snapshot()}catch(e){alert('Access denied')}}
$('open').onclick=()=>run(()=>api('/open'));
$('refresh').onclick=()=>run(async()=>{});
$('jobs').onclick=()=>run(()=>api('/jobs'));
$('gotojob').onclick=()=>run(()=>api('/navigate',{url:$('joburl').value}));
$('down').onclick=()=>run(()=>api('/scroll',{delta:600}));
$('up').onclick=()=>run(()=>api('/scroll',{delta:-600}));
$('pressEnter').onclick=()=>run(()=>api('/key',{key:'Enter'}));
$('type').onclick=()=>run(async()=>{await api('/type',{text:$('typing').value});$('typing').value=''});
$('plain').onchange=()=>{$('typing').type=$('plain').checked?'text':'password'};
$('screen').onclick=e=>run(()=>{const rect=e.target.getBoundingClientRect();return api('/click',{x:Math.round((e.clientX-rect.left)*e.target.naturalWidth/rect.width),y:Math.round((e.clientY-rect.top)*e.target.naturalHeight/rect.height)})});
$('close').onclick=async()=>{await api('/close');location.reload()};
</script></body></html>`;

export function mountAuthBrowser(app, getContext) {
  const key = process.env.BROWSER_ACCESS_KEY;
  if (!key || Buffer.byteLength(key) < 32) {
    console.log('[auth-browser] disabled: BROWSER_ACCESS_KEY must be at least 32 bytes');
    return;
  }
  const router = express.Router();
  router.use(express.json({limit:'8kb'}));
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    res.set('X-Content-Type-Options','nosniff');
    res.set('Referrer-Policy','no-referrer');
    res.set('Content-Security-Policy',"default-src 'none'; img-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    if(req.method==='POST'){
      const origin=req.get('origin');
      if(!origin || origin!==('https://'+req.get('host'))) return res.sendStatus(403);
    }
    next();
  });
  function authorized(req,res,next){
    const sid=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.split('=')[1];
    const expiry=sid&&sessions.get(sid);
    if(!expiry || expiry<Date.now()){if(sid)sessions.delete(sid);return res.sendStatus(401)}
    next();
  }
  function page(){const context=getContext();if(!context)throw Error('Browser not ready');return context.pages()[0]||context.newPage()}
  router.get('/',(_req,res)=>res.type('html').send(html));
  router.post('/unlock',(req,res)=>{
    const ip=req.ip||'unknown', state=attempts.get(ip)||{count:0,until:0};
    if(state.until>Date.now())return res.sendStatus(429);
    const supplied=Buffer.from(String(req.body.key||''));
    const expected=Buffer.from(key);
    const valid=supplied.length===expected.length&&crypto.timingSafeEqual(supplied,expected);
    if(!valid){state.count++;if(state.count>=5){state.count=0;state.until=Date.now()+15*60*1000}attempts.set(ip,state);return res.sendStatus(401)}
    attempts.delete(ip);
    const sid=crypto.randomBytes(32).toString('hex');
    sessions.set(sid,Date.now()+SESSION_MS);
    res.cookie(cookieName,sid,{httpOnly:true,secure:true,sameSite:'strict',maxAge:SESSION_MS,path:'/auth-browser'});
    res.json({ok:true});
  });
  router.get('/screenshot',authorized,async(_req,res)=>{
    try{const p=await page();res.type('png').send(await p.screenshot({timeout:10000}))}catch{res.sendStatus(503)}
  });
  router.post('/open',authorized,async(_req,res)=>{try{const p=await page();await p.goto('https://www.linkedin.com/login',{waitUntil:'domcontentloaded',timeout:20000});res.json({ok:true})}catch{res.sendStatus(503)}});
  router.post('/jobs',authorized,async(_req,res)=>{try{const p=await page();const u=new URL('https://www.linkedin.com/jobs/search/');u.searchParams.set('keywords','Director of Operations');u.searchParams.set('f_WT','2');u.searchParams.set('f_AL','true');u.searchParams.set('location','United States');await p.goto(u.toString(),{waitUntil:'domcontentloaded',timeout:25000});res.json({ok:true})}catch{res.sendStatus(503)}});
  router.post('/navigate',authorized,async(req,res)=>{try{const u=new URL(String(req.body.url||''));if(u.protocol!=='https:'||!['www.linkedin.com','linkedin.com'].includes(u.hostname)||!(/^\\/jobs\\/(view|search)\\/?/.test(u.pathname)))return res.sendStatus(400);const p=await page();await p.goto(u.toString(),{waitUntil:'domcontentloaded',timeout:25000});res.json({ok:true})}catch{res.sendStatus(503)}});
  router.post('/scroll',authorized,async(req,res)=>{const delta=Number(req.body.delta);if(delta!==600&&delta!==-600)return res.sendStatus(400);try{const p=await page();await p.mouse.wheel(0,delta);res.json({ok:true})}catch{res.sendStatus(503)}});
  router.post('/click',authorized,async(req,res)=>{try{const x=Number(req.body.x),y=Number(req.body.y);if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>1920||y>1200)return res.sendStatus(400);const p=await page();await p.mouse.click(x,y);res.json({ok:true})}catch{res.sendStatus(503)}});
  router.post('/type',authorized,async(req,res)=>{try{const value=req.body.text;if(typeof value!=='string'||value.length>2000)return res.sendStatus(400);const p=await page();await p.keyboard.insertText(value);res.json({ok:true})}catch{res.sendStatus(503)}});
  router.post('/key',authorized,async(req,res)=>{if(req.body.key!=='Enter')return res.sendStatus(400);try{const p=await page();await p.keyboard.press('Enter');res.json({ok:true})}catch{res.sendStatus(503)}});
  router.post('/close',authorized,(req,res)=>{const sid=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.split('=')[1];if(sid)sessions.delete(sid);res.clearCookie(cookieName,{path:'/auth-browser'});res.json({ok:true})});
  app.use('/auth-browser',router);
}
