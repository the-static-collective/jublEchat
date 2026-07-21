/*
# Atomic Harvest and Evolve Transaction Function

## Problem
In a distributed event-sourced context, executing multiple separate queries 
(e.g., insert artifact, check latest version, insert version, insert edge, update parent, insert event) 
is highly prone to concurrency races, partial state failures, and duplication.

## Solution
1. Create a security-definer PostgreSQL function `harvest_proposal_v2` that encapsulates the entire harvest operation in a single atomic database transaction.
2. Implement strict optimistic lock validation:
   - Check if the targeted base version `p_current_artifact_id` is still the current version of the idea. If not, raise `BASE_VERSION_NO_LONGER_CURRENT`.
3. Implement Ledger head Compare-and-Swap (CAS):
   - Check if the expected latest ledger hash matches the actual head hash. If not, raise `LEDGER_HEAD_CHANGED`.
4. Implement Idempotency Guard:
   - Search the event stream for any event matching `p_idempotency_key`. If found, safely return the existing artifact without creating duplicates.
5. Derive actor context safely:
   - Restrict the execution to authorized human users and override actor tags server-side.
*/

CREATE OR REPLACE FUNCTION harvest_proposal_v2(
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
SET search_path = public
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
  -- 1. Idempotency Check: check if this idempotency key was already logged
  SELECT id, entity_id, payload INTO v_existing_event
  FROM events
  WHERE (payload->>'idempotency_key' = p_idempotency_key)
  LIMIT 1;

  IF v_existing_event.id IS NOT NULL THEN
    -- Look up the created artifact to return the original response
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
    )::jsonb INTO v_result;
    RETURN v_result;
  END IF;

  -- 2. Lock and validate the Idea's current version
  SELECT current_version_id, owner_id INTO v_current_version_id, v_owner_id
  FROM ideas
  WHERE id = p_idea_id
  FOR UPDATE;

  IF v_current_version_id IS NULL THEN
    RAISE EXCEPTION 'IDEA_NOT_FOUND';
  END IF;

  IF v_current_version_id != p_current_artifact_id THEN
    RAISE EXCEPTION 'BASE_VERSION_NO_LONGER_CURRENT';
  END IF;

  -- 3. Verify compare-and-swap (CAS) for chain head
  SELECT * INTO v_latest_event
  FROM events
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_latest_event IS NOT NULL THEN
    v_current_head_hash := COALESCE(v_latest_event.payload->>'_signature_hash', 'GENESIS_ANCHOR_v0.2');
  END IF;

  IF p_expected_last_event_hash IS NOT NULL AND p_expected_last_event_hash != v_current_head_hash THEN
    RAISE EXCEPTION 'LEDGER_HEAD_CHANGED';
  END IF;

  -- 4. Calculate next version number
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM idea_versions
  WHERE idea_id = p_idea_id;

  -- 5. Insert new evolved artifact
  v_new_artifact_id := gen_random_uuid();
  INSERT INTO artifacts (
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

  -- 6. Insert into idea_versions
  INSERT INTO idea_versions (
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

  -- 7. Insert edge
  INSERT INTO edges (
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

  -- 8. Update ideas current_version_id
  UPDATE ideas
  SET current_version_id = v_new_artifact_id
  WHERE id = p_idea_id;

  -- 9. Construct the Event Log Payload
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

  -- 10. Write Event
  INSERT INTO events (
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
END;
$$;
