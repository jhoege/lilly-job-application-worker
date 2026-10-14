import test from 'node:test';
import assert from 'node:assert/strict';
import {runSupabasePilot} from '../src/supabase-pilot.js';
test('disabled pilot does not contact database',async()=>{
  assert.equal((await runSupabasePilot({env:{},fetchImpl:()=>{throw Error('unexpected')}})).status,'disabled');
});
test('pilot refuses unexpected database host',async()=>{
  assert.equal((await runSupabasePilot({env:{LILLY_SUPABASE_PILOT:'true',LILLY_SUPABASE_URL:'https://wrong.example',LILLY_SUPABASE_SERVICE_KEY:'x'},fetchImpl:()=>{throw Error('unexpected')}})).status,'needs_configuration');
});
test('two successful claims fail acceptance check',async()=>{
  const env={LILLY_SUPABASE_PILOT:'true',LILLY_SUPABASE_URL:'https://vjmaaljmdeaetrrogzah.supabase.co',LILLY_SUPABASE_SERVICE_KEY:'test'};
  const fetchImpl=async(url)=>({ok:true,json:async()=>url.endsWith('prepare')?{snapshot_records:47}:{claimed:true}});
  const result=await runSupabasePilot({env,fetchImpl});
  assert.equal(result.status,'failed');assert.equal(result.checks.singleClaim,false);
});
