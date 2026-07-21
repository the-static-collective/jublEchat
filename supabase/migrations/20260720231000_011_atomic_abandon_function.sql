/*
# Atomic Sibling Path Abandonment Function with Global Concurrency Lock

## Problem
Path abandonment must be command-specific and execute-authoritative.
Rather than allowing direct, client-driven event logging of `path_abandoned` types via the generic endpoint,
we must enforce a dedicated authenticated API `/api/ideas/:ideaId/versions/:versionId/abandon`
which maps directly to a high-privilege secure database RPC `abandon_path_v1`.

This RPC ensures:
1. Concurrency-safe serialization: Uses the same global transaction-level advisory lock (`pg_advisory_xact_lock(14022026)`) as `harvest_proposal_v2` to prevent head-race conflicts.
2. Authenticated user isolation: Validates that the active human actor may cultivate the target idea (ownership matching).
3. Tree-membership check: Confirms the version to abandon actually belongs to the given idea.
4. Active protection: Rejects abandonment of the current version.
5. CAS head validation: Verifies that the chain-head hash hasn't drifted before insertion.
*/

CREATE OR REPLACE FUNCTION public.abandon_path_v1(
  p_idea_id UUID,
  p_version_id UUID,
  p_rationale TEXT,
  p_actor_id TEXT,
  p_actor_email TEXT,
  p_expected_last_event_hash TEXT,
  p_computed_hash TEXT
) RETURNS JSONB
SECURITY DEFINER
SET search_path = pg_catalog, public
LANGUAGE plpgsql
AS $$
DECLARE
  v_idea RECORD;
  v_version RECORD;
  v_latest_event RECORD;
  v_current_head_hash TEXT := 'GENESIS_ANCHOR_v0.2';
  v_payload JSONB;
  v_result JSONB;
  v_event_id UUID := gen_random_uuid();
BEGIN
  -- 1. Guarantee absolute global sequence serialization via transaction-level advisory lock
  -- This blocks concurrent threads from reading/writing the global head hash simultaneously.
  PERFORM pg_advisory_xact_lock(14022026);

  -- 2. Lock and validate the Idea
  SELECT * INTO v_idea
  FROM public.ideas
  WHERE id = p_idea_id
  FOR UPDATE;

  IF v_idea.id IS NULL THEN
    RAISE EXCEPTION 'IDEA_NOT_FOUND';
  END IF;

  -- 3. Verify cultivation rights (ownership validation)
  IF v_idea.owner_id IS NOT NULL AND v_idea.owner_id::text != p_actor_id THEN
    RAISE EXCEPTION 'FORBIDDEN_CULTIVATION_RIGHTS';
  END IF;

  -- 4. Confirm the version belongs to the specified idea
  SELECT * INTO v_version
  FROM public.idea_versions
  WHERE idea_id = p_idea_id AND artifact_id = p_version_id;

  IF v_version.id IS NULL THEN
    RAISE EXCEPTION 'VERSION_DOES_NOT_BELONG_TO_IDEA';
  END IF;

  -- 5. Reject abandonment of the current version
  IF v_idea.current_version_id = p_version_id THEN
    RAISE EXCEPTION 'CANNOT_ABANDON_CURRENT_VERSION';
  END IF;

  -- 6. Verify compare-and-swap (CAS) for chain head
  SELECT * INTO v_latest_event
  FROM public.events
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_latest_event IS NOT NULL THEN
    v_current_head_hash := COALESCE(v_latest_event.payload->>'_signature_hash', 'GENESIS_ANCHOR_v0.2');
  END IF;

  IF p_expected_last_event_hash IS NOT NULL AND p_expected_last_event_hash != v_current_head_hash THEN
    RAISE EXCEPTION 'LEDGER_HEAD_CHANGED';
  END IF;

  -- 7. Construct Event Payload
  v_payload := json_build_object(
    'idea_id', p_idea_id,
    'version_id', p_version_id,
    'version_number', v_version.version_number,
    'actor_kind', 'human',
    'rationale', COALESCE(p_rationale, 'Consciously abandoned sibling path.'),
    'witnessed_at', now(),
    'actor', json_build_object(
      'source', 'authenticated_session',
      'id', p_actor_id,
      'email', p_actor_email
    ),
    '_signature_hash', p_computed_hash
  );

  -- 8. Insert event
  INSERT INTO public.events (
    id,
    event_type,
    entity_id,
    entity_type,
    actor,
    actor_id,
    capability,
    policy,
    payload,
    created_at,
    rationale,
    witness_strength
  ) VALUES (
    v_event_id,
    'path_abandoned',
    p_version_id,
    'artifact',
    'human',
    p_actor_email,
    'abandon-path',
    'v0.4',
    v_payload,
    now(),
    p_rationale,
    5
  );

  -- 9. Return confirmation result
  SELECT json_build_object(
    'success', true,
    'event_id', v_event_id,
    'hash', p_computed_hash
  )::jsonb INTO v_result;

  RETURN v_result;
END;
$$;

-- 10. Revoke execution privileges from standard public role, anon and authenticated
REVOKE ALL ON FUNCTION public.abandon_path_v1(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.abandon_path_v1(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM anon;

REVOKE ALL ON FUNCTION public.abandon_path_v1(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM authenticated;
