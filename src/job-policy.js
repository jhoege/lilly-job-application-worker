export const MINIMUM_REQUEST=120000;
export const QUALIFICATION_TARGET=120000;
export const RANGE_FRACTION=0.75;
export const excludedEmployer=name=>/\b(?:lumino|colorful concrete solutions|evo\s*tech)\b/i.test(String(name||''));
export const verifiedSubmission=status=>/^(?:submitted[ _-]verified|applied[ _-]verified|already applied|interview(?:ing)?|hired)$/i.test(String(status||'').trim());
export const uncertainSubmission=status=>/submission[ _-]unverified|submitted[ _-]unverified/i.test(String(status||''));
export const excludedApplication=status=>/^(?:excluded|closed)(?:\b|[_-])/i.test(String(status||'').trim());
export function annualSalaryRange(text){
 const matches=String(text||'').matchAll(/\$\s*([\d,.]+)\s*(k)?\s*(?:\/\s*(?:yr|year)|per year|annually)?\s*(?:[-–—]|to)\s*\$?\s*([\d,.]+)\s*(k)?\s*(?:\/\s*(?:yr|year)|per year|annually)?/ig);
 for(const m of matches){
  const min=Number(m[1].replace(/,/g,''))*(m[2]?1000:1),max=Number(m[3].replace(/,/g,''))*(m[4]?1000:1);
  const tail=String(text).slice(m.index+m[0].length,m.index+m[0].length+25);
  if(/hour|month|week/i.test(tail)||min<40000||max>2000000||max<min)continue;
  return {min,max};
 }
 return null;
}

