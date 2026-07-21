/*
# Ledger Hardening, Global Concurrency Lock, and Security Definer Protection

## Problem
1. When concurrent harvests target different ideas, per-row locks on the `ideas` table do not protect the global sequence of the single hash chain. Multiple requests can read the same global head hash and attempt to append events with the same parent hash, leading to chain forks.
2. Under-restricted `SECURITY DEFINER` functions expose high-privilege execution paths to ordinary clients through Supabase's auto-generated PostgREST routes.
3. prelim-lookup idempotency checks are susceptible to TOCTOU race conditions where concurrent identical requests can bypass the check and insert duplicates before the first commit.

## Fix
1. Implement a Transaction-Level Advisory Lock (`pg_advisory_xact_lock`) at the start of `harvest_proposal_v2` to serialize all ledger changes globally.
2. Qualify all table references explicitly as `public.<table_name>` and set the secure `search_path = pg_catalog, public`.
3. Revoke all execution privileges on the security-definer function from standard public, `anon`, and `authenticated` roles to block direct client REST invocation.
4. Establish a hard database-level unique index on the actor/idempotency_key pair to prevent concurrency-bypassed duplicates.
*/

-- 1. Create unique expression index for absolute database-level idempotency enforcement
CREATE UNIQUE INDEX IF NOT EXISTS harvest_idempotency_unique
ON public.events (actor_id, (payload->>'idempotency_key'))
WHERE event_type = 'transformation_accepted';

