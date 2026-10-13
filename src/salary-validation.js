import {MINIMUM_REQUEST,annualSalaryDetails} from './job-policy.js';
import {salaryRequest} from './application-support.js';
import {salaryChoice} from './salary-research.js';

export const SALARY_VALIDATION_VERSION='posting-base-v1';
const same=(a,b)=>a&&b&&Number(a.min)===Number(b.min)&&Number(a.max)===Number(b.max);
export function validSalaryRange(range){
 return range&&Number.isFinite(Number(range.min))&&Number.isFinite(Number(range.max))&&
  Number(range.min)>=40000&&Number(range.max)>=Number(range.min)&&Number(range.max)<=2000000;
}
export function authoritativeSalary(rows,job){
 const matches=rows.slice(1).filter(r=>String(r[11]||'').match(/linkedin\.com\/jobs\/view\/(\d+)/)?.[1]===String(job.id));
 const ranges=matches.filter(r=>r[7]!==''&&r[7]!=null&&r[8]!==''&&r[8]!=null).map(r=>({min:Number(r[7]),max:Number(r[8]),
  basis:/comparable|salary (?:research|estimate)|researched.*baseline/i.test(String(r[17]||''))&&!/posted base|published base|starting base|fixed base/i.test(String(r[17]||''))?'researched_comparable_range':'posted_range',
  samples:[{url:r[11]}],sourceNotes:String(r[17]||'')}));
 if(ranges.some(r=>!validSalaryRange(r)))throw Error('Salary validation: invalid authoritative salary range');
 if(ranges.some(r=>!same(r,ranges[0])||r.basis!==ranges[0].basis))throw Error('Salary validation: conflicting authoritative job rows');
 return ranges[0]||null;
}
export function resolveSalaryBaseline({description,header='',authoritative=null,recorded=null}){
 const details=annualSalaryDetails(description);
 if(details.status==='unresolved')throw Error('Salary validation: ambiguous or nonannual posting compensation');
 const top=annualSalaryDetails(header);
 if(top.status==='unresolved'&&details.status!=='found')throw Error('Salary validation: ambiguous posting salary header');
 const posted=details.range||(top.status==='found'?top.range:null);
 if(details.range&&top.range&&!same(details.range,top.range))throw Error('Salary validation: posting header and description disagree');
 if(posted&&authoritative?.basis==='posted_range'&&!same(posted,authoritative))throw Error('Salary validation: live posting differs from verified posting range');
 if(posted)return {...posted,basis:'posted_range',validationVersion:SALARY_VALIDATION_VERSION};
 if(authoritative){
  if(!validSalaryRange(authoritative))throw Error('Salary validation: invalid authoritative salary');
  // Verified search evidence remains authoritative when the current posting omits pay.
  return {...authoritative,validationVersion:SALARY_VALIDATION_VERSION};
 }
 // Old worker-generated ranges are not evidence; reuse only ranges validated by this version.
 if(recorded?.validationVersion===SALARY_VALIDATION_VERSION&&validSalaryRange(recorded))return recorded;
 return null;
}
export function validateSalaryTarget(baseline,amount){
 if(!validSalaryRange(baseline))throw Error('Salary validation: reliable salary range required');
 if(Number(baseline.max)<MINIMUM_REQUEST)throw Error('Salary validation: posted base is below minimum');
 const expected=salaryRequest(baseline).amount;
 if(Number(amount)!==expected||expected>Number(baseline.max))throw Error('Salary validation: salary answer conflicts with range');
 return expected;
}
export function desiredSalaryQuestion(label){
 const n=String(label||'').toLowerCase();
 return !/history|previous|prior|current|last|earned/.test(n)&&/(salary|compensation|pay)/.test(n)&&/(desired|expected|expectation|requirement|seeking)/.test(n);
}
export function salaryAnswerMatches(value,target){
 const text=String(value||'').trim();
 const numeric=text.replace(/[$,\s]/g,'');
 if(/^\d+(?:\.\d+)?k?$/i.test(numeric))return Number(numeric.replace(/k$/i,''))*(/k$/i.test(numeric)?1000:1)===Number(target);
 return !!salaryChoice([{label:text,value:text}],Number(target));
}
export function validateSalaryReview(text,target,observed=[]){
 const lines=String(text||'').split(/\n/).map(s=>s.trim()).filter(Boolean);
 const answers=[];
 for(let i=0;i<lines.length;i++)if(desiredSalaryQuestion(lines[i])){
  // Review screens render the question followed by its answer. Never scan unrelated amounts.
  const inline=lines[i].match(/(?:[:?]|USD)\s*(\$?\s*[\d,]+(?:\.\d+)?\s*k?(?:\s*(?:-|–|—|to)\s*\$?\s*[\d,]+\s*k?)?(?:\s*\+)?)\s*$/i)?.[1];
  answers.push({label:lines[i],value:inline||lines[i+1]||''});
 }
 if(answers.some(a=>!salaryAnswerMatches(a.value,target)))throw Error('Salary validation: review salary does not match approved target');
 if(observed.length&&!answers.length)throw Error('Salary validation: salary answer not visible on final review');
 if(observed.some(a=>!salaryAnswerMatches(a.value,target)))throw Error('Salary validation: entered salary does not match approved target');
 return {target:Number(target),observed,review:answers,salaryQuestionPresent:answers.length>0,verifiedAt:new Date().toISOString(),validationVersion:SALARY_VALIDATION_VERSION};
}
