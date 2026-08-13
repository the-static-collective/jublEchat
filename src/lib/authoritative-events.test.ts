import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBranchDispositionPayload,
  buildHarvestAcceptedPayload,
} from './authoritative-events';

test('harvest payload preserves explicit Still Alive evidence', () => {
  const preservedTensions = [{ id: 't-1', text: 'Autonomy versus shared constraint.' }];
  const unresolvedQuestions = [{ id: 'q-1', text: 'What evidence would settle the tradeoff?' }];
  const abandonedPaths = [{ id: 'path-1', version_number: 2, reason: 'Superseded by field evidence.' }];

  const payload = buildHarvestAcceptedPayload({
    ideaId: 'idea-1',
    versionNumber: 3,
    parentArtifactId: 'artifact-2',
    newArtifactId: 'artifact-3',
    idempotencyKey: 'idem-1',
    actorId: 'user-1',
    actorEmail: 'operator@example.com',
    preservedTensions,
    unresolvedQuestions,
    abandonedPaths,
  });

  assert.deepEqual(payload.preserved_tensions, preservedTensions);
  assert.deepEqual(payload.unresolved_questions, unresolvedQuestions);
  assert.deepEqual(payload.abandoned_paths, abandonedPaths);
  assert.equal(payload.new_artifact_id, 'artifact-3');
  assert.equal(payload._signature_hash, '');
});

test('branch disposition payload uses the supplied witnessed timestamp', () => {
  const payload = buildBranchDispositionPayload({
    ideaId: 'idea-1',
    versionId: 'artifact-2',
    versionNumber: 2,
    rationale: 'Retired after explicit operator review.',
    witnessedAt: '2026-08-13T19:40:00.000Z',
    actorId: 'user-1',
    actorEmail: 'operator@example.com',
  });

  assert.equal(payload.witnessed_at, '2026-08-13T19:40:00.000Z');
  assert.equal(payload.version_id, 'artifact-2');
  assert.equal(payload._signature_hash, '');
});
