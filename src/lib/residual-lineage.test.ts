import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveResidualLineage } from './residual-lineage';
import type {
  Artifact,
  Idea,
  IdeaVersion,
  JubileeEvent,
  Proposal,
  Transformation,
} from './types';

const CREATED_AT = '2026-08-19T00:00:00.000Z';
const RESOLVED_AT = '2026-08-19T00:00:01.000Z';
const ABANDONED_AT = '2026-08-19T00:00:02.000Z';

function idea(
  id: string,
  currentVersionId: string,
  overrides: Partial<Idea> = {},
): Idea {
  return {
    id,
    title: id,
    created_at: CREATED_AT,
    current_version_id: currentVersionId,
    lifecycle_status: 'active',
    taxonomy_level: 'idea',
    ...overrides,
  };
}

function artifact(
  id: string,
  parentArtifactId: string | null = null,
  overrides: Partial<Artifact> = {},
): Artifact {
  return {
    id,
    vm_id: 'vm-test',
    title: id,
    content: id,
    artifact_type: 'idea',
    origin: 'test',
    status: 'active',
    parent_artifact_id: parentArtifactId,
    created_at: CREATED_AT,
    ...overrides,
  };
}

function version(
  id: string,
  ideaId: string,
  artifactId: string,
  versionNumber: number,
  overrides: Partial<IdeaVersion> = {},
): IdeaVersion {
  return {
    id,
    idea_id: ideaId,
    artifact_id: artifactId,
    version_number: versionNumber,
    created_at: CREATED_AT,
    preserved_tensions: [],
    unresolved_questions: [],
    abandoned_paths: [],
    ...overrides,
  };
}

function transformation(
  id: string,
  artifactId: string,
  status: Transformation['status'],
  overrides: Partial<Transformation> = {},
): Transformation {
  return {
    id,
    artifact_id: artifactId,
    result_artifact_id: null,
    transform_kind: 'refine',
    reason: 'test reason',
    change_description: null,
    affected_count: 1,
    confidence: 0.5,
    status,
    proposed_by: 'ai',
    created_at: CREATED_AT,
    resolved_at: status === 'rejected' ? RESOLVED_AT : null,
    actor: 'model',
    actor_id: null,
    capability: null,
    policy: null,
    input_hash: null,
    output_hash: null,
    witness_note: null,
    ...overrides,
  };
}

function proposal(
  id: string,
  transformationId: string,
  proposalArtifactId: string,
  modifiesArtifactId: string,
  generatedFromArtifactId: string | null = null,
): Proposal {
  return {
    id,
    transformation_id: transformationId,
    proposal_artifact_id: proposalArtifactId,
    generated_from_artifact_id: generatedFromArtifactId,
    modifies_artifact_id: modifiesArtifactId,
    created_at: CREATED_AT,
  };
}

function abandonedEvent(
  id: string,
  ideaId: string,
  artifactId: string,
  versionNumber: number,
  overrides: Partial<JubileeEvent> = {},
): JubileeEvent {
  return {
    id,
    event_type: 'path_abandoned',
    entity_id: ideaId,
    entity_type: 'idea',
    actor: 'human',
    actor_id: 'human@example.com',
    capability: 'path-disposition',
    policy: 'v0.4',
    payload: {
      idea_id: ideaId,
      version_id: artifactId,
      version_number: versionNumber,
      actor_kind: 'human',
      rationale: 'This branch no longer carries the chosen direction.',
      witnessed_at: ABANDONED_AT,
      actor: {
        source: 'authenticated_session',
        id: 'human-1',
        email: null,
      },
      _signature_hash: 'fixture-hash',
    },
    created_at: ABANDONED_AT,
    rationale: 'This branch no longer carries the chosen direction.',
    source_proposal_id: null,
    witness_strength: 5,
    ...overrides,
  };
}

function derive(input: {
  ideas?: Idea[];
  versions?: IdeaVersion[];
  artifacts?: Artifact[];
  transformations?: Transformation[];
  proposals?: Proposal[];
  events?: JubileeEvent[];
}) {
  return deriveResidualLineage({
    selectedIdeaId: 'idea-a',
    ideas: input.ideas ?? [idea('idea-a', 'art-current')],
    versions:
      input.versions ?? [version('iv-current', 'idea-a', 'art-current', 2)],
    artifacts: input.artifacts ?? [artifact('art-current')],
    transformations: input.transformations ?? [],
    proposals: input.proposals ?? [],
    events: input.events ?? [],
  });
}

