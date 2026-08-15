import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveNearbyGrowth } from './nearby-growth';
import type { Artifact, Edge, Idea, IdeaVersion } from './types';

function idea(id: string, currentVersionId: string, overrides: Partial<Idea> = {}): Idea {
  return {
    id,
    title: id,
    created_at: '2026-08-15T00:00:00.000Z',
    current_version_id: currentVersionId,
    lifecycle_status: 'active',
    taxonomy_level: 'idea',
    ...overrides,
  };
}

function artifact(id: string, parentArtifactId: string | null = null): Artifact {
  return {
    id,
    vm_id: 'vm-test',
    title: id,
    content: id,
    artifact_type: 'idea',
    origin: 'test',
    status: 'active',
    parent_artifact_id: parentArtifactId,
    created_at: '2026-08-15T00:00:00.000Z',
  };
}

function version(
  id: string,
  ideaId: string,
  artifactId: string,
  options: Partial<IdeaVersion> = {},
): IdeaVersion {
  return {
    id,
    idea_id: ideaId,
    artifact_id: artifactId,
    version_number: 1,
    created_at: '2026-08-15T00:00:00.000Z',
    preserved_tensions: [],
    unresolved_questions: [],
    abandoned_paths: [],
    ...options,
  };
}

function edge(id: string, source: string, target: string): Edge {
  return {
    id,
    source_artifact_id: source,
    target_artifact_id: target,
    edge_type: 'DERIVES_FROM',
    created_at: '2026-08-15T00:00:00.000Z',
  };
}

function derive(
  ideas: Idea[],
  versions: IdeaVersion[],
  artifacts: Artifact[],
  edges: Edge[] = [],
) {
  return deriveNearbyGrowth({
    selectedIdeaId: 'selected',
    ideas,
    versions,
    artifacts,
    edges,
  });
}

test('same taxonomy alone does not establish nearby growth', () => {
  const ideas = [idea('selected', 'selected-current'), idea('candidate', 'candidate-current')];
  const artifacts = [artifact('selected-current'), artifact('candidate-current')];
  const versions = [
    version('v-selected', 'selected', 'selected-current'),
    version('v-candidate', 'candidate', 'candidate-current'),
  ];

  assert.deepEqual(derive(ideas, versions, artifacts), []);
});

test('an explicit edge between artifact lineages admits a neighbor', () => {
  const ideas = [idea('selected', 'selected-current'), idea('candidate', 'candidate-current')];
  const artifacts = [
    artifact('selected-parent'),
    artifact('selected-current', 'selected-parent'),
    artifact('candidate-parent'),
    artifact('candidate-current', 'candidate-parent'),
  ];
  const versions = [
    version('v-selected', 'selected', 'selected-current'),
    version('v-candidate', 'candidate', 'candidate-current'),
  ];

  const result = derive(ideas, versions, artifacts, [edge('edge-1', 'selected-parent', 'candidate-parent')]);

  assert.equal(result.length, 1);
  assert.equal(result[0].idea.id, 'candidate');
  assert.deepEqual(result[0].evidence, ['direct_relation']);
});

test('an exact common ancestor admits a neighbor', () => {
  const ideas = [idea('selected', 'selected-current'), idea('candidate', 'candidate-current')];
  const artifacts = [
    artifact('shared-root'),
    artifact('selected-current', 'shared-root'),
    artifact('candidate-current', 'shared-root'),
  ];
  const versions = [
    version('v-selected', 'selected', 'selected-current'),
    version('v-candidate', 'candidate', 'candidate-current'),
  ];

  const result = derive(ideas, versions, artifacts);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].evidence, ['shared_ancestor']);
  assert.deepEqual(result[0].sharedAncestorIds, ['shared-root']);
});

test('an exact current-version friction reference ID admits a neighbor', () => {
  const ideas = [idea('selected', 'selected-current'), idea('candidate', 'candidate-current')];
  const artifacts = [artifact('selected-current'), artifact('candidate-current')];
  const versions = [
    version('v-selected', 'selected', 'selected-current', {
      preserved_tensions: [{ id: 'friction-shared', text: 'Selected wording' }],
    }),
    version('v-candidate', 'candidate', 'candidate-current', {
      unresolved_questions: [{ id: 'friction-shared', text: 'Candidate wording may differ' }],
    }),
  ];

  const result = derive(ideas, versions, artifacts);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].evidence, ['shared_friction']);
  assert.deepEqual(result[0].sharedFrictionIds, ['friction-shared']);
});

test('matching friction text under different IDs is not evidence', () => {
  const ideas = [idea('selected', 'selected-current'), idea('candidate', 'candidate-current')];
  const artifacts = [artifact('selected-current'), artifact('candidate-current')];
  const versions = [
    version('v-selected', 'selected', 'selected-current', {
      preserved_tensions: [{ id: 'friction-a', text: 'Same words' }],
    }),
    version('v-candidate', 'candidate', 'candidate-current', {
      preserved_tensions: [{ id: 'friction-b', text: 'Same words' }],
    }),
  ];

  assert.deepEqual(derive(ideas, versions, artifacts), []);
});

test('inactive candidate ideas are excluded even when evidence exists', () => {
  const ideas = [
    idea('selected', 'selected-current'),
    idea('candidate', 'candidate-current', { lifecycle_status: 'dormant' }),
  ];
  const artifacts = [artifact('selected-current'), artifact('candidate-current')];
  const versions = [
    version('v-selected', 'selected', 'selected-current', {
      preserved_tensions: [{ id: 'friction-shared', text: 'Shared' }],
    }),
    version('v-candidate', 'candidate', 'candidate-current', {
      preserved_tensions: [{ id: 'friction-shared', text: 'Shared' }],
    }),
  ];

  assert.deepEqual(derive(ideas, versions, artifacts), []);
});

test('results have deterministic title/id order and derivation does not mutate inputs', () => {
  const ideas = [
    idea('selected', 'selected-current', { title: 'Selected' }),
    idea('z-id', 'z-current', { title: 'Alpha' }),
    idea('a-id', 'a-current', { title: 'alpha' }),
    idea('b-id', 'b-current', { title: 'Beta' }),
  ];
  const artifacts = [
    artifact('selected-current'),
    artifact('z-current'),
    artifact('a-current'),
    artifact('b-current'),
  ];
  const shared = [{ id: 'friction-shared', text: 'Shared' }];
  const versions = [
    version('v-selected', 'selected', 'selected-current', { preserved_tensions: shared }),
    version('v-z', 'z-id', 'z-current', { preserved_tensions: shared }),
    version('v-a', 'a-id', 'a-current', { unresolved_questions: shared }),
    version('v-b', 'b-id', 'b-current', { preserved_tensions: shared }),
  ];
  const edges: Edge[] = [];
  const before = JSON.stringify({ ideas, versions, artifacts, edges });

  const result = derive(ideas, versions, artifacts, edges);

  assert.deepEqual(result.map((entry) => entry.idea.id), ['a-id', 'z-id', 'b-id']);
  assert.equal(JSON.stringify({ ideas, versions, artifacts, edges }), before);
});
