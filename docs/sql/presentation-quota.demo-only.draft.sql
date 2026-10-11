BEGIN;

CREATE TABLE public.presentation_quota (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id),
  chat_count integer NOT NULL DEFAULT 0 CHECK (chat_count BETWEEN 0 AND 20),
  manual_count integer NOT NULL DEFAULT 0 CHECK (manual_count BETWEEN 0 AND 2),
  last_operation_at timestamptz,
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.presentation_quota ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.presentation_quota FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.reserve_presentation_operation(
  p_store_id uuid,
  p_user_id uuid,
  p_operation text,
  p_expires_at timestamptz,
  p_manual_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  quota public.presentation_quota%ROWTYPE;
  current_time_value timestamptz;
BEGIN
  IF p_operation NOT IN ('chat', 'manual') OR p_expires_at IS NULL THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('presentation:' || p_store_id::text, 0));
  current_time_value := pg_catalog.clock_timestamp();
  IF p_expires_at <= current_time_value THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.store_memberships
    WHERE user_id = p_user_id AND store_id = p_store_id AND status = 'approved'
      AND role = CASE WHEN p_operation = 'chat' THEN 'staff' ELSE 'owner' END
  ) THEN RETURN false; END IF;
  IF p_manual_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.manuals WHERE id = p_manual_id AND store_id = p_store_id AND category = 'PRESENTATION'
  ) THEN RETURN false; END IF;
  IF p_conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversations WHERE id = p_conversation_id AND user_id = p_user_id AND store_id = p_store_id
  ) THEN RETURN false; END IF;
  INSERT INTO public.presentation_quota(store_id, expires_at) VALUES (p_store_id, p_expires_at)
    ON CONFLICT (store_id) DO NOTHING;
  SELECT * INTO quota FROM public.presentation_quota WHERE store_id = p_store_id FOR UPDATE;
  IF quota.expires_at <= current_time_value OR quota.expires_at <> p_expires_at
    OR quota.last_operation_at > current_time_value - INTERVAL '10 seconds'
    OR (p_operation = 'chat' AND quota.chat_count >= 20)
    OR (p_operation = 'manual' AND quota.manual_count >= 2) THEN RETURN false; END IF;
  UPDATE public.presentation_quota SET
    chat_count = chat_count + CASE WHEN p_operation = 'chat' THEN 1 ELSE 0 END,
    manual_count = manual_count + CASE WHEN p_operation = 'manual' THEN 1 ELSE 0 END,
    last_operation_at = current_time_value
  WHERE store_id = p_store_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_presentation_operation(uuid, uuid, text, timestamptz, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_presentation_operation(uuid, uuid, text, timestamptz, uuid, uuid) TO service_role;

COMMIT;