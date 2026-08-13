import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEventHash, reduceEvents } from './ledger';
import type { JubileeEvent } from './types';

const GENESIS = 'GENESIS_ANCHOR_v0.2';

function makeUnsignedEvent(): JubileeEvent {
  return {
    id: 'evt-contract-01',
    event_type: 'artifact_created',
    entity_id: 'artifact-contract-01',
    entity_type: 'artifact',
    actor: 'human',
    actor_id: 'operator@example.com',
    capability: 'manual-capture',
    policy: 'v0.4',
    payload: {
      title: 'Witness parity specimen',
      _signature_hash: '',
    },
    created_at: '2026-08-13T19:30:00.000Z',
    rationale: 'Focused signing/replay contract specimen.',
    source_proposal_id: null,
    witness_strength: 5,
  };
}

test('a freshly signed event replays with secure integrity', () => {
  const unsigned = makeUnsignedEvent();
  const signature = computeEventHash(unsigned, GENESIS);
  const signed: JubileeEvent = {
    ...unsigned,
    payload: {
      ...(unsigned.payload ?? {}),
      _signature_hash: signature,
    },
  };

  const result = reduceEvents([signed], true);

  assert.equal(result.audit.status, 'SECURE');
});

test('altering signed payload content is detected', () => {
  const unsigned = makeUnsignedEvent();
  const signature = computeEventHash(unsigned, GENESIS);
  const signed: JubileeEvent = {
    ...unsigned,
    payload: {
      ...(unsigned.payload ?? {}),
      _signature_hash: signature,
    },
  };
  const altered: JubileeEvent = {
    ...signed,
    payload: {
      ...(signed.payload ?? {}),
      title: 'Altered after signing',
    },
  };

  const result = reduceEvents([altered], true);

  assert.equal(result.audit.status, 'TAMPER_DETECTED');
});
