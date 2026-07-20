/*
# Jubilee Kernel Transplant: Events + Witness Layer

## Overview
Replaces the database's notion of truth. The artifact tables remain, but an
immutable event log becomes the source of truth. Transformations gain the full
witness primitive (actor, capability, policy, input_hash, output_hash). AI
proposals become first-class artifacts with typed edges to the things they modify.

## New Tables

1. `events` — Immutable append-only event log (the soil)
   - `id` (uuid, PK)
   - `event_type` (text) — 'artifact_created' | 'claim_added' | 'transformation_proposed' | 'transformation_accepted' | 'transformation_rejected' | 'transformation_branched' | 'edge_created' | 'projection_generated' | 'receipt_issued' | 'vm_created'
   - `entity_id` (uuid) — the primary entity this event concerns
   - `entity_type` (text) — 'artifact' | 'transformation' | 'vm' | 'receipt' | 'edge' | 'claim'
   - `actor` (text) — who/what caused the event
   - `actor_id` (text) — specific actor identifier
   - `capability` (text) — what capability was exercised
   - `policy` (text) — under what policy version
   - `payload` (jsonb) — full event data snapshot
   - `created_at` (timestamptz)

2. `proposals` — AI proposals as first-class artifacts with provenance
   - `id` (uuid, PK)
   - `transformation_id` (uuid, FK to transformations)
   - `proposal_artifact_id` (uuid, FK to artifacts) — the proposal IS an artifact
   - `generated_from_artifact_id` (uuid, FK to artifacts) — what generated this proposal
   - `modifies_artifact_id` (uuid, FK to artifacts) — what artifact this proposal modifies
   - `created_at` (timestamptz)

## Modified Tables

### `transformations` — extended with witness fields
   - `actor` (text, default 'ai')
   - `actor_id` (text) — specific actor identifier
   - `capability` (text) — capability exercised
   - `policy` (text) — policy version
   - `input_hash` (text) — hash of input artifact state
   - `output_hash` (text) — hash of output artifact state
   - `witness_note` (text) — human-readable witness statement

## Security
- Single-tenant app. All new tables use `TO anon, authenticated`.
- RLS enabled on all new tables.

## Notes
1. The event log is append-only by convention.
2. Every state-changing operation writes an event.
3. Proposals are artifacts — AI reasoning enters history as a graph node.
4. The witness layer makes every transformation answer: who, what capability, what policy, what input, what output, why.
*/

-- Create events table
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  entity_id uuid,
  entity_type text,
  actor text NOT NULL DEFAULT 'system',
  actor_id text,
  capability text,
  policy text,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_events" ON events;
CREATE POLICY "anon_select_events" ON events FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_events" ON events;
CREATE POLICY "anon_insert_events" ON events FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_events" ON events;
CREATE POLICY "anon_update_events" ON events FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_events" ON events;
CREATE POLICY "anon_delete_events" ON events FOR DELETE
  TO anon, authenticated USING (true);

-- Create proposals table
CREATE TABLE IF NOT EXISTS proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transformation_id uuid NOT NULL REFERENCES transformations(id) ON DELETE CASCADE,
  proposal_artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  generated_from_artifact_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
  modifies_artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_proposals" ON proposals;
CREATE POLICY "anon_select_proposals" ON proposals
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_proposals" ON proposals;
CREATE POLICY "anon_insert_proposals" ON proposals
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_proposals" ON proposals;
CREATE POLICY "anon_update_proposals" ON proposals
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_proposals" ON proposals;
CREATE POLICY "anon_delete_proposals" ON proposals
  FOR DELETE TO anon, authenticated USING (true);

-- Extend transformations with witness fields
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transformations' AND column_name = 'actor') THEN
    ALTER TABLE transformations ADD COLUMN actor text NOT NULL DEFAULT 'ai';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transformations' AND column_name = 'actor_id') THEN
    ALTER TABLE transformations ADD COLUMN actor_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transformations' AND column_name = 'capability') THEN
    ALTER TABLE transformations ADD COLUMN capability text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transformations' AND column_name = 'policy') THEN
    ALTER TABLE transformations ADD COLUMN policy text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transformations' AND column_name = 'input_hash') THEN
    ALTER TABLE transformations ADD COLUMN input_hash text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transformations' AND column_name = 'output_hash') THEN
    ALTER TABLE transformations ADD COLUMN output_hash text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transformations' AND column_name = 'witness_note') THEN
    ALTER TABLE transformations ADD COLUMN witness_note text;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_proposals_transformation ON proposals(transformation_id);
CREATE INDEX IF NOT EXISTS idx_proposals_artifact ON proposals(proposal_artifact_id);
CREATE INDEX IF NOT EXISTS idx_proposals_modifies ON proposals(modifies_artifact_id);
