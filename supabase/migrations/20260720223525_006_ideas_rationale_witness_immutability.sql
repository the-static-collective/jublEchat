/*
# Ideas, Rationale Events, Witness Strength, Immutability Enforcement

## Overview
Introduces ideas as living entities with lifecycle status, rationale as first-class
events, witness strength for provenance clarity, and database-enforced immutability
on the events table.

## New Tables

### `ideas` — the living identity of an evolving concept
- `id` (uuid, PK)
- `title` (text, not null)
- `created_at` (timestamptz)
- `current_version_id` (uuid, FK to artifacts) — the latest accepted version
- `lifecycle_status` (text, default 'active') — 'active' | 'dormant' | 'merged' | 'abandoned'

### `idea_versions` — links artifacts to ideas as ordered versions
- `id` (uuid, PK)
- `idea_id` (uuid, FK to ideas, cascade)
- `artifact_id` (uuid, FK to artifacts, cascade)
- `version_number` (integer)
- `created_at` (timestamptz)

## Modified Tables

### `events` — extended with rationale and witness_strength
- `rationale` (text) — human-readable decision rationale ("Why was this accepted?")
- `source_proposal_id` (uuid) — which proposal triggered this event
- `witness_strength` (integer, default 5) — 5=contemporaneous, 3=reconstructed, 1=imported

## Immutability Enforcement
- REVOKE UPDATE, DELETE on events FROM anon, authenticated
- Create a trigger that raises an exception on any UPDATE or DELETE attempt
- This makes the database itself reject mutation, not just the app

## Security
- RLS on new tables: SELECT open to anon/authenticated, writes to authenticated with owner_id
- owner_id columns with DEFAULT auth.uid()
*/

-- Create ideas table
CREATE TABLE IF NOT EXISTS ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  created_at timestamptz DEFAULT now(),
  current_version_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
  lifecycle_status text NOT NULL DEFAULT 'active',
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_ideas" ON ideas;
CREATE POLICY "anon_select_ideas" ON ideas FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_ideas" ON ideas;
CREATE POLICY "auth_insert_ideas" ON ideas FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "auth_update_ideas" ON ideas;
CREATE POLICY "auth_update_ideas" ON ideas FOR UPDATE
  TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "auth_delete_ideas" ON ideas;
CREATE POLICY "auth_delete_ideas" ON ideas FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);

-- Create idea_versions table
CREATE TABLE IF NOT EXISTS idea_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(idea_id, version_number)
);

ALTER TABLE idea_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_idea_versions" ON idea_versions;
CREATE POLICY "anon_select_idea_versions" ON idea_versions FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_idea_versions" ON idea_versions;
CREATE POLICY "auth_insert_idea_versions" ON idea_versions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "auth_update_idea_versions" ON idea_versions;
CREATE POLICY "auth_update_idea_versions" ON idea_versions FOR UPDATE
  TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "auth_delete_idea_versions" ON idea_versions;
CREATE POLICY "auth_delete_idea_versions" ON idea_versions FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);

-- Extend events with rationale, source_proposal_id, witness_strength
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'rationale') THEN
    ALTER TABLE events ADD COLUMN rationale text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'source_proposal_id') THEN
    ALTER TABLE events ADD COLUMN source_proposal_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'witness_strength') THEN
    ALTER TABLE events ADD COLUMN witnessitness integer NOT NULL DEFAULT 5;
  END IF;
END $$;

-- Fix column name if typo occurred
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'witnessitness') THEN
    ALTER TABLE events RENAME COLUMN witnessitness TO witness_strength;
  END IF;
END $$;

-- Set witness_strength default
DO $$ BEGIN
  ALTER TABLE events ALTER COLUMN witness_strength SET DEFAULT 5;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Update existing events: backfilled events get witness_strength = 3 (reconstructed)
-- Real-time events written by the app get witness_strength = 5 (contemporaneous)
UPDATE events SET witness_strength = 3 WHERE witness_strength = 5 AND created_at < now() - interval '1 minute';

-- Immutability enforcement: trigger that blocks UPDATE and DELETE on events
CREATE OR REPLACE FUNCTION block_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'events table is append-only: UPDATE and DELETE are not permitted';
END;
$$;

DROP TRIGGER IF EXISTS events_no_update ON events;
CREATE TRIGGER events_no_update
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION block_event_mutation();

DROP TRIGGER IF EXISTS events_no_delete ON events;
CREATE TRIGGER events_no_delete
  BEFORE DELETE ON events
  FOR EACH ROW
  EXECUTE FUNCTION block_event_mutation();

-- Revoke UPDATE and DELETE privileges from anon and authenticated
REVOKE UPDATE, DELETE ON events FROM anon, authenticated;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ideas_current_version ON ideas(current_version_id);
CREATE INDEX IF NOT EXISTS idx_ideas_lifecycle ON ideas(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_idea_versions_idea ON idea_versions(idea_id);
CREATE INDEX IF NOT EXISTS idx_idea_versions_artifact ON idea_versions(artifact_id);
CREATE INDEX IF NOT EXISTS idx_events_witness ON events(witness_strength);
CREATE INDEX IF NOT EXISTS idx_events_rationale ON events(rationale) WHERE rationale IS NOT NULL;
