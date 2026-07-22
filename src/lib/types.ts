export type ArtifactType =
  | 'thought'
  | 'conversation'
  | 'file'
  | 'code'
  | 'decision'
  | 'claim'
  | 'task'
  | 'idea';

export type ArtifactStatus = 'active' | 'retired' | 'branched';

export type TransformKind =
  | 'refine'
  | 'retire'
  | 'branch'
  | 'merge'
  | 'bypass'
  | 'promote';

export type TransformStatus = 'proposed' | 'accepted' | 'rejected' | 'branched';

export type EdgeType =
  | 'DEPENDS_ON'
  | 'POPULATES'
  | 'CONTAINS'
  | 'SCOPE_MIRRORS'
  | 'DERIVES_FROM'
  | 'CONVERGES_WITH';

export interface VM {
  id: string;
  name: string;
  description: string | null;
  color: string;
  parent_id: string | null;
  created_at: string;
}

export interface Artifact {
  id: string;
  vm_id: string;
  title: string;
  content: string | null;
  artifact_type: ArtifactType;
  origin: string | null;
  status: ArtifactStatus;
  parent_artifact_id: string | null;
  created_at: string;
}

export interface Claim {
  id: string;
  artifact_id: string;
  text: string;
  confidence: number;
  created_at: string;
}

export interface Transformation {
  id: string;
  artifact_id: string;
  result_artifact_id: string | null;
  transform_kind: TransformKind;
  reason: string;
  change_description: string | null;
  affected_count: number;
  confidence: number;
  status: TransformStatus;
  proposed_by: 'ai' | 'human';
  created_at: string;
  resolved_at: string | null;
  actor: string;
  actor_id: string | null;
  capability: string | null;
  policy: string | null;
  input_hash: string | null;
  output_hash: string | null;
  witness_note: string | null;
}

export interface Edge {
  id: string;
  source_artifact_id: string;
  target_artifact_id: string;
  edge_type: EdgeType;
  created_at: string;
}

export interface Receipt {
  id: string;
  from_vm_id: string;
  to_vm_id: string;
  artifact_id: string;
  statement: string;
  created_at: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: ArtifactType;
  status: ArtifactStatus;
  vm_id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  edge_type: EdgeType;
}

export type EventType =
  | 'artifact_created'
  | 'external_artifact_created'
  | 'claim_added'
  | 'transformation_proposed'
  | 'transformation_accepted'
  | 'transformation_rejected'
  | 'transformation_branched'
  | 'edge_created'
  | 'projection_generated'
  | 'receipt_issued'
  | 'vm_created';

export interface ExportPacket {
  ideaId: string;
  versionId: string;
  versionNumber: number;
  formulation: string;
  insights: string[];
  tensions: string[];
  experiments: string[];
  openQuestion?: string;
  lineage: {
    parentVersionIds: string[];
    sourceEventIds: string[];
  };
  generatedAt: string;
  packetHash: string;
}

export interface ExternalArtifact {
  id: string;
  ideaId: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  exportPacketHash: string;
  templateType: 'project_brief' | 'one_page_proposal' | 'research_plan';
  title: string;
  content: string;
  status: 'draft' | 'human_approved' | 'superseded';
  createdAt: string;
  tone?: string;
  kernelSummary: {
    insightsCount: number;
    tensionsCount: number;
    openQuestionsCount: number;
  };
  exportPacket: ExportPacket;
}

export type LifecycleStatus = 'active' | 'dormant' | 'merged' | 'abandoned';
export type TaxonomyLevel = 'insight' | 'idea' | 'project';

export interface Idea {
  id: string;
  title: string;
  created_at: string;
  current_version_id: string | null;
  lifecycle_status: LifecycleStatus;
  taxonomy_level?: TaxonomyLevel;
}

export interface FrictionRef {
  id: string;
  text: string;
}

export interface AbandonedPathRef {
  id: string;
  version_number: number;
  reason?: string;
}

export interface IdeaVersion {
  id: string;
  idea_id: string;
  artifact_id: string;
  version_number: number;
  created_at: string;
  preserved_tensions: FrictionRef[];
  unresolved_questions: FrictionRef[];
  abandoned_paths: AbandonedPathRef[];
}

export type WitnessStrength = 5 | 3 | 1;

export const WITNESS_LABELS: Record<number, { label: string; stars: string; color: string }> = {
  5: { label: 'Contemporaneous event', stars: '★★★★★', color: '#10b981' },
  3: { label: 'Reconstructed history', stars: '★★★☆☆', color: '#f59e0b' },
  1: { label: 'Imported claim', stars: '★☆☆☆☆', color: '#64748b' },
};

export interface JubileeEvent {
  id: string;
  event_type: EventType;
  entity_id: string | null;
  entity_type: string | null;
  actor: string;
  actor_id: string | null;
  capability: string | null;
  policy: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  rationale: string | null;
  source_proposal_id: string | null;
  witness_strength: number;
  ledger_sequence?: number;
}

export interface ProvenanceCue {
  contributor: string;
  informed_by: string;
  delta_summary: string;
}

export interface NextMoveItem {
  action: 'adopt' | 'test' | 'fork' | 'challenge' | 'retire';
  label: string;
  description?: string;
}

export interface DeliberationLoop {
  claims?: string[];
  assumptions?: string[];
  tensions?: string[];
  next_moves?: NextMoveItem[];
}

export interface ConstitutionalPulse {
  headline: string;
  readiness_status: 'ready_for_test' | 'needs_tension_check' | 'unchallenged_assumptions' | 'ripe_for_synthesis';
  recommended_act: NextMoveItem;
  evidence?: {
    claims_count?: number;
    tensions_count?: number;
    unchallenged_assumption?: string;
    alternative_branches?: string[];
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  content: {
    text: string;
    provenance?: ProvenanceCue;
    deliberation?: DeliberationLoop;
    pulse?: ConstitutionalPulse;
    proposals?: any[];
  };
  created_at: string;
}

export interface Proposal {
  id: string;
  transformation_id: string;
  proposal_artifact_id: string;
  generated_from_artifact_id: string | null;
  modifies_artifact_id: string;
  created_at: string;
}
