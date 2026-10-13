export const MINIMUM_REQUEST=120000;
export const QUALIFICATION_TARGET=120000;
export const RANGE_FRACTION=0.75;
export const excludedEmployer=name=>/\b(?:lumino|colorful concrete solutions|evo\s*tech)\b/i.test(String(name||''));
export const verifiedSubmission=status=>/^(?:submitted[ _-]verified|applied[ _-]verified|already applied|interview(?:ing)?|hired)$/i.test(String(status||'').trim());
export const uncertainSubmission=status=>/submission[ _-]unverified|submitted[ _-]unverified/i.test(String(status||''));
export const excludedApplication=status=>/^(?:excluded|closed)(?:\b|[_-])/i.test(String(status||'').trim());
// Inputs must contain only the exact posting/compensation card, never the page's main text.
export function annualSalaryDetails(text){
 const source=String(text||'');
 const segments=source.split(/\n|;|(?<=[.!?])\s+(?=[A-Z])/).map(s=>s.trim()).filter(Boolean);
 const candidates=[];let unresolved=false;
 const money='\\$\\s*([\\d,]+(?:\\.\\d+)?)\\s*(k)?';
 const amount=(n,k)=>Number(n.replace(/,/g,''))*(k?1000:1);
 const valid=(min,max)=>min>=40000&&max>=min&&max<=2000000;
 for(let i=0;i<segments.length;i++){
  const line=segments[i];
  const previous=i>0&&/^(?:base |annual |starting |salary |pay |compensation )*(?:salary|pay|compensation|range)\s*:?$/i.test(segments[i-1])?segments[i-1]+' ':'';
  const context=previous+line;
  if(!/\$/.test(line)||!/(?:base|salary|pay|compensation|per year|annually|\/\s*(?:yr|year)|\ba year\b)/i.test(context))continue;
  if(/\b(?:hour(?:ly)?|month(?:ly)?|week(?:ly)?|day|daily)\b/i.test(context)){unresolved=true;continue;}
  const ranges=[...line.matchAll(new RegExp(money+'\\s*(?:\\/\\s*(?:yr|year)|per year|annually)?\\s*(?:[-–—]|to)\\s*\\$?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(k)?','ig'))];
  const consumed=[];
  for(const m of ranges){
   const min=amount(m[1],m[2]||m[4]),max=amount(m[3],m[4]||m[2]);
   consumed.push([m.index,m.index+m[0].length]);
   const before=(previous+line.slice(0,m.index)).split(/\bplus\b|\band\b|[;]/i).at(-1).slice(-100);
   const after=line.slice(m.index+m[0].length).split(/\$|\bplus\b|\band\b/i)[0].slice(0,55);
   const local=before+' '+after;
   if(/bonus|equity|stock|ote|on.target|total (?:cash |annual )?compensation/i.test(local)&&!/(?:base|salary)/i.test(before)){unresolved=true;continue;}
   if(/budget|revenue|sales|assets|funding|p&l/i.test(before))continue;
   if(!/base|salary|pay|compensation|per year|annually|\/\s*(?:yr|year)|\ba year\b/i.test(local))continue;
   if(!valid(min,max)){unresolved=true;continue;}
   const score=/\bbase\b/i.test(before)?3:/salary|pay/i.test(before)?2:1;
   candidates.push({min,max,score});
  }
  for(const m of line.matchAll(new RegExp(money,'ig'))){
   if(consumed.some(([a,b])=>m.index>=a&&m.index<b))continue;
   const before=(previous+line.slice(0,m.index)).split(/\bplus\b|\band\b|[;]/i).at(-1).slice(-100);
   const after=line.slice(m.index+m[0].length).split(/\$|\bplus\b|\band\b/i)[0].slice(0,55);
   if(!/base|salary|(?:starting|annual) pay/i.test(before))continue;
   if(/bonus|equity|stock|ote|total (?:cash |annual )?compensation/i.test(before)&&!/base/i.test(before)){unresolved=true;continue;}
   const n=amount(m[1],m[2]);if(!valid(n,n)){unresolved=true;continue;}
   // An open lower bound is not a complete range; a published cap uses the cap as target.
   if(/from|at least|minimum/i.test(before)||/^\s*(?:\+|or more|and above)/i.test(after)){unresolved=true;continue;}
   candidates.push({min:n,max:n,score:/\bbase\b/i.test(before)?3:2});
  }
 }
 if(!candidates.length)return {status:unresolved?'unresolved':'absent',range:null};
 const highest=Math.max(...candidates.map(c=>c.score));
 const top=candidates.filter(c=>c.score===highest);
 const unique=[...new Map(top.map(c=>[c.min+':'+c.max,{min:c.min,max:c.max}])).values()];
 return unique.length===1?{status:'found',range:unique[0]}:{status:'unresolved',range:null};
}
export function annualSalaryRange(text){return annualSalaryDetails(text).range;}
