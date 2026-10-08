import test from 'node:test';
import assert from 'node:assert/strict';
import {exportResumePacket} from '../src/resume-packet.js';
const job={id:'4475816066',resumeVersion:'Role-specific tailored resume: https://docs.google.com/document/d/approved_packet/edit'};
test('exports the exact approved document and rejects unreadable or non-PDF resume responses',async()=>{
 const calls=[];
 const fetcher=async url=>{calls.push(url);return calls.length===1?{ok:true,json:async()=>({name:'Lunova tailored resume',mimeType:'application/vnd.google-apps.document'})}:{ok:true,arrayBuffer:async()=>Buffer.from('%PDF-'+'.'.repeat(2500))}};
 const packet=await exportResumePacket(job,{getToken:async()=> 'test-token',fetcher});
 assert.equal(packet.sourceId,'approved_packet');assert.match(packet.name,/^Lilly-4475816066-[0-9a-f]{12}\.pdf$/);assert.ok(calls.every(u=>u.includes('/approved_packet')));
 await assert.rejects(exportResumePacket(job,{getToken:async()=> 'test-token',fetcher:async()=>({ok:false,status:403})}),/HTTP 403/);
 await assert.rejects(exportResumePacket({...job,resumeVersion:'https://example.com/resume.pdf'}),/no supported Drive/);
});