-- 2. Drop and Re-create harvest_proposal_v2 with advanced hardening
DROP FUNCTION IF EXISTS public.harvest_proposal_v2(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.harvest_proposal_v2(
  p_idea_id UUID,
  p_current_artifact_id UUID,
  p_new_title TEXT,
  p_new_content TEXT,
  p_rationale TEXT,
  p_vm_id UUID,
  p_actor_id TEXT,
  p_actor_email TEXT,
  p_idempotency_key TEXT,
  p_expected_last_event_hash TEXT,
  p_computed_hash TEXT
) RETURNS JSONB
SECURITY DEFINER
SET search_path = pg_catalog, public
LANGUAGE plpgsql
AS $$
DECLARE
  v_next_version INTEGER;
  v_new_artifact_id UUID;
  v_current_head_hash TEXT := 'GENESIS_ANCHOR_v0.2';
  v_latest_event RECORD;
  v_result JSONB;
  v_current_version_id UUID;
  v_existing_event RECORD;
  v_payload JSONB;
  v_owner_id UUID;
BEGIN
  -- A. Guarantee absolute global sequence serialization via transaction-level advisory lock
  -- This blocks concurrent threads from reading/writing the global head hash simultaneously.
  PERFORM pg_advisory_xact_lock(14022026);

  -- B. Check for existing idempotency match (for safe network retry replay)
  SELECT id, entity_id, payload INTO v_existing_event
  FROM public.events
  WHERE (payload->>'idempotency_key' = p_idempotency_key)
  LIMIT 1;

  IF v_existing_event.id IS NOT NULL THEN
    SELECT json_build_object(
      'success', true,
      'is_duplicate', true,
      'new_artifact', json_build_object(
        'id', a.id,
        'vm_id', a.vm_id,
        'title', a.title,
        'content', a.content,
        'artifact_type', a.artifact_type,
        'origin', a.origin,
        'status', a.status,
        'parent_artifact_id', a.parent_artifact_id,
        'created_at', a.created_at
      )
    )::jsonb INTO v_result
    FROM public.artifacts a
    WHERE a.id = v_existing_event.entity_id;

    RETURN v_result;
  END IF;

  -- C. Lock and validate the Idea's current version
  SELECT current_version_id, owner_id INTO v_current_version_id, v_owner_id
  FROM public.ideas
  WHERE id = p_idea_id
  FOR UPDATE;

  IF v_current_version_id IS NULL THEN
    RAISE EXCEPTION 'IDEA_NOT_FOUND';
  END IF;

  IF v_current_version_id != p_current_artifact_id THEN
    RAISE EXCEPTION 'BASE_VERSION_NO_LONGER_CURRENT';
  END IF;

  -- D. Verify compare-and-swap (CAS) for chain head
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

  -- E. Calculate next version number
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM public.idea_versions
  WHERE idea_id = p_idea_id;

  -- F. Insert new evolved artifact
  v_new_artifact_id := gen_random_uuid();
  INSERT INTO public.artifacts (
    id,
    vm_id,
    title,
    content,
    artifact_type,
    origin,
    status,
    parent_artifact_id,
    created_at
  ) VALUES (
    v_new_artifact_id,
    p_vm_id,
    COALESCE(p_new_title, 'Refined version'),
    p_new_content,
    'note',
    'Evolved from previous version',
    'active',
    p_current_artifact_id,
    now()
  );

  -- G. Insert into idea_versions
  INSERT INTO public.idea_versions (
    idea_id,
    artifact_id,
    version_number,
    created_at,
    owner_id
  ) VALUES (
    p_idea_id,
    v_new_artifact_id,
    v_next_version,
    now(),
    COALESCE(auth.uid(), v_owner_id)
  );

  -- H. Insert edge
  INSERT INTO public.edges (
    source_artifact_id,
    target_artifact_id,
    edge_type,
    created_at
  ) VALUES (
    v_new_artifact_id,
    p_current_artifact_id,
    'DERIVES_FROM',
    now()
  );

  -- I. Update ideas current_version_id
  UPDATE public.ideas
  SET current_version_id = v_new_artifact_id
  WHERE id = p_idea_id;

  -- J. Construct the Event Log Payload
  v_payload := json_build_object(
    'idea_id', p_idea_id,
    'version', v_next_version,
    'parent_artifact_id', p_current_artifact_id,
    'new_artifact_id', v_new_artifact_id,
    'idempotency_key', p_idempotency_key,
    'actor', json_build_object(
      'source', 'authenticated_session',
      'id', p_actor_id,
      'email', p_actor_email
    ),
    '_signature_hash', p_computed_hash
  );

  -- K. Write Event
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
    gen_random_uuid(),
    'transformation_accepted',
    v_new_artifact_id,
    'artifact',
    'human',
    p_actor_email,
    'evolve-idea',
    'v0.4',
    v_payload,
    now(),
    p_rationale,
    5
  );

  -- Build final result object
  SELECT json_build_object(
    'success', true,
    'is_duplicate', false,
    'next_version', v_next_version,
    'new_artifact', json_build_object(
      'id', v_new_artifact_id,
      'vm_id', p_vm_id,
      'title', COALESCE(p_new_title, 'Refined version'),
      'content', p_new_content,
      'artifact_type', 'note',
      'origin', 'Evolved from previous version',
      'status', 'active',
      'parent_artifact_id', p_current_artifact_id,
      'created_at', now()
    )
  )::jsonb INTO v_result;

  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    -- Fallback handler: if index unique constraint caught parallel idempotency, return original
    SELECT id, entity_id, payload INTO v_existing_event
    FROM public.events
    WHERE (payload->>'idempotency_key' = p_idempotency_key)
    LIMIT 1;

    IF v_existing_event.id IS NOT NULL THEN
      SELECT json_build_object(
        'success', true,
        'is_duplicate', true,
        'new_artifact', json_build_object(
          'id', a.id,
          'vm_id', a.vm_id,
          'title', a.title,
          'content', a.content,
          'artifact_type', a.artifact_type,
          'origin', a.origin,
          'status', a.status,
          'parent_artifact_id', a.parent_artifact_id,
          'created_at', a.created_at
        )
      )::jsonb INTO v_result
      FROM public.artifacts a
      WHERE a.id = v_existing_event.entity_id;

      RETURN v_result;
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
    END IF;
END;
$$;

-- 3. Revoke EXECUTE privileges to block direct client REST invocation
REVOKE ALL ON FUNCTION public.harvest_proposal_v2(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.harvest_proposal_v2(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM anon;

REVOKE ALL ON FUNCTION public.harvest_proposal_v2(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM authenticated;
