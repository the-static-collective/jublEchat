import type { AbandonedPathRef, FrictionRef } from './types';

export interface HarvestAcceptedPayloadInput {
  ideaId: string;
  versionNumber: number;
  parentArtifactId: string;
  newArtifactId: string;
  idempotencyKey: string;
  actorId: string;
  actorEmail?: string | null;
  preservedTensions: FrictionRef[];
  unresolvedQuestions: FrictionRef[];
  abandonedPaths: AbandonedPathRef[];
}

export function buildHarvestAcceptedPayload(input: HarvestAcceptedPayloadInput) {
  return {
    idea_id: input.ideaId,
    version: input.versionNumber,
    parent_artifact_id: input.parentArtifactId,
    new_artifact_id: input.newArtifactId,
    idempotency_key: input.idempotencyKey,
    actor: {
      source: 'authenticated_session',
      id: input.actorId,
      email: input.actorEmail ?? null,
    },
    preserved_tensions: input.preservedTensions,
    unresolved_questions: input.unresolvedQuestions,
    abandoned_paths: input.abandonedPaths,
    _signature_hash: '',
  };
}

export interface BranchDispositionPayloadInput {
  ideaId: string;
  versionId: string;
  versionNumber: number;
  rationale: string;
  witnessedAt: string;
  actorId: string;
  actorEmail?: string | null;
}

export function buildBranchDispositionPayload(input: BranchDispositionPayloadInput) {
  return {
    idea_id: input.ideaId,
    version_id: input.versionId,
    version_number: input.versionNumber,
    actor_kind: 'human',
    rationale: input.rationale,
    witnessed_at: input.witnessedAt,
    actor: {
      source: 'authenticated_session',
      id: input.actorId,
      email: input.actorEmail ?? null,
    },
    _signature_hash: '',
  };
}
