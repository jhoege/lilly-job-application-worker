CREATE TABLE IF NOT EXISTS public.lilly_job_claims (
  job_key text PRIMARY KEY,
  state text NOT NULL CHECK(state IN ('queued','processing','submitting','submitted','uncertain','excluded','closed')),
  owner_token text,
  lease_until timestamptz,
  generation integer NOT NULL DEFAULT 0,
  last_outcome text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lilly_job_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lilly_job_claims FROM anon, authenticated;

-- Preserve imported protected history without changing original ledger records.
INSERT INTO public.lilly_job_claims(job_key,state,last_outcome)
SELECT record_key,CASE WHEN status ~* '^(submitted|applied|already applied|interview|hired)' THEN 'submitted'
 WHEN status ~* '^(excluded)' THEN 'excluded'
 WHEN status ~* '^(closed|expired)' THEN 'closed' ELSE 'uncertain' END,status
FROM public.lilly_pilot_applications
WHERE job_id IS NOT NULL AND status ~* '^(submitted|applied|already applied|interview|hired|excluded|closed|expired)|submission.unverified'
ON CONFLICT(job_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.lilly_job_claim(p_key text,p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.lilly_job_claims;
BEGIN
 IF p_key !~ '^(linkedin:[0-9]{8,12}|indeed:[a-zA-Z0-9_-]{1,100}|claim-test:[a-zA-Z0-9:-]{1,100})$'
 OR p_token IS NULL OR length(p_token)<20 THEN RAISE EXCEPTION 'Invalid claim'; END IF;
 INSERT INTO public.lilly_job_claims(job_key,state) VALUES(p_key,'queued') ON CONFLICT DO NOTHING;
 UPDATE public.lilly_job_claims SET state='processing',owner_token=p_token,
 lease_until=now()+interval '10 minutes',generation=generation+1,updated_at=now()
 WHERE job_key=p_key AND (state='queued' OR (state='processing' AND lease_until<now())) RETURNING * INTO item;
 IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false); END IF;
 RETURN jsonb_build_object('claimed',true,'generation',item.generation);
END; $$;

CREATE OR REPLACE FUNCTION public.lilly_job_transition(p_key text,p_token text,p_action text,p_outcome text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed integer;
BEGIN
 IF p_action='renew' THEN
  UPDATE public.lilly_job_claims SET lease_until=now()+interval '10 minutes',updated_at=now()
  WHERE job_key=p_key AND owner_token=p_token AND state='processing' AND lease_until>now();
 ELSIF p_action='begin_submit' THEN
  UPDATE public.lilly_job_claims SET state='submitting',lease_until=NULL,updated_at=now()
  WHERE job_key=p_key AND owner_token=p_token AND state='processing' AND lease_until>now();
 ELSIF p_action='finish' THEN
  UPDATE public.lilly_job_claims SET state=CASE
    WHEN p_outcome IN ('submitted_verified','already_applied_logged') THEN 'submitted'
    WHEN state='submitting' OR p_outcome='submission_unverified' THEN 'uncertain'
    WHEN p_outcome IN ('excluded_employer','excluded_qualification','skipped_excluded') THEN 'excluded'
    WHEN p_outcome='closed' THEN 'closed' ELSE 'queued' END,
    last_outcome=left(p_outcome,100),lease_until=NULL,updated_at=now()
  WHERE job_key=p_key AND owner_token=p_token AND
    (state='submitting' OR (state='processing' AND lease_until>now()));
 ELSE RAISE EXCEPTION 'Unknown transition'; END IF;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN jsonb_build_object('ok',changed=1);
END; $$;
REVOKE ALL ON FUNCTION public.lilly_job_claim(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lilly_job_transition(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lilly_job_claim(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lilly_job_transition(text,text,text,text) TO service_role;
