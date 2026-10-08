import test from 'node:test';
import assert from 'node:assert/strict';
import {comparableTitle,comparableBaseline,salaryChoice} from '../src/salary-research.js';
import {salaryRequest} from '../src/application-support.js';
import {annualSalaryRange} from '../src/job-policy.js';
test('comparable research uses independent evidenced ranges and excludes different seniority',()=>{
 assert.equal(comparableTitle('VP - Operations','Vice President of Operations'),true);
 assert.equal(comparableTitle('VP - Operations','Director of Operations'),false);
 assert.equal(comparableTitle('Director of Quality','Director of Marketing'),false);
 const samples=[{url:'a',range:{min:140000,max:200000}},{url:'b',range:{min:160000,max:220000}}];
 const baseline=comparableBaseline(samples);assert.equal(baseline.min,150000);assert.equal(baseline.max,210000);assert.equal(salaryRequest(baseline).amount,195000);
 assert.equal(comparableBaseline([samples[0],samples[0]]),null);
});
test('salary policy enters a containing choice only when unambiguous',()=>{
 const options=[{label:'$150,000 - $200,000',value:'a'},{label:'$200,001 - $250,000',value:'b'}];
 assert.equal(salaryChoice(options,227200).value,'b');
 assert.equal(salaryChoice([{label:'$200,000+',value:'c'}],227200).value,'c');
 assert.equal(salaryChoice([...options,{label:'$200,000 - $300,000',value:'d'}],227200),null);
 assert.deepEqual(annualSalaryRange("RRD's current salary range for this role is $156,700 to $250,700 / year."),{min:156700,max:250700});
 assert.equal(salaryRequest({min:156700,max:250700}).amount,227200);
});
