// Standing user rule: the next Monday after applying, plus three weeks.
export function applicationStartDate(now=new Date(),format='us'){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const value=type=>Number(parts.find(p=>p.type===type).value);
 const date=new Date(Date.UTC(value('year'),value('month')-1,value('day')));
 const daysToMonday=(8-date.getUTCDay())%7||7;
 date.setUTCDate(date.getUTCDate()+daysToMonday+21);
 const iso=date.toISOString().slice(0,10);
 return format==='iso'?iso:iso.slice(5,7)+'/'+iso.slice(8,10)+'/'+iso.slice(0,4);
}
export function startDateQuestion(label){
 const text=String(label||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 if(/previous|prior|current|employment history|end date|graduation|birth/.test(text)||/^(can you|are you|did you|have you)\b/.test(text))return false;
 return /\bstart date\b|\bdate available\b|\bavailability date\b|\bwhen (?:would|could|can|are|will) you (?:be available to |be able to |like to |be available for employment|be available|start|begin)|\bearliest (?:available )?(?:start|date)\b/.test(text);
}
