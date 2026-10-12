BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

CREATE TABLE public.owner_staff_email_signup_flow_archive (
  request_id uuid PRIMARY KEY,
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text NOT NULL CHECK (reason = 'deleted_auth_resignup'),
  snapshot jsonb NOT NULL
);
ALTER TABLE public.owner_staff_email_signup_flow_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_staff_email_signup_flow_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.owner_staff_email_signup_flow_archive TO service_role;

CREATE FUNCTION public.restart_deleted_owner_staff_email_signup(
  p_email text, p_role text, p_completed_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  target_email text := lower(btrim(p_email));
  old_flow public.owner_staff_email_signup_flows%ROWTYPE;
  current_time_value timestamptz;
  result jsonb;
BEGIN
  IF p_email IS NULL OR p_role IS NULL OR p_completed_user_id IS NULL
    OR p_role NOT IN ('owner', 'staff') OR length(target_email) > 254
    OR target_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RETURN jsonb_build_object('kind', 'unavailable');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_email, 39));
  SELECT * INTO old_flow FROM public.owner_staff_email_signup_flows
    WHERE email = target_email FOR UPDATE;
  current_time_value := pg_catalog.clock_timestamp();
  IF NOT FOUND OR old_flow.completed_at IS NULL
    OR old_flow.completed_user_id IS DISTINCT FROM p_completed_user_id
    OR old_flow.completed_at > current_time_value - INTERVAL '180 seconds'
    OR old_flow.expires_at > current_time_value OR old_flow.available_at > current_time_value THEN
    RETURN jsonb_build_object('kind', 'unavailable');
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(btrim(email)) = target_email
    OR id = old_flow.completed_user_id OR id = old_flow.verified_user_id) THEN
    RETURN jsonb_build_object('kind', 'exists');
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles profile WHERE id IN (old_flow.completed_user_id, old_flow.verified_user_id)
    OR user_id IN (old_flow.completed_user_id, old_flow.verified_user_id)
    OR lower(btrim(pg_catalog.to_jsonb(profile)->>'email')) = target_email)
    OR EXISTS (SELECT 1 FROM public.store_memberships
      WHERE user_id IN (old_flow.completed_user_id, old_flow.verified_user_id)) THEN
    RETURN jsonb_build_object('kind', 'unavailable');
  END IF;
  INSERT INTO public.owner_staff_email_signup_flow_archive(request_id, reason, snapshot)
    VALUES (old_flow.request_id, 'deleted_auth_resignup', pg_catalog.to_jsonb(old_flow));
  UPDATE public.owner_staff_email_signup_flows SET
    role = p_role, sent_at = NULL, verified_user_id = NULL, verified_at = NULL,
    completed_user_id = NULL, completed_at = NULL,
    expires_at = current_time_value, available_at = current_time_value
  WHERE email = target_email;
  result := public.prepare_owner_staff_email_first_signup(target_email, p_role, 'start', NULL, NULL);
  IF result->>'kind' IS DISTINCT FROM 'new' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'RESTART_SIGNUP_RESERVATION_FAILED';
  END IF;
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.restart_deleted_owner_staff_email_signup(text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restart_deleted_owner_staff_email_signup(text,text,uuid) TO service_role;
COMMIT;