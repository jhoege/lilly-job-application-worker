import test from 'node:test';
import assert from 'node:assert/strict';
import {postingHtml,capturePostingPdf} from '../src/posting-pdf.js';
const job={id:'4470079202',company:'Lyra Health',title:'Director Operations',url:'https://www.linkedin.com/jobs/view/4470079202/'};
test('header-only captures fail closed; original text is preserved and escaped',()=>{
 assert.throws(()=>postingHtml({job,description:'Job header only'}),/Full job description unavailable/);
 const text='Responsibilities & qualifications <script>not executable</script>\n'.repeat(30)+'FINAL REQUIREMENT';
 const html=postingHtml({job,description:text,header:'$134K/yr - $184K/yr',capturedAt:'2026-10-08T20:00:00Z'});
 assert.ok(html.includes('FINAL REQUIREMENT'));
 assert.ok(html.includes('&lt;script&gt;not executable&lt;/script&gt;'));
 assert.ok(!html.includes('<script>'));
 assert.ok(html.includes('$134K/yr - $184K/yr'));
 assert.ok(html.includes(job.url));
});
test('PDF renders the full extracted description on a separate page rather than printing a clipped LinkedIn viewport',async()=>{
 let rendered='',closed=false;
 const text='Responsibilities\n'.repeat(100)+'LAST REQUIREMENT';
 const printPage={setContent:async html=>{rendered=html},pdf:async()=>Buffer.from('PDF'),close:async()=>{closed=true}};
 const description={waitFor:async()=>{},textContent:async()=>text};
 const expand={filter(){return this},first(){return this},isVisible:async()=>false};
 const header={innerText:async()=>'$134K/yr - $184K/yr'};
 const page={locator:selector=>selector.includes('.jobs-description__content')?{first:()=>description}:selector.includes('button')?expand:{first:()=>header},context:()=>({newPage:async()=>printPage}),pdf:async()=>{throw Error('Clipped page must not be printed')}};
 assert.equal((await capturePostingPdf(page,job)).toString(),'PDF');
 assert.ok(rendered.includes('LAST REQUIREMENT'));assert.equal(closed,true);
});
