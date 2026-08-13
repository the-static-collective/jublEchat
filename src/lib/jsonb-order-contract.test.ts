import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEventHash } from './ledger';
import type { JubileeEvent } from './types';

const base: JubileeEvent = {
  id: 'evt-order-01',
  event_type: 'artifact_created',
  entity_id: 'artifact-order-01',
  entity_type: 'artifact',
  actor: 'human',
  actor_id: 'operator',
  capability: 'manual-capture',
  policy: 'v0.4',
  payload: null,
  created_at: '2026-08-13T19:45:00.000Z',
  rationale: null,
  source_proposal_id: null,
  witness_strength: 5,
};

test('object key order does not change a payload hash', () => {
  const left = {
    ...base,
    payload: { alpha: 1, nested: { first: 1, second: 2 }, _signature_hash: '' },
  };
  const right = {
    ...base,
    payload: { nested: { second: 2, first: 1 }, alpha: 1, _signature_hash: 'existing' },
  };

  assert.equal(
    computeEventHash(left, 'GENESIS_ANCHOR_v0.2'),
    computeEventHash(right, 'GENESIS_ANCHOR_v0.2'),
  );
});
