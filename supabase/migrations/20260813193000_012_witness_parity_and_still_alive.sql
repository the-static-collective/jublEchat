/*
# Witness parity and durable Still Alive evidence

Authoritative command handlers sign exact event identities before crossing the database
boundary. The database must persist those same identities and explicit friction arrays
without regenerating IDs/timestamps or weakening the existing concurrency/authority law.
*/

ALTER TABLE public.idea_versions
  ADD COLUMN IF NOT EXISTS preserved_tensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS unresolved_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS abandoned_paths jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.harvest_proposal_v3(
  p_idea_id UUID,
  p_current_artifact_id UUID,
  p_new_artifact_id UUID,
  p_event_id UUID,
  p_event_created_at TIMESTAMPTZ,
  p_version_number INTEGER,
  p_new_title TEXT,
  p_new_content TEXT,
  p_rationale TEXT,
  p_vm_id UUID,
  p_actor_id TEXT,
  p_actor_email TEXT,
  p_idempotency_key TEXT,
  p_expected_last_event_hash TEXT,
  p_computed_hash TEXT,
  p_preserved_tensions JSONB,
  p_unresolved_questions JSONB,
  p_abandoned_paths JSONB
) RETURNS JSONB
SECURITY DEFINER
SET search_path = pg_catalog, public
LANGUAGE plpgsql
AS $$
DECLARE
  v_next_version INTEGER;
  v_current_head_hash TEXT := 'GENESIS_ANCHOR_v0.2';
  v_latest_event RECORD;
  v_result JSONB;
  v_current_version_id UUID;
  v_existing_event RECORD;
  v_payload JSONB;
  v_owner_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(14022026);

  SELECT id, entity_id, payload INTO v_existing_event
  FROM public.events
  WHERE event_type = 'transformation_accepted'
    AND actor_id = p_actor_email
    AND payload->>'idempotency_key' = p_idempotency_key
  LIMIT 1;

  IF v_existing_event.id IS NOT NULL THEN
    SELECT json_build_object(
      'success', true,
      'is_duplicate', true,
      'event_id', v_existing_event.id,
      'hash', v_existing_event.payload->>'_signature_hash',
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

  SELECT current_version_id, owner_id INTO v_current_version_id, v_owner_id
  FROM public.ideas
  WHERE id = p_idea_id
  FOR UPDATE;

  IF v_current_version_id IS NULL THEN
    RAISE EXCEPTION 'IDEA_NOT_FOUND';
  END IF;

  IF v_owner_id IS NOT NULL AND v_owner_id::text != p_actor_id THEN
    RAISE EXCEPTION 'FORBIDDEN_CULTIVATION_RIGHTS';
  END IF;

  IF v_current_version_id != p_current_artifact_id THEN
    RAISE EXCEPTION 'BASE_VERSION_NO_LONGER_CURRENT';
  END IF;

  SELECT * INTO v_latest_event
  FROM public.events
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF v_latest_event IS NOT NULL THEN
    v_current_head_hash := COALESCE(v_latest_event.payload->>'_signature_hash', 'GENESIS_ANCHOR_v0.2');
  END IF;

  IF p_expected_last_event_hash IS NOT NULL AND p_expected_last_event_hash != v_current_head_hash THEN
    RAISE EXCEPTION 'LEDGER_HEAD_CHANGED';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM public.idea_versions
  WHERE idea_id = p_idea_id;

  IF p_version_number != v_next_version THEN
    RAISE EXCEPTION 'VERSION_NUMBER_CHANGED';
  END IF;

  INSERT INTO public.artifacts (
    id, vm_id, title, content, artifact_type, origin, status,
    parent_artifact_id, created_at
  ) VALUES (
    p_new_artifact_id,
    p_vm_id,
    COALESCE(p_new_title, 'Refined version'),
    p_new_content,
    'note',
    'Evolved from previous version',
    'active',
    p_current_artifact_id,
    p_event_created_at
  );

  INSERT INTO public.idea_versions (
    idea_id,
    artifact_id,
    version_number,
    created_at,
    owner_id,
    preserved_tensions,
    unresolved_questions,
    abandoned_paths
  ) VALUES (
    p_idea_id,
    p_new_artifact_id,
    p_version_number,
    p_event_created_at,
    COALESCE(auth.uid(), v_owner_id),
    COALESCE(p_preserved_tensions, '[]'::jsonb),
    COALESCE(p_unresolved_questions, '[]'::jsonb),
    COALESCE(p_abandoned_paths, '[]'::jsonb)
  );

  INSERT INTO public.edges (
    source_artifact_id,
    target_artifact_id,
    edge_type,
    created_at
  ) VALUES (
    p_new_artifact_id,
    p_current_artifact_id,
    'DERIVES_FROM',
    p_event_created_at
  );

  UPDATE public.ideas
  SET current_version_id = p_new_artifact_id
  WHERE id = p_idea_id;

  v_payload := json_build_object(
    'idea_id', p_idea_id,
    'version', p_version_number,
    'parent_artifact_id', p_current_artifact_id,
    'new_artifact_id', p_new_artifact_id,
    'idempotency_key', p_idempotency_key,
    'actor', json_build_object(
      'source', 'authenticated_session',
      'id', p_actor_id,
      'email', p_actor_email
    ),
    'preserved_tensions', COALESCE(p_preserved_tensions, '[]'::jsonb),
    'unresolved_questions', COALESCE(p_unresolved_questions, '[]'::jsonb),
    'abandoned_paths', COALESCE(p_abandoned_paths, '[]'::jsonb),
    '_signature_hash', p_computed_hash
  );

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
    source_proposal_id,
    witness_strength
  ) VALUES (
    p_event_id,
    'transformation_accepted',
    p_new_artifact_id,
    'artifact',
    'human',
    p_actor_email,
    'evolve-idea',
    'v0.4',
    v_payload,
    p_event_created_at,
    p_rationale,
    NULL,
    5
  );

  SELECT json_build_object(
    'success', true,
    'is_duplicate', false,
    'event_id', p_event_id,
    'hash', p_computed_hash,
    'next_version', p_version_number,
    'new_artifact', json_build_object(
      'id', p_new_artifact_id,
      'vm_id', p_vm_id,
      'title', COALESCE(p_new_title, 'Refined version'),
      'content', p_new_content,
      'artifact_type', 'note',
      'origin', 'Evolved from previous version',
      'status', 'active',
      'parent_artifact_id', p_current_artifact_id,
      'created_at', p_event_created_at
    )
  )::jsonb INTO v_result;

  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    SELECT id, entity_id, payload INTO v_existing_event
    FROM public.events
    WHERE event_type = 'transformation_accepted'
      AND actor_id = p_actor_email
      AND payload->>'idempotency_key' = p_idempotency_key
    LIMIT 1;

    IF v_existing_event.id IS NOT NULL THEN
      SELECT json_build_object(
        'success', true,
        'is_duplicate', true,
        'event_id', v_existing_event.id,
        'hash', v_existing_event.payload->>'_signature_hash',
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

    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
END;
$$;

REVOKE ALL ON FUNCTION public.harvest_proposal_v3(
  UUID, UUID, UUID, UUID, TIMESTAMPTZ, INTEGER,
  TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT,
  JSONB, JSONB, JSONB
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.harvest_proposal_v3(
  UUID, UUID, UUID, UUID, TIMESTAMPTZ, INTEGER,
  TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT,
  JSONB, JSONB, JSONB
) FROM anon;
REVOKE ALL ON FUNCTION public.harvest_proposal_v3(
  UUID, UUID, UUID, UUID, TIMESTAMPTZ, INTEGER,
  TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT,
  JSONB, JSONB, JSONB
) FROM authenticated;

CREATE OR REPLACE FUNCTION public.abandon_path_v2(
  p_idea_id UUID,
  p_version_id UUID,
  p_rationale TEXT,
  p_actor_id TEXT,
  p_actor_email TEXT,
  p_expected_last_event_hash TEXT,
  p_computed_hash TEXT,
  p_event_id UUID,
  p_event_created_at TIMESTAMPTZ
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
BEGIN
  PERFORM pg_advisory_xact_lock(14022026);

  SELECT * INTO v_idea
  FROM public.ideas
  WHERE id = p_idea_id
  FOR UPDATE;

  IF v_idea.id IS NULL THEN
    RAISE EXCEPTION 'IDEA_NOT_FOUND';
  END IF;

  IF v_idea.owner_id IS NOT NULL AND v_idea.owner_id::text != p_actor_id THEN
    RAISE EXCEPTION 'FORBIDDEN_CULTIVATION_RIGHTS';
  END IF;

  SELECT * INTO v_version
  FROM public.idea_versions
  WHERE idea_id = p_idea_id AND artifact_id = p_version_id;

  IF v_version.id IS NULL THEN
    RAISE EXCEPTION 'VERSION_DOES_NOT_BELONG_TO_IDEA';
  END IF;

  IF v_idea.current_version_id = p_version_id THEN
    RAISE EXCEPTION 'CANNOT_ABANDON_CURRENT_VERSION';
  END IF;

  SELECT * INTO v_latest_event
  FROM public.events
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF v_latest_event IS NOT NULL THEN
    v_current_head_hash := COALESCE(v_latest_event.payload->>'_signature_hash', 'GENESIS_ANCHOR_v0.2');
  END IF;

  IF p_expected_last_event_hash IS NOT NULL AND p_expected_last_event_hash != v_current_head_hash THEN
    RAISE EXCEPTION 'LEDGER_HEAD_CHANGED';
  END IF;

  v_payload := json_build_object(
    'idea_id', p_idea_id,
    'version_id', p_version_id,
    'version_number', v_version.version_number,
    'actor_kind', 'human',
    'rationale', COALESCE(p_rationale, 'Consciously abandoned sibling path.'),
    'witnessed_at', p_event_created_at,
    'actor', json_build_object(
      'source', 'authenticated_session',
      'id', p_actor_id,
      'email', p_actor_email
    ),
    '_signature_hash', p_computed_hash
  );

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
    source_proposal_id,
    witness_strength
  ) VALUES (
    p_event_id,
    'path_abandoned',
    p_version_id,
    'artifact',
    'human',
    p_actor_email,
    'abandon-path',
    'v0.4',
    v_payload,
    p_event_created_at,
    p_rationale,
    NULL,
    5
  );

  RETURN json_build_object(
    'success', true,
    'event_id', p_event_id,
    'hash', p_computed_hash
  )::jsonb;
END;
$$;

REVOKE ALL ON FUNCTION public.abandon_path_v2(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.abandon_path_v2(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ
) FROM anon;
REVOKE ALL ON FUNCTION public.abandon_path_v2(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ
) FROM authenticated;


-- These RPCs are server-only. Client roles were revoked above; grant the
-- server-side Supabase role explicitly instead of relying on project defaults.
GRANT EXECUTE ON FUNCTION public.harvest_proposal_v3(
  UUID, UUID, UUID, UUID, TIMESTAMPTZ, INTEGER,
  TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT,
  JSONB, JSONB, JSONB
) TO service_role;

GRANT EXECUTE ON FUNCTION public.abandon_path_v2(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ
) TO service_role;
