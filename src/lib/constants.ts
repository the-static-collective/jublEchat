import type { ArtifactType, TransformKind, EdgeType, ArtifactStatus, TransformStatus } from './types';

export const ARTIFACT_TYPES: { value: ArtifactType; label: string; color: string; icon: string }[] = [
  { value: 'thought', label: 'Thought', color: '#06b6d4', icon: 'Lightbulb' },
  { value: 'conversation', label: 'Conversation', color: '#0ea5e9', icon: 'MessageCircle' },
  { value: 'file', label: 'File', color: '#64748b', icon: 'FileText' },
  { value: 'code', label: 'Code', color: '#10b981', icon: 'Code2' },
  { value: 'decision', label: 'Decision', color: '#f59e0b', icon: 'GitCommitHorizontal' },
  { value: 'claim', label: 'Claim', color: '#8b5cf6', icon: 'BadgeCheck' },
  { value: 'task', label: 'Task', color: '#ec4899', icon: 'CheckSquare' },
  { value: 'idea', label: 'Idea', color: '#3b82f6', icon: 'Sparkles' },
];

export const TRANSFORM_KINDS: { value: TransformKind; label: string; color: string; description: string }[] = [
  { value: 'refine', label: 'Refine', color: '#3b82f6', description: 'Improve or elaborate on an artifact' },
  { value: 'retire', label: 'Retire', color: '#ef4444', description: 'Mark an artifact as no longer active' },
  { value: 'branch', label: 'Branch', color: '#f59e0b', description: 'Create a divergent copy for exploration' },
  { value: 'merge', label: 'Merge', color: '#10b981', description: 'Combine multiple artifacts into one' },
  { value: 'bypass', label: 'Bypass', color: '#6366f1', description: 'Skip a layer in the projection' },
  { value: 'promote', label: 'Promote', color: '#8b5cf6', description: 'Elevate an artifact to a higher scope' },
];

export const EDGE_TYPES: { value: EdgeType; label: string; color: string; dashed: boolean }[] = [
  { value: 'DERIVES_FROM', label: 'Derives From', color: '#3b82f6', dashed: false },
  { value: 'DEPENDS_ON', label: 'Depends On', color: '#f59e0b', dashed: false },
  { value: 'POPULATES', label: 'Populates', color: '#10b981', dashed: false },
  { value: 'CONTAINS', label: 'Contains', color: '#64748b', dashed: false },
  { value: 'SCOPE_MIRRORS', label: 'Scope Mirrors', color: '#8b5cf6', dashed: true },
  { value: 'CONVERGES_WITH', label: 'Converges With', color: '#ec4899', dashed: true },
];

export const ARTIFACT_STATUS: { value: ArtifactStatus; label: string; color: string }[] = [
  { value: 'active', label: 'Active', color: '#10b981' },
  { value: 'retired', label: 'Retired', color: '#94a3b8' },
  { value: 'branched', label: 'Branched', color: '#f59e0b' },
];

export const TRANSFORM_STATUS: { value: TransformStatus; label: string; color: string }[] = [
  { value: 'proposed', label: 'Proposed', color: '#f59e0b' },
  { value: 'accepted', label: 'Accepted', color: '#10b981' },
  { value: 'rejected', label: 'Rejected', color: '#ef4444' },
  { value: 'branched', label: 'Branched', color: '#8b5cf6' },
];

export function getArtifactTypeMeta(type: string) {
  return ARTIFACT_TYPES.find((t) => t.value === type) ?? ARTIFACT_TYPES[0];
}

export function getTransformKindMeta(kind: string) {
  return TRANSFORM_KINDS.find((k) => k.value === kind) ?? TRANSFORM_KINDS[0];
}

export function getEdgeTypeMeta(type: string) {
  return EDGE_TYPES.find((e) => e.value === type) ?? EDGE_TYPES[0];
}

export function getArtifactStatusMeta(status: string) {
  return ARTIFACT_STATUS.find((s) => s.value === status) ?? ARTIFACT_STATUS[0];
}

export function getTransformStatusMeta(status: string) {
  return TRANSFORM_STATUS.find((s) => s.value === status) ?? TRANSFORM_STATUS[0];
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function formatDate(date: string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
