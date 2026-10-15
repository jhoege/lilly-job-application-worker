import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationStartDate,startDateQuestion} from '../src/start-date.js';
test('next Monday plus three weeks for each application weekday',()=>{
 for(const day of [13,14,15,16,17,18])assert.equal(applicationStartDate(new Date(`2026-10-${day}T12:00:00Z`)),'11/09/2026');
 assert.equal(applicationStartDate(new Date('2026-10-19T12:00:00Z')),'11/16/2026');
});
test('Chicago day boundary, year boundary and date input format',()=>{
 assert.equal(applicationStartDate(new Date('2026-10-19T02:00:00Z'),'iso'),'2026-11-09');
 assert.equal(applicationStartDate(new Date('2026-12-31T12:00:00Z'),'iso'),'2027-01-25');
});
test('only prospective start-date questions use the rule',()=>{
 for(const q of ['Start date (MM/DD/YYYY)','When can you start?','What is your earliest available start date?','Date available','When would you be available to start?'])assert.ok(startDateQuestion(q),q);
 for(const q of ['Current employment start date','Date of birth','Have you started this application?','Are you available for weekend shifts?','Can you start on November 2?','Previous employment start date'])assert.ok(!startDateQuestion(q),q);
});
