import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serverUrl = new URL('../../server.ts', import.meta.url);
const boundaryUrl = new URL('./test-boundary.ts', import.meta.url);

test('server persists the exact identities and Still Alive evidence that it signs', () => {
  const source = readFileSync(serverUrl, 'utf8');

  const requiredFragments = [
    "import { computeEventHash, signEvent } from \"./src/lib/ledger\";",
    'buildHarvestAcceptedPayload',
    'buildBranchDispositionPayload',
    "serverSupabase.rpc('harvest_proposal_v3'",
    'p_new_artifact_id: newArtifactId',
    'p_event_id: eventId',
    'p_event_created_at: eventCreatedAt',
    'p_version_number: nextVersion',
    'p_preserved_tensions: harvestPayload.preserved_tensions',
    'p_unresolved_questions: harvestPayload.unresolved_questions',
    'p_abandoned_paths: harvestPayload.abandoned_paths',
    "serverSupabase.rpc('abandon_path_v2'",
  ];

  for (const fragment of requiredFragments) {
    assert.equal(source.includes(fragment), true, `missing authoritative write fragment: ${fragment}`);
  }

  assert.equal(
    source.includes("entity_id: '00000000-0000-0000-0000-000000000000'"),
    false,
    'authoritative harvest hashing must never use a placeholder artifact identity',
  );
});

test('boundary evidence does not claim PASS for checks it never executes', () => {
  const source = readFileSync(boundaryUrl, 'utf8');
  const forbiddenClaims = [
    'PASS: High-authority transaction is successfully delegated to the postgres harvest_proposal_v2() definer function.',
    'PASS: The postgres trigger or harvest_proposal_v2 function queries existing events by idempotency_key first to return the same output safely.',
    'PASS: Optimistic concurrency control via the PostgreSQL FOR UPDATE row lock and head hash CAS guarantees serialization.',
    'PASS: Accepting "Volunteer capacity is a load-bearing assumption" adds tension to active lineage and advances version from v0.2 to v0.3 with instant state transition feedback.',
  ];

  for (const claim of forbiddenClaims) {
    assert.equal(source.includes(claim), false, `unexecuted PASS claim remains: ${claim}`);
  }
});
