/*
# Make owner_id nullable on ideas and idea_versions for backfill

## Problem
owner_id is NOT NULL with DEFAULT auth.uid(), but backfill runs as
a service role that has no auth.uid(), so it inserts NULL, violating the constraint.

## Fix
- Make owner_id nullable on ideas and idea_versions
- Existing seed data has NULL owner_id (readable via open SELECT policy)
- New user-created rows get owner_id from auth.uid() default
*/

DO $$ BEGIN
  ALTER TABLE ideas ALTER COLUMN owner_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE idea_versions ALTER COLUMN owner_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
