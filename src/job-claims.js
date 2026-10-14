import crypto from 'node:crypto';

export async function acquireJobClaim(job,{env=process.env,fetchImpl=fetch}={}){
 if(env.LILLY_JOB_CLAIMS!=='supabase')return {claimed:true,enabled:false,beginSubmit:async()=>{},finish:async()=>{}};
 const base=env.LILLY_SUPABASE_URL,key=env.LILLY_SUPABASE_SERVICE_KEY;
 if(base!=='https://vjmaaljmdeaetrrogzah.supabase.co'||!key)throw Error('Job claim database not configured');
 const id=String(job.id||'');
 if(!/^\d{8,12}$/.test(id))throw Error('Unsupported LinkedIn job identity');
 const jobKey='linkedin:'+id,token=crypto.randomUUID();
 const rpc=async(name,args)=>{
  const r=await fetchImpl(base+'/rest/v1/rpc/'+name,{method:'POST',
   headers:{apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},
   body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('Job claim database HTTP '+r.status);
  return r.json();
 };
 const claimed=await rpc('lilly_job_claim',{p_key:jobKey,p_token:token});
 if(claimed.claimed!==true)return {claimed:false,enabled:true};
 let stopped=false,lost=false,timer=null,renewing=null;
 const transition=(action,outcome='')=>rpc('lilly_job_transition',{p_key:jobKey,p_token:token,p_action:action,p_outcome:outcome});
 const schedule=()=>{timer=setTimeout(()=>{
  if(stopped)return;
  renewing=transition('renew').then(r=>{if(!r.ok)lost=true;}).catch(()=>{lost=true;}).finally(()=>{renewing=null;if(!stopped&&!lost)schedule();});
 },30000);timer.unref();};
 schedule();
 const stop=async()=>{stopped=true;clearTimeout(timer);if(renewing)await renewing;};
 return {claimed:true,enabled:true,
  async beginSubmit(){
   await stop();
   if(lost)throw Error('Job claim lost; submission blocked');
   if(!(await transition('begin_submit')).ok)throw Error('Job claim expired or replaced; submission blocked');
  },
  async finish(outcome){await stop();if(!(await transition('finish',outcome)).ok)throw Error('Job claim outcome not recorded; reconcile before retry');}
 };
}
