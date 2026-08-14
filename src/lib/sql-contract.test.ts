import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL('../../supabase/migrations/20260813193000_012_witness_parity_and_still_alive.sql', import.meta.url);

test('migration 012 defines durable witness fields and exact RPC identities', () => {
  assert.equal(existsSync(migrationUrl), true, 'migration 012 must exist');
  const sql = readFileSync(migrationUrl, 'utf8');

  const requiredFragments = [
    'preserved_tensions jsonb',
    'unresolved_questions jsonb',
    'abandoned_paths jsonb',
    'p_new_artifact_id UUID',
    'p_event_id UUID',
    'p_event_created_at TIMESTAMPTZ',
    'p_version_number INTEGER',
    'p_preserved_tensions JSONB',
    'p_unresolved_questions JSONB',
    'p_abandoned_paths JSONB',
  ];

  for (const fragment of requiredFragments) {
    assert.equal(sql.includes(fragment), true, `missing migration contract fragment: ${fragment}`);
  }

  assert.equal(
    (sql.match(/TO service_role;/g) ?? []).length,
    2,
    'both hardened SECURITY DEFINER RPCs must explicitly grant execution only to the server role after client revocations',
  );
});
