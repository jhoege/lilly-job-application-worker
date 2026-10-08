import test from 'node:test';
import assert from 'node:assert/strict';
import {salaryRequest,getQueue} from '../src/application-support.js';

test('75% of listed range, with $120k floor',()=>{
 assert.deepEqual(salaryRequest({min:100000,max:200000}),{amount:175000,basis:'advertised_range'});
 assert.deepEqual(salaryRequest({min:134000,max:184000}),{amount:171500,basis:'advertised_range'});
 assert.deepEqual(salaryRequest({min:160000,max:175000}),{amount:171250,basis:'advertised_range'});
 assert.deepEqual(salaryRequest({min:90000,max:110000}),{amount:120000,basis:'advertised_range'});
});
test('market salary and missing salary respect minimum',()=>{
 assert.deepEqual(salaryRequest({market:156000}),{amount:156000,basis:'market_data'});
 assert.deepEqual(salaryRequest({market:95000}),{amount:120000,basis:'market_data'});
 assert.deepEqual(salaryRequest({}),{amount:120000,basis:'no_reliable_data'});
});
test('already submitted or closed jobs are excluded before browser navigation',()=>{
 const jobs=getQueue();
 assert.ok(jobs.length>0);
 assert.equal(jobs.some(j=>j.id==='4474252598'),false);
 assert.equal(jobs.some(j=>j.id==='4470470211'),false);
 assert.equal(jobs.some(j=>j.id==='4468916221'),false);
 assert.equal(jobs.some(j=>j.id==='4476780525'),false);
 assert.equal(jobs.some(j=>j.id==='4474499407'),false);
 assert.ok(jobs.some(j=>j.id==='4470079202'&&j.salaryRequest===171500));
});