function siblingArtifacts(): Artifact[] {
  return [
    artifact('art-root'),
    artifact('art-old', 'art-root'),
    artifact('art-current', 'art-root'),
  ];
}

function siblingVersions(currentOverrides: Partial<IdeaVersion> = {}): IdeaVersion[] {
  return [
    version('iv-old', 'idea-a', 'art-old', 1),
    version('iv-current', 'idea-a', 'art-current', 2, currentOverrides),
  ];
}

test('exact rejected proposal on the selected lineage remains queryable with no authority', () => {
  const result = derive({
    artifacts: [
      artifact('art-parent'),
      artifact('art-current', 'art-parent'),
      artifact('proposal-art'),
    ],
    transformations: [transformation('tx-rejected', 'art-parent', 'rejected')],
    proposals: [proposal('proposal-1', 'tx-rejected', 'proposal-art', 'art-parent')],
  });

  assert.deepEqual(result, [
    {
      kind: 'rejected_proposal',
      ideaId: 'idea-a',
      sourceArtifactId: 'proposal-art',
      proposalId: 'proposal-1',
      versionId: null,
      eventId: null,
      rationale: 'test reason',
      witnessedAt: RESOLVED_AT,
      authority: 'none',
    },
  ]);
});

test('proposed or accepted transformation is not rejected residue', () => {
  for (const status of ['proposed', 'accepted'] as const) {
    const result = derive({
      artifacts: [artifact('art-current'), artifact('proposal-art')],
      transformations: [transformation('tx', 'art-current', status)],
      proposals: [proposal('proposal-1', 'tx', 'proposal-art', 'art-current')],
    });
    assert.deepEqual(result, []);
  }
});

test('rejected status fails closed when the proposal artifact is already on the constituted current lineage', () => {
  const result = derive({
    artifacts: [
      artifact('art-root'),
      artifact('proposal-art', 'art-root'),
      artifact('art-current', 'proposal-art'),
    ],
    transformations: [transformation('tx-rejected', 'art-root', 'rejected')],
    proposals: [proposal('proposal-1', 'tx-rejected', 'proposal-art', 'art-root')],
  });

  assert.deepEqual(result, []);
});

test('same title content or taxonomy without exact selected-lineage evidence creates no residue', () => {
  const result = derive({
    ideas: [
      idea('idea-a', 'art-current', { title: 'Same title' }),
      idea('idea-b', 'other-current', { title: 'Same title', taxonomy_level: 'idea' }),
    ],
    versions: [
      version('iv-current', 'idea-a', 'art-current', 2),
      version('iv-other', 'idea-b', 'other-current', 1),
    ],
    artifacts: [
      artifact('art-current', null, { content: 'Same content' }),
      artifact('other-current', null, { content: 'Same content' }),
      artifact('proposal-art'),
    ],
    transformations: [transformation('tx-other', 'other-current', 'rejected')],
    proposals: [proposal('proposal-other', 'tx-other', 'proposal-art', 'other-current')],
  });

  assert.deepEqual(result, []);
});

test('path_abandoned event makes an explicit sibling version visible without changing its identity', () => {
  const result = derive({
    versions: siblingVersions(),
    artifacts: siblingArtifacts(),
    events: [abandonedEvent('event-abandon', 'idea-a', 'art-old', 1)],
  });

  assert.deepEqual(result, [
    {
      kind: 'abandoned_path',
      ideaId: 'idea-a',
      sourceArtifactId: 'art-old',
      proposalId: null,
      versionId: 'iv-old',
      eventId: 'event-abandon',
      rationale: 'This branch no longer carries the chosen direction.',
      witnessedAt: ABANDONED_AT,
      authority: 'none',
    },
  ]);
});

test('non-current version without explicit disposition is not abandoned residue', () => {
  const result = derive({
    versions: siblingVersions(),
    artifacts: siblingArtifacts(),
  });

  assert.deepEqual(result, []);
});

test('current version is never returned as abandoned residue', () => {
  const result = derive({
    events: [abandonedEvent('event-bad', 'idea-a', 'art-current', 2)],
  });

  assert.deepEqual(result, []);
});

test('an ancestor on the current lineage is not an abandoned sibling even if a contradictory disposition event exists', () => {
  const result = derive({
    versions: [
      version('iv-old', 'idea-a', 'art-old', 1),
      version('iv-current', 'idea-a', 'art-current', 2),
    ],
    artifacts: [artifact('art-old'), artifact('art-current', 'art-old')],
    events: [abandonedEvent('event-contradiction', 'idea-a', 'art-old', 1)],
  });

  assert.deepEqual(result, []);
});

