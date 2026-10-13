import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('optional top-choice checkbox does not inherit a sibling email requirement',async()=>{
 const source=fs.readFileSync(new URL('../src/queue-triage.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
 const wrapper={querySelector:()=>({innerText:'Email*'})};
 const attrs={'aria-label':'Mark job as a top choice'};
 const checkbox={type:'checkbox',tagName:'INPUT',required:false,checked:false,name:'',labels:[],value:'on',
  getClientRects:()=>[{}],getAttribute:key=>attrs[key]||null,setAttribute:()=>{},removeAttribute:()=>{},
  closest:selector=>selector.includes('fb-dash')?wrapper:null};
 const email={...checkbox,type:'email',labels:[{innerText:'Email*'}],value:'test@example.invalid',getAttribute:()=>null};
 const parent={innerText:'Email*\nMark job as a top choice',querySelectorAll:()=>[email,checkbox]};
 const buttons=[{innerText:'Submit application',getAttribute:()=>null},{innerText:'Upload resume',getAttribute:()=>null}];
 const dialog={classList:{contains:()=>true},getClientRects:()=>[{}],removeAttribute:()=>{},setAttribute:()=>{},
  querySelector:()=>({innerText:'Apply to employer'}),innerText:'Contact info\nEmail*\nResume',
  querySelectorAll:selector=>selector==='button'?buttons:selector.includes('data-lilly-field')?[]:[email,checkbox]};
 parent.parentElement=dialog;checkbox.parentElement=parent;email.parentElement=parent;
 const sandbox={document:{querySelectorAll:()=>[dialog],getElementById:()=>null},window:{getComputedStyle:()=>({visibility:'visible',display:'block'})},console,process:{env:{}}};
 vm.createContext(sandbox);vm.runInContext(source+'\nglobalThis.inspect=fieldsOnPage;',sandbox);
 const fields=await sandbox.inspect({evaluate:async fn=>fn()});
 assert.equal(fields[0].label,'Email');assert.equal(fields[0].required,true);
 assert.equal(fields[1].label,'Mark job as a top choice');assert.equal(fields[1].required,false);
 checkbox.required=true;
 assert.equal((await sandbox.inspect({evaluate:async fn=>fn()}))[1].required,true);
});
