import type {
  Artifact,
  Idea,
  IdeaVersion,
  JubileeEvent,
  Proposal,
  Transformation,
} from './types';

export type ResidualLineageKind =
  | 'rejected_proposal'
  | 'abandoned_path';

export interface ResidualLineageEntry {
  kind: ResidualLineageKind;
  ideaId: string;
  sourceArtifactId: string | null;
  proposalId: string | null;
  versionId: string | null;
  eventId: string | null;
  rationale: string | null;
  witnessedAt: string | null;
  authority: 'none';
}

export interface DeriveResidualLineageInput {
  selectedIdeaId: string;
  ideas: readonly Idea[];
  versions: readonly IdeaVersion[];
  artifacts: readonly Artifact[];
  transformations: readonly Transformation[];
  proposals: readonly Proposal[];
  events: readonly JubileeEvent[];
}

const KIND_ORDER: Readonly<Record<ResidualLineageKind, number>> = {
  rejected_proposal: 0,
  abandoned_path: 1,
};

function collectLineageArtifactIds(
  currentArtifactId: string | null,
  artifactById: ReadonlyMap<string, Artifact>,
): Set<string> {
  const lineage = new Set<string>();
  let currentId = currentArtifactId;

  while (currentId && !lineage.has(currentId)) {
    lineage.add(currentId);
    currentId = artifactById.get(currentId)?.parent_artifact_id ?? null;
  }

  return lineage;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stableIdentity(entry: ResidualLineageEntry): string {
  return entry.proposalId ?? entry.versionId ?? entry.sourceArtifactId ?? entry.eventId ?? '';
}

export function deriveResidualLineage({
  selectedIdeaId,
  ideas,
  versions,
  artifacts,
  transformations,
  proposals,
  events,
}: DeriveResidualLineageInput): ResidualLineageEntry[] {
  const selectedIdea = ideas.find((candidate) => candidate.id === selectedIdeaId);
  if (!selectedIdea) return [];

  const artifactById = new Map(artifacts.map((candidate) => [candidate.id, candidate]));
  const selectedLineage = collectLineageArtifactIds(
    selectedIdea.current_version_id,
    artifactById,
  );
  const transformationById = new Map(
    transformations.map((candidate) => [candidate.id, candidate]),
  );

  const residue: ResidualLineageEntry[] = [];

  for (const candidate of proposals) {
    const transformation = transformationById.get(candidate.transformation_id);
    if (!transformation || transformation.status !== 'rejected') continue;

    const touchesSelectedLineage =
      selectedLineage.has(candidate.modifies_artifact_id) ||
      (candidate.generated_from_artifact_id !== null &&
        selectedLineage.has(candidate.generated_from_artifact_id)) ||
      selectedLineage.has(transformation.artifact_id);

    if (!touchesSelectedLineage) continue;

    residue.push({
      kind: 'rejected_proposal',
      ideaId: selectedIdeaId,
      sourceArtifactId: candidate.proposal_artifact_id,
      proposalId: candidate.id,
      versionId: null,
      eventId: null,
      rationale: transformation.reason || null,
      witnessedAt: transformation.resolved_at ?? transformation.created_at ?? null,
      authority: 'none',
    });
  }

  const historicalVersions = versions.filter(
    (candidate) =>
      candidate.idea_id === selectedIdeaId &&
      candidate.artifact_id !== selectedIdea.current_version_id,
  );
  const historicalVersionByArtifactId = new Map(
    historicalVersions.map((candidate) => [candidate.artifact_id, candidate]),
  );
  const currentVersion = versions.find(
    (candidate) =>
      candidate.idea_id === selectedIdeaId &&
      candidate.artifact_id === selectedIdea.current_version_id,
  );

  const abandonedByArtifactId = new Map<string, ResidualLineageEntry>();

  for (const event of events) {
    if (event.event_type !== 'path_abandoned') continue;

    const payload = asRecord(event.payload);
    if (!payload || asString(payload.idea_id) !== selectedIdeaId) continue;

    const artifactId = asString(payload.version_id);
    if (!artifactId || artifactId === selectedIdea.current_version_id) continue;

    const historicalVersion = historicalVersionByArtifactId.get(artifactId);
    if (!historicalVersion) continue;

    const declaredVersionNumber = asNumber(payload.version_number);
    if (
      declaredVersionNumber !== null &&
      declaredVersionNumber !== historicalVersion.version_number
    ) {
      continue;
    }

    abandonedByArtifactId.set(artifactId, {
      kind: 'abandoned_path',
      ideaId: selectedIdeaId,
      sourceArtifactId: historicalVersion.artifact_id,
      proposalId: null,
      versionId: historicalVersion.id,
      eventId: event.id,
      rationale: event.rationale ?? asString(payload.rationale),
      witnessedAt: asString(payload.witnessed_at) ?? event.created_at ?? null,
      authority: 'none',
    });
  }

  for (const abandonedRef of currentVersion?.abandoned_paths ?? []) {
    const matches = historicalVersions.filter(
      (candidate) => candidate.version_number === abandonedRef.version_number,
    );

    if (matches.length !== 1) continue;

    const historicalVersion = matches[0];
    if (abandonedByArtifactId.has(historicalVersion.artifact_id)) continue;

    abandonedByArtifactId.set(historicalVersion.artifact_id, {
      kind: 'abandoned_path',
      ideaId: selectedIdeaId,
      sourceArtifactId: historicalVersion.artifact_id,
      proposalId: null,
      versionId: historicalVersion.id,
      eventId: null,
      rationale: abandonedRef.reason ?? null,
      witnessedAt: null,
      authority: 'none',
    });
  }

  residue.push(...abandonedByArtifactId.values());

  return residue.sort((left, right) => {
    const kindOrder = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
    if (kindOrder !== 0) return kindOrder;
    return stableIdentity(left).localeCompare(stableIdentity(right));
  });
}
