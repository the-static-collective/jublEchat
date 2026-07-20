/*
# Set DEFAULT auth.uid() on owner_id columns

## Problem
Migration 004 added owner_id columns but without DEFAULT auth.uid().
Inserts that omit owner_id leave it null, failing WITH CHECK (auth.uid() = owner_id).

## Fix
- Set DEFAULT auth.uid() on all owner_id columns
- Existing seed rows keep null owner_id (read-only via open SELECT policy)
- New rows get owner_id from the authenticated session automatically
*/

DO $$ BEGIN
  ALTER TABLE artifacts ALTER COLUMN owner_id SET DEFAULT auth.uid();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE vms ALTER COLUMN owner_id SET DEFAULT auth.uid();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE claims ALTER COLUMN owner_id SET DEFAULT auth.uid();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE edges ALTER COLUMN owner_id SET DEFAULT auth.uid();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE transformations ALTER COLUMN owner_id SET DEFAULT auth.uid();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE receipts ALTER COLUMN owner_id SET DEFAULT auth.uid();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE proposals ALTER COLUMN owner_id SET DEFAULT auth.uid();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