test('abandoned_paths projection resolves by unique version_number without treating opaque id as a version id', () => {
  const result = derive({
    versions: siblingVersions({
      abandoned_paths: [
        {
          id: 'disposition-ref-not-a-version-id',
          version_number: 1,
          reason: 'Human explicitly left this path behind.',
        },
      ],
    }),
    artifacts: siblingArtifacts(),
  });

  assert.deepEqual(result, [
    {
      kind: 'abandoned_path',
      ideaId: 'idea-a',
      sourceArtifactId: 'art-old',
      proposalId: null,
      versionId: 'iv-old',
      eventId: null,
      rationale: 'Human explicitly left this path behind.',
      witnessedAt: null,
      authority: 'none',
    },
  ]);
});

test('exact path_abandoned event wins when the projection names the same historical sibling', () => {
  const result = derive({
    versions: siblingVersions({
      abandoned_paths: [
        {
          id: 'projection-ref',
          version_number: 1,
          reason: 'Projection copy',
        },
      ],
    }),
    artifacts: siblingArtifacts(),
    events: [abandonedEvent('event-abandon', 'idea-a', 'art-old', 1)],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].eventId, 'event-abandon');
  assert.equal(result[0].rationale, 'This branch no longer carries the chosen direction.');
  assert.equal(result[0].witnessedAt, ABANDONED_AT);
});

test('duplicate abandonment events resolve deterministically by canonical event order rather than input order', () => {
  const earlier = abandonedEvent('event-a', 'idea-a', 'art-old', 1, {
    created_at: '2026-08-19T00:00:03.000Z',
    rationale: 'Earlier disposition wording.',
    ledger_sequence: 10,
  });
  const later = abandonedEvent('event-b', 'idea-a', 'art-old', 1, {
    created_at: '2026-08-19T00:00:04.000Z',
    rationale: 'Later disposition wording.',
    ledger_sequence: 11,
  });

  const common = {
    selectedIdeaId: 'idea-a',
    ideas: [idea('idea-a', 'art-current')],
    versions: siblingVersions(),
    artifacts: siblingArtifacts(),
    transformations: [] as Transformation[],
    proposals: [] as Proposal[],
  };

  const first = deriveResidualLineage({ ...common, events: [later, earlier] });
  const second = deriveResidualLineage({ ...common, events: [earlier, later] });

  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0].eventId, 'event-b');
  assert.equal(first[0].rationale, 'Later disposition wording.');
});

test('result order is deterministic across shuffled inputs and derivation does not mutate inputs', () => {
  const ideas = [idea('idea-a', 'art-current')];
  const versions = siblingVersions();
  const artifacts = [
    artifact('proposal-z'),
    ...siblingArtifacts(),
    artifact('proposal-a'),
  ];
  const transformations = [
    transformation('tx-z', 'art-current', 'rejected', { reason: 'z reason' }),
    transformation('tx-a', 'art-root', 'rejected', { reason: 'a reason' }),
  ];
  const proposals = [
    proposal('proposal-z', 'tx-z', 'proposal-z', 'art-current'),
    proposal('proposal-a', 'tx-a', 'proposal-a', 'art-root'),
  ];
  const events = [abandonedEvent('event-abandon', 'idea-a', 'art-old', 1)];
  const before = JSON.stringify({ ideas, versions, artifacts, transformations, proposals, events });

  const first = deriveResidualLineage({
    selectedIdeaId: 'idea-a',
    ideas,
    versions,
    artifacts,
    transformations,
    proposals,
    events,
  });
  const second = deriveResidualLineage({
    selectedIdeaId: 'idea-a',
    ideas: [...ideas].reverse(),
    versions: [...versions].reverse(),
    artifacts: [...artifacts].reverse(),
    transformations: [...transformations].reverse(),
    proposals: [...proposals].reverse(),
    events: [...events].reverse(),
  });

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((entry) => [entry.kind, entry.proposalId ?? entry.versionId]),
    [
      ['rejected_proposal', 'proposal-a'],
      ['rejected_proposal', 'proposal-z'],
      ['abandoned_path', 'iv-old'],
    ],
  );
  assert.equal(JSON.stringify({ ideas, versions, artifacts, transformations, proposals, events }), before);
});
