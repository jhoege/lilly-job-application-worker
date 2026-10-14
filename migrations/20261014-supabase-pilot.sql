-- Isolated acceptance-test queue. No live application can be claimed here.
CREATE TABLE IF NOT EXISTS public.lilly_pilot_work_items (
  job_key text PRIMARY KEY CHECK (job_key LIKE 'pilot-test:%'),
  state text NOT NULL CHECK (state IN ('queued','processing','submitting','submitted','uncertain','excluded','closed')),
  owner text,
  lease_until timestamptz,
  generation integer NOT NULL DEFAULT 0
);
ALTER TABLE public.lilly_pilot_work_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lilly_pilot_work_items FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.lilly_pilot_claim(p_key text, p_owner text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item public.lilly_pilot_work_items;
BEGIN
  IF p_key NOT LIKE 'pilot-test:%' OR p_owner IS NULL OR length(p_owner) < 1 THEN
    RAISE EXCEPTION 'Invalid pilot claim';
  END IF;
  UPDATE public.lilly_pilot_work_items
  SET state='processing', owner=p_owner, lease_until=now()+interval '2 minutes', generation=generation+1
  WHERE job_key=p_key AND (state='queued' OR (state='processing' AND lease_until < now()))
  RETURNING * INTO item;
  IF NOT FOUND THEN RETURN jsonb_build_object('claimed',false); END IF;
  RETURN jsonb_build_object('claimed',true,'generation',item.generation);
END;
$$;
REVOKE ALL ON FUNCTION public.lilly_pilot_claim(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lilly_pilot_claim(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.lilly_pilot_prepare(p_run text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_run !~ '^[a-zA-Z0-9-]{1,80}$' THEN RAISE EXCEPTION 'Invalid pilot run'; END IF;
  INSERT INTO public.lilly_pilot_work_items(job_key,state)
  VALUES ('pilot-test:'||p_run||':race','queued'),
    ('pilot-test:'||p_run||':recovery','processing'),
    ('pilot-test:'||p_run||':submitted','submitted'),
    ('pilot-test:'||p_run||':uncertain','uncertain'),
    ('pilot-test:'||p_run||':submitting','submitting'),
    ('pilot-test:'||p_run||':excluded','excluded'),
    ('pilot-test:'||p_run||':closed','closed') ON CONFLICT DO NOTHING;
  UPDATE public.lilly_pilot_work_items SET lease_until=now()-interval '1 minute',owner='old-worker'
  WHERE job_key='pilot-test:'||p_run||':recovery' AND state='processing' AND generation=0;
  RETURN jsonb_build_object('snapshot_records',(SELECT count(*) FROM public.lilly_pilot_applications));
END;
$$;
REVOKE ALL ON FUNCTION public.lilly_pilot_prepare(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lilly_pilot_prepare(text) TO service_role;
