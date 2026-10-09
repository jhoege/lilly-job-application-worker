import {createCalendarTickets} from './calendar-tickets.js';
import {createDriveOAuth} from './drive-oauth.js';
import {serviceCalendarToken} from './google-answers.js';
export const CALENDAR_SCOPE='https://www.googleapis.com/auth/calendar.readonly';
export const calendarOAuth=createDriveOAuth({scope:CALENDAR_SCOPE,identity:'calendar'});
const CONNECT='https://lilly-job-worker-app-production.up.railway.app/auth-browser';
const tickets=createCalendarTickets();
export function calendarConnectLink(){
 const ticket=tickets.create();
 return 'https://lilly-job-worker-app-production.up.railway.app/integrations/calendar/connect?ticket='+ticket;
}
export function mountCalendarConnect(app){
 const valid=ticket=>tickets.valid(ticket);
 app.get('/integrations/calendar/connect',(req,res)=>{
  res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');res.set('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'");
  if(!valid(req.query.ticket))return res.status(410).type('text').send('This connection link expired. Text CALENDAR CONNECT to Lilly for a new link.');
  res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Lilly calendar</title></head><body><h1>Connect Google Calendar to Lilly</h1><p>Allow Lilly to read meeting times, locations, addresses and video links for your SMS questions.</p><form method="post"><input type="hidden" name="ticket" value="'+req.query.ticket+'"><button type="submit">Connect Google Calendar (read only)</button></form></body></html>');
 });
 app.post('/integrations/calendar/connect',async(req,res)=>{
  if(!valid(req.body?.ticket))return res.status(410).type('text').send('Connection link expired. Text CALENDAR CONNECT for a new link.');
  const json=res.json.bind(res);res.json=body=>body.authorizationUrl?res.redirect(303,body.authorizationUrl):json(body);
  calendarOAuth.start(req,res);
 });
}
async function api(token,path,params={}){
 const u=new URL('https://www.googleapis.com/calendar/v3/'+path);
 for(const [k,v]of Object.entries(params))u.searchParams.set(k,String(v));
 const r=await fetch(u,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error('Calendar read HTTP '+r.status);
 return r.json();
}
export async function calendarConnection(){
 try{
  const token=await calendarOAuth.accessToken();
  const data=await api(token,'users/me/calendarList',{maxResults:100});
  return {connected:true,token,calendars:data.items||[],source:'Google',mode:'oauth'};
 }catch{
  try{
   const id=process.env.GOOGLE_CALENDAR_ID||'jhoege3288@gmail.com',token=await serviceCalendarToken();
   const calendar=await api(token,'calendars/'+encodeURIComponent(id));
   return {connected:true,token,calendars:[calendar],source:'Google',mode:'shared'};
  }catch{return {connected:false,source:'Google',connectUrl:CONNECT};}
 }
}
export async function calendarStatus(_req,res){
 const c=await calendarConnection();
 res.json({connected:c.connected,source:c.source,mode:c.mode,calendars:c.calendars?.map(x=>({id:x.id,name:x.summary})),connectUrl:CONNECT,outlookConnected:false});
}
export function calendarQuery(text,now=new Date()){
 const n=String(text||'').trim(),days=/tomorrow/i.test(n)?1:0;
 // Use local date boundaries with the Chicago DST offset for the requested date.
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const iso=n.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
 const date=new Date((iso||today)+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);
 const ymd=date.toISOString().slice(0,10);
 const short=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',timeZoneName:'shortOffset'}).formatToParts(date).find(x=>x.type==='timeZoneName').value;
 const hours=Number(short.replace('GMT',''))||0,offset=(hours<0?'-':'+')+String(Math.abs(hours)).padStart(2,'0')+':00';
 const start=new Date(ymd+'T00:00:00'+offset),end=new Date(start);
 end.setUTCDate(end.getUTCDate()+(/week/i.test(n)?7:/next|upcoming/i.test(n)?14:1));
 const explicit=n.match(/(?:address|location|details|meeting|appointment)\s+(?:of|for|with)\s+(.+?)(?:\s+(?:today|tomorrow|this week|on 20\d{2}-\d{2}-\d{2})|[?!.]|$)/i)?.[1]?.trim();
 const q=explicit&&!/^(my|the|next|upcoming)\b/i.test(explicit)?explicit:'';
 if(q&&!/today|tomorrow|week|20\d{2}-\d{2}-\d{2}/i.test(n))end.setUTCDate(start.getUTCDate()+14);
 return {timeMin:start.toISOString(),timeMax:end.toISOString(),q};
}
export async function calendarReply(text){
 if(/^calendar\s+connect$/i.test(String(text||'').trim()))return 'Connect Google Calendar to Lilly (read only): '+calendarConnectLink()+' This link expires in 10 minutes. Outlook is not connected to SMS yet.';
 const c=await calendarConnection();
 if(!c.connected)return 'Lilly calendar: Google authorization is needed. Text CALENDAR CONNECT for a secure connection link. Outlook is not connected to SMS yet.';
 if(/^(?:calendar\s+)?status$/i.test(String(text||'').trim()))return 'Lilly calendar: Google live access is connected ('+c.calendars.length+' calendars). Outlook is not connected to SMS.';
 const query=calendarQuery(text),events=[],failures=[];
 await Promise.all(c.calendars.filter(x=>!/#holiday@/.test(x.id)).slice(0,20).map(async cal=>{
  try{
   const data=await api(c.token,'calendars/'+encodeURIComponent(cal.id)+'/events',{...query,singleEvents:true,orderBy:'startTime',maxResults:100});
   for(const e of data.items||[])if(e.status!=='cancelled')events.push({...e,calendar:cal.summary});
  }catch{failures.push(cal.summary||cal.id);}
 }));
 if(failures.length)return 'Lilly calendar: some calendars could not be read. No complete schedule can be reported. Try again or check calendar access.';
 events.sort((a,b)=>String(a.start?.dateTime||a.start?.date).localeCompare(String(b.start?.dateTime||b.start?.date)));
 const format=e=>{
  const when=e.start?.dateTime?new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(e.start.dateTime)):e.start?.date+' all day';
  const join=e.hangoutLink||e.conferenceData?.entryPoints?.find(x=>x.entryPointType==='video')?.uri;
  return when+' — '+(e.summary||'Untitled event')+'; Location: '+(e.location||'not provided')+(join?'; Join: '+join:'');
 };
 const body=events.length?events.slice(0,5).map(format).join('\n')+(events.length>5?'\n+'+(events.length-5)+' more events. Ask for a specific meeting.':''):'No matching Google calendar events in the requested period.';
 return (body+'\nGoogle live read. Outlook calendar is not connected to SMS.').slice(0,1500);
}
