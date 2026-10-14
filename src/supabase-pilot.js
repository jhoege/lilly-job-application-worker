import crypto from 'node:crypto';

// Diagnostic only: never changes the active ledger or submits an application.
export async function runSupabasePilot({env=process.env,fetchImpl=fetch}={}) {
  if (env.LILLY_SUPABASE_PILOT !== 'true') return {status:'disabled'};
  const base=env.LILLY_SUPABASE_URL;
  const key=env.LILLY_SUPABASE_SERVICE_KEY;
  if(base!=='https://vjmaaljmdeaetrrogzah.supabase.co'||!key)
    return {status:'needs_configuration'};
  const rpc=async(name,body)=>{
    const r=await fetchImpl(base+'/rest/v1/rpc/'+name,{
      method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
    });
    if(!r.ok) throw Error('Supabase pilot '+name+' HTTP '+r.status);
    return r.json();
  };
  const run=crypto.randomUUID(),prefix='pilot-test:'+run+':';
  const prepared=await rpc('lilly_pilot_prepare',{p_run:run});
  const race=await Promise.all(['worker-a','worker-b'].map(p_owner=>rpc('lilly_pilot_claim',{p_key:prefix+'race',p_owner})));
  const recovery=await rpc('lilly_pilot_claim',{p_key:prefix+'recovery',p_owner:'new-worker'});
  const protectedStates=['submitted','uncertain','submitting','excluded','closed'];
  const protectedResults=await Promise.all(protectedStates.map(state=>rpc('lilly_pilot_claim',{p_key:prefix+state,p_owner:'retry-worker'})));
  const checks={singleClaim:race.filter(x=>x.claimed===true).length===1,
    expiredProcessingRecovered:recovery.claimed===true,
    protectedStatesBlocked:protectedResults.every(x=>x.claimed===false),
    snapshotReadable:prepared.snapshot_records>=47};
  return {status:Object.values(checks).every(Boolean)?'passed':'failed',checks,run};
}

export async function startSupabasePilot(){
  try {const result=await runSupabasePilot();console.log('[supabase-pilot] '+JSON.stringify(result));return result;}
  catch {const result={status:'failed',reason:'database_request_failed'};console.log('[supabase-pilot] '+JSON.stringify(result));return result;}
}
