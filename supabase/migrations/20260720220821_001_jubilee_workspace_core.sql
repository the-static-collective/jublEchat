/*
# Jubilee Workspace Core Schema

## Overview
Event-sourced provenance model for a memory substrate that tracks how artifacts evolve.
The graph is derived; the event history is the source of truth.

## New Tables

1. `vms` — Isolated workspaces (Virtual Machines) that can exchange receipts
   - `id` (uuid, PK)
   - `name` (text, not null)
   - `description` (text)
   - `color` (text, default '#3b82f6') — visual identifier
   - `parent_id` (uuid, FK to vms.id) — for nested workspace hierarchy
   - `created_at` (timestamptz)

2. `artifacts` — Graph nodes; anything that enters the system (thought, file, claim, decision, etc.)
   - `id` (uuid, PK)
   - `vm_id` (uuid, FK to vms.id) — which workspace owns this artifact
   - `title` (text, not null)
   - `content` (text) — the body/content of the artifact
   - `artifact_type` (text, not null) — 'thought' | 'conversation' | 'file' | 'code' | 'decision' | 'claim' | 'task' | 'idea'
   - `origin` (text) — where it came from (person, conversation, file)
   - `status` (text, default 'active') — 'active' | 'retired' | 'branched'
   - `parent_artifact_id` (uuid, FK to artifacts.id) — if this artifact was created by a transformation
   - `created_at` (timestamptz)

3. `claims` — What an artifact asserts
   - `id` (uuid, PK)
   - `artifact_id` (uuid, FK to artifacts.id)
   - `text` (text, not null)
   - `confidence` (numeric, default 1.0) — 0.0 to 1.0
   - `created_at` (timestamptz)

4. `transformations` — Witnessed changes to artifacts
   - `id` (uuid, PK)
   - `artifact_id` (uuid, FK to artifacts.id) — the artifact being transformed
   - `result_artifact_id` (uuid, FK to artifacts.id) — the artifact created by the transformation (nullable for proposals not yet accepted)
   - `transform_kind` (text, not null) — 'refine' | 'retire' | 'branch' | 'merge' | 'bypass' | 'promote'
   - `reason` (text, not null) — why the change happened (the witness)
   - `change_description` (text) — what changed
   - `affected_count` (int, default 0) — how many references affected
   - `confidence` (numeric, default 0.5) — AI confidence 0.0 to 1.0
   - `status` (text, default 'proposed') — 'proposed' | 'accepted' | 'rejected' | 'branched'
   - `proposed_by` (text, default 'ai') — 'ai' | 'human'
   - `created_at` (timestamptz)
   - `resolved_at` (timestamptz) — when accepted/rejected

5. `edges` — Typed relationships between artifacts (the derived graph)
   - `id` (uuid, PK)
   - `source_artifact_id` (uuid, FK to artifacts.id)
   - `target_artifact_id` (uuid, FK to artifacts.id)
   - `edge_type` (text, not null) — 'DEPENDS_ON' | 'POPULATES' | 'CONTAINS' | 'SCOPE_MIRRORS' | 'DERIVES_FROM' | 'CONVERGES_WITH'
   - `created_at` (timestamptz)

6. `receipts` — Boundary exchange records between VMs
   - `id` (uuid, PK)
   - `from_vm_id` (uuid, FK to vms.id)
   - `to_vm_id` (uuid, FK to vms.id)
   - `artifact_id` (uuid, FK to artifacts.id) — the artifact being exchanged
   - `statement` (text, not null) — e.g. "I derived this insight from Music VM"
   - `created_at` (timestamptz)

## Security
- Single-tenant app (no sign-in). All policies use `TO anon, authenticated` with `USING (true)` / `WITH CHECK (true)` because data is intentionally shared within the workspace.
- RLS enabled on all tables.

## Notes
1. The graph (edges table) is derived from transformations and explicit relationships.
2. Transformations are the core primitive — every change is a witnessed event with provenance.
3. VMs support nesting via parent_id for the workspace hierarchy.
*/

