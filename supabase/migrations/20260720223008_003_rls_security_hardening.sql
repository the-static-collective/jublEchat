/*
# RLS Security Hardening

## Problem
All write policies (INSERT/UPDATE/DELETE) used `USING (true)` / `WITH CHECK (true)`
scoped to `anon, authenticated`, effectively bypassing row-level security for all roles.

## Fix
- SELECT: kept open to `anon, authenticated` (read access for no-auth client)
- INSERT/UPDATE/DELETE: restricted to `authenticated` only
- events table: UPDATE and DELETE policies dropped entirely (append-only by enforcement)
- proposals table: same pattern

## Notes
This is a no-auth single-tenant app. The anon key is used for reads.
Write operations require an authenticated session.
The events log is now truly append-only — no UPDATE or DELETE policies exist.
*/

-- Helper: drop all existing policies on all tables, then recreate with proper scoping

-- artifacts
DROP POLICY IF EXISTS "anon_select_artifacts" ON artifacts;
DROP POLICY IF EXISTS "anon_insert_artifacts" ON artifacts;
DROP POLICY IF EXISTS "anon_update_artifacts" ON artifacts;
DROP POLICY IF EXISTS "anon_delete_artifacts" ON artifacts;

CREATE POLICY "anon_select_artifacts" ON artifacts FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "auth_insert_artifacts" ON artifacts FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_artifacts" ON artifacts FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_artifacts" ON artifacts FOR DELETE
  TO authenticated USING (true);

-- claims
DROP POLICY IF EXISTS "anon_select_claims" ON claims;
DROP POLICY IF EXISTS "anon_insert_claims" ON claims;
DROP POLICY IF EXISTS "anon_update_claims" ON claims;
DROP POLICY IF EXISTS "anon_delete_claims" ON claims;

CREATE POLICY "anon_select_claims" ON claims FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "auth_insert_claims" ON claims FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_claims" ON claims FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_claims" ON claims FOR DELETE
  TO authenticated USING (true);

-- edges
DROP POLICY IF EXISTS "anon_select_edges" ON edges;
DROP POLICY IF EXISTS "anon_insert_edges" ON edges;
DROP POLICY IF EXISTS "anon_update_edges" ON edges;
DROP POLICY IF EXISTS "anon_delete_edges" ON edges;

CREATE POLICY "anon_select_edges" ON edges FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "auth_insert_edges" ON edges FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_edges" ON edges FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_edges" ON edges FOR DELETE
  TO authenticated USING (true);

-- transformations
DROP POLICY IF EXISTS "anon_select_transformations" ON transformations;
DROP POLICY IF EXISTS "anon_insert_transformations" ON transformations;
DROP POLICY IF EXISTS "anon_update_transformations" ON transformations;
DROP POLICY IF EXISTS "anon_delete_transformations" ON transformations;

CREATE POLICY "anon_select_transformations" ON transformations FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "auth_insert_transformations" ON transformations FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_transformations" ON transformations FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_transformations" ON transformations FOR DELETE
  TO authenticated USING (true);

-- receipts
DROP POLICY IF EXISTS "anon_select_receipts" ON receipts;
DROP POLICY IF EXISTS "anon_insert_receipts" ON receipts;
DROP POLICY IF EXISTS "anon_update_receipts" ON receipts;
DROP POLICY IF EXISTS "anon_delete_receipts" ON receipts;

CREATE POLICY "anon_select_receipts" ON receipts FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "auth_insert_receipts" ON receipts FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_receipts" ON receipts FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_receipts" ON receipts FOR DELETE
  TO authenticated USING (true);

-- vms
DROP POLICY IF EXISTS "anon_select_vms" ON vms;
DROP POLICY IF EXISTS "anon_insert_vms" ON vms;
DROP POLICY IF EXISTS "anon_update_vms" ON vms;
DROP POLICY IF EXISTS "anon_delete_vms" ON vms;

CREATE POLICY "anon_select_vms" ON vms FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "auth_insert_vms" ON vms FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_vms" ON vms FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_vms" ON vms FOR DELETE
  TO authenticated USING (true);

-- events (append-only: no UPDATE or DELETE policies)
DROP POLICY IF EXISTS "anon_select_events" ON events;
DROP POLICY IF EXISTS "anon_insert_events" ON events;
DROP POLICY IF EXISTS "anon_update_events" ON events;
DROP POLICY IF EXISTS "anon_delete_events" ON events;

CREATE POLICY "anon_select_events" ON events FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "auth_insert_events" ON events FOR INSERT
  TO authenticated WITH CHECK (true);
-- No UPDATE or DELETE policies — events are append-only by RLS enforcement

-- proposals
DROP POLICY IF EXISTS "anon_select_proposals" ON proposals;
DROP POLICY IF EXISTS "anon_insert_proposals" ON proposals;
DROP POLICY IF EXISTS "anon_update_proposals" ON proposals;
DROP POLICY IF EXISTS "anon_delete_proposals" ON proposals;

CREATE POLICY "anon_select_proposals" ON proposals FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "auth_insert_proposals" ON proposals FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_proposals" ON proposals FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_proposals" ON proposals FOR DELETE
  TO authenticated USING (true);
