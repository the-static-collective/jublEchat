import type { Artifact, Edge, Idea, IdeaVersion } from './types';

export type NearbyGrowthEvidence =
  | 'direct_relation'
  | 'shared_ancestor'
  | 'shared_friction';

export interface NearbyGrowthResult {
  idea: Idea;
  evidence: NearbyGrowthEvidence[];
  sharedAncestorIds: string[];
  sharedFrictionIds: string[];
}

export interface DeriveNearbyGrowthInput {
  selectedIdeaId: string;
  ideas: readonly Idea[];
  versions: readonly IdeaVersion[];
  artifacts: readonly Artifact[];
  edges: readonly Edge[];
}

const EVIDENCE_ORDER: readonly NearbyGrowthEvidence[] = [
  'direct_relation',
  'shared_ancestor',
  'shared_friction',
];

function collectLineageArtifactIds(
  currentArtifactId: string | null,
  artifactById: ReadonlyMap<string, Artifact>,
): string[] {
  if (!currentArtifactId) return [];

  const lineage: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = currentArtifactId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    lineage.push(currentId);
    currentId = artifactById.get(currentId)?.parent_artifact_id ?? null;
  }

  return lineage;
}

function currentVersionForIdea(
  idea: Idea,
  versions: readonly IdeaVersion[],
): IdeaVersion | undefined {
  if (!idea.current_version_id) return undefined;
  return versions.find(
    (candidate) =>
      candidate.idea_id === idea.id &&
      candidate.artifact_id === idea.current_version_id,
  );
}

function frictionIds(version: IdeaVersion | undefined): Set<string> {
  if (!version) return new Set();
  return new Set([
    ...version.preserved_tensions.map((friction) => friction.id),
    ...version.unresolved_questions.map((friction) => friction.id),
  ]);
}

function intersect(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  return [...left].filter((value) => right.has(value)).sort();
}

function hasDirectLineageRelation(
  selectedLineage: ReadonlySet<string>,
  candidateLineage: ReadonlySet<string>,
  edges: readonly Edge[],
): boolean {
  return edges.some(
    (edge) =>
      (selectedLineage.has(edge.source_artifact_id) &&
        candidateLineage.has(edge.target_artifact_id)) ||
      (selectedLineage.has(edge.target_artifact_id) &&
        candidateLineage.has(edge.source_artifact_id)),
  );
}

export function deriveNearbyGrowth({
  selectedIdeaId,
  ideas,
  versions,
  artifacts,
  edges,
}: DeriveNearbyGrowthInput): NearbyGrowthResult[] {
  const selectedIdea = ideas.find((idea) => idea.id === selectedIdeaId);
  if (!selectedIdea) return [];

  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const selectedLineageOrdered = collectLineageArtifactIds(
    selectedIdea.current_version_id,
    artifactById,
  );
  const selectedLineage = new Set(selectedLineageOrdered);
  const selectedAncestors = new Set(selectedLineageOrdered.slice(1));
  const selectedFrictionIds = frictionIds(currentVersionForIdea(selectedIdea, versions));

  const results: NearbyGrowthResult[] = [];

  for (const candidate of ideas) {
    if (candidate.id === selectedIdea.id || candidate.lifecycle_status !== 'active') continue;

    const candidateLineageOrdered = collectLineageArtifactIds(
      candidate.current_version_id,
      artifactById,
    );
    const candidateLineage = new Set(candidateLineageOrdered);
    const candidateAncestors = new Set(candidateLineageOrdered.slice(1));
    const sharedAncestorIds = intersect(selectedAncestors, candidateAncestors);
    const sharedFrictionIds = intersect(
      selectedFrictionIds,
      frictionIds(currentVersionForIdea(candidate, versions)),
    );

    const evidenceSet = new Set<NearbyGrowthEvidence>();
    if (hasDirectLineageRelation(selectedLineage, candidateLineage, edges)) {
      evidenceSet.add('direct_relation');
    }
    if (sharedAncestorIds.length > 0) evidenceSet.add('shared_ancestor');
    if (sharedFrictionIds.length > 0) evidenceSet.add('shared_friction');

    if (evidenceSet.size === 0) continue;

    results.push({
      idea: candidate,
      evidence: EVIDENCE_ORDER.filter((kind) => evidenceSet.has(kind)),
      sharedAncestorIds,
      sharedFrictionIds,
    });
  }

  return results.sort((left, right) => {
    const titleOrder = left.idea.title
      .toLocaleLowerCase()
      .localeCompare(right.idea.title.toLocaleLowerCase());
    if (titleOrder !== 0) return titleOrder;
    return left.idea.id.localeCompare(right.idea.id);
  });
}