CREATE TABLE IF NOT EXISTS vms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  color text NOT NULL DEFAULT '#3b82f6',
  parent_id uuid REFERENCES vms(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE vms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_vms" ON vms;
CREATE POLICY "anon_select_vms" ON vms FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_vms" ON vms;
CREATE POLICY "anon_insert_vms" ON vms FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_vms" ON vms;
CREATE POLICY "anon_update_vms" ON vms FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_vms" ON vms;
CREATE POLICY "anon_delete_vms" ON vms FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vm_id uuid NOT NULL REFERENCES vms(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text,
  artifact_type text NOT NULL DEFAULT 'thought',
  origin text,
  status text NOT NULL DEFAULT 'active',
  parent_artifact_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_artifacts" ON artifacts;
CREATE POLICY "anon_select_artifacts" ON artifacts FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_artifacts" ON artifacts;
CREATE POLICY "anon_insert_artifacts" ON artifacts FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_artifacts" ON artifacts;
CREATE POLICY "anon_update_artifacts" ON artifacts FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_artifacts" ON artifacts;
CREATE POLICY "anon_delete_artifacts" ON artifacts FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  text text NOT NULL,
  confidence numeric DEFAULT 1.0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_claims" ON claims;
CREATE POLICY "anon_select_claims" ON claims FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_claims" ON claims;
CREATE POLICY "anon_insert_claims" ON claims FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_claims" ON claims;
CREATE POLICY "anon_update_claims" ON claims FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_claims" ON claims;
CREATE POLICY "anon_delete_claims" ON claims FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS transformations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  result_artifact_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
  transform_kind text NOT NULL DEFAULT 'refine',
  reason text NOT NULL,
  change_description text,
  affected_count int DEFAULT 0,
  confidence numeric DEFAULT 0.5,
  status text NOT NULL DEFAULT 'proposed',
  proposed_by text NOT NULL DEFAULT 'ai',
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE transformations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_transformations" ON transformations;
CREATE POLICY "anon_select_transformations" ON transformations FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_transformations" ON transformations;
CREATE POLICY "anon_insert_transformations" ON transformations FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_transformations" ON transformations;
CREATE POLICY "anon_update_transformations" ON transformations FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_transformations" ON transformations;
CREATE POLICY "anon_delete_transformations" ON transformations FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  target_artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  edge_type text NOT NULL DEFAULT 'DERIVES_FROM',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_edges" ON edges;
CREATE POLICY "anon_select_edges" ON edges FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_edges" ON edges;
CREATE POLICY "anon_insert_edges" ON edges FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_edges" ON edges;
CREATE POLICY "anon_update_edges" ON edges FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_edges" ON edges;
CREATE POLICY "anon_delete_edges" ON edges FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_vm_id uuid NOT NULL REFERENCES vms(id) ON DELETE CASCADE,
  to_vm_id uuid NOT NULL REFERENCES vms(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  statement text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_receipts" ON receipts;
CREATE POLICY "anon_select_receipts" ON receipts FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_receipts" ON receipts;
CREATE POLICY "anon_insert_receipts" ON receipts FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_receipts" ON receipts;
CREATE POLICY "anon_update_receipts" ON receipts FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_receipts" ON receipts;
CREATE POLICY "anon_delete_receipts" ON receipts FOR DELETE
  TO anon, authenticated USING (true);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_artifacts_vm_id ON artifacts(vm_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_parent ON artifacts(parent_artifact_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_status ON artifacts(status);
CREATE INDEX IF NOT EXISTS idx_transformations_artifact ON transformations(artifact_id);
CREATE INDEX IF NOT EXISTS idx_transformations_status ON transformations(status);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_artifact_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_artifact_id);
CREATE INDEX IF NOT EXISTS idx_claims_artifact ON claims(artifact_id);
CREATE INDEX IF NOT EXISTS idx_receipts_from_vm ON receipts(from_vm_id);
CREATE INDEX IF NOT EXISTS idx_receipts_to_vm ON receipts(to_vm_id);
CREATE INDEX IF NOT EXISTS idx_vms_parent ON vms(parent_id);