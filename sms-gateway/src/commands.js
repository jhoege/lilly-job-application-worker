// Pure command parsing shared by the gateway and worker.
export function parseCommand(body) {
 const text=String(body||'').trim().replace(/^(?:hey\s+)?lilly[,!:]?\s*/i,'');
 const n=text.toLowerCase();
 if(/^answer\b/i.test(text)) {
  const m=text.match(/^answer\s+(Q[A-Za-z0-9-]{1,55})\s+([\s\S]+)$/i);
  return m?{kind:'answer',id:m[1],answer:m[2].trim()}:{kind:'invalid_answer'};
 }
 if(/^(?:jobs?\s+search\s+status|jobs?\s+status)$/i.test(text))return {kind:'job_status'};
 if(/^jobs?\s+(retry|process|apply)(?:\s+(saved|queue|all))?$/i.test(text))return {kind:'job_retry'};
 if(/^jobs?\s+questions?$/i.test(text))return {kind:'job_questions'};
 if(/^jobs?\s+details$/i.test(text))return {kind:'job_details'};
 if(/^jobs?$/i.test(text))return {kind:'job_summary'};
 const explicit=text.match(/^jobs?\s+search(?:\s+([\s\S]*))?$/i);
 const natural=/\b(search|find|look\s+for)\b/i.test(text)&&/\b(jobs?|roles?|openings?|positions?)\b/i.test(text);
 if(explicit||natural) {
  const raw=(explicit?explicit[1]||'':text).trim();
  let role=raw;
  if(natural){
   role=raw.match(/\b(?:senior\s+)?(?:vice\s+president|vp|head|director)\s*(?:of\s+|,\s*)?operations\b/i)?.[0]||raw.match(/\b(?:senior\s+)?director\s+(?:of\s+)?(?:quality|continuous improvement|process improvement|operational excellence)\b/i)?.[0]||'';
   if(!role)return {kind:'invalid_search'};
  }
  const hasRemote=/\bremote\b/i.test(raw),hasLocal=/\bmadison\b|\bdane\s+county\b/i.test(raw);
  const mode=hasRemote&&!hasLocal?'remote':'both';
  role=role.replace(/\b(?:fully\s+)?remote\b/ig,'').replace(/\bmadison(?:\s*,?\s*wi(?:sconsin)?)?\b/ig,'').replace(/\bon\s+linkedin\b/ig,'').replace(/\s+/g,' ').trim();
  return {kind:'job_search',role:role||'VP of Operations',mode};
 }
 if(/^(?:help|status|hello|hi)$/i.test(text))return {kind:n};
 if(/\b(calendar|schedule|appointments?)\b/i.test(text))return {kind:'calendar',text};
 if(/\b(email|emails|inbox|mail)\b/i.test(text))return {kind:'email',text};
 if(/\b(morning briefing|briefing)\b/i.test(text))return {kind:'briefing',text};
 if(/\bpast due\b/i.test(text))return {kind:'past_due'};
 if(/\bdue today\b/i.test(text))return {kind:'due_today'};
 if(/^tasks?$/i.test(text)||/\b(my|open)\s+tasks\b/i.test(text))return {kind:'tasks'};
 if(/\bbills?\b/i.test(text))return {kind:'bills'};
 return {kind:'unknown'};
}
export const isJobCommand=cmd=>cmd.kind.startsWith('job_')||['answer','invalid_answer','invalid_search'].includes(cmd.kind);
