import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Only hashes are stored; opening or previewing the link never consumes it.
export function createCalendarTickets({directory=process.env.CALENDAR_CONNECT_TICKET_DIR||'/data/lilly-calendar-tickets',now=Date.now}={}){
 const file=ticket=>path.join(directory,crypto.createHash('sha256').update(ticket).digest('hex')+'.json');
 const valid=ticket=>{
  if(typeof ticket!=='string'||!/^[a-f0-9]{64}$/.test(ticket))return false;
  try{return JSON.parse(fs.readFileSync(file(ticket),'utf8')).until>now()}catch{return false}
 };
 return {
  create(){
   fs.mkdirSync(directory,{recursive:true,mode:0o700});
   fs.chmodSync(directory,0o700);
   for(const name of fs.readdirSync(directory)){
    if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
    const p=path.join(directory,name);
    try{if(JSON.parse(fs.readFileSync(p,'utf8')).until<=now())fs.unlinkSync(p)}catch{}
   }
   const ticket=crypto.randomBytes(32).toString('hex');
   fs.writeFileSync(file(ticket),JSON.stringify({until:now()+10*60*1000}),{mode:0o600,flag:'wx'});
   return ticket;
  },
  valid,
  consume(ticket){
   if(!valid(ticket))return false;
   try{fs.unlinkSync(file(ticket));return true}catch{return false}
  }
 };
}
