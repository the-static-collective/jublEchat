import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import type { VM, Artifact, Claim, Transformation, Edge, Receipt, GraphNode, GraphEdge, ArtifactType, JubileeEvent, Proposal, Idea, IdeaVersion, WitnessStrength } from './types';

export function useVMs() {
  const [vms, setVMs] = useState<VM[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('vms').select('*').order('created_at', { ascending: true });
    setVMs(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { vms, loading, refetch: fetch };
}

export function useArtifacts(vmId?: string) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('artifacts').select('*').order('created_at', { ascending: false });
    if (vmId) query = query.eq('vm_id', vmId);
    const { data } = await query;
    setArtifacts(data ?? []);
    setLoading(false);
  }, [vmId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { artifacts, loading, refetch: fetch };
}

export function useClaims(artifactId?: string) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('claims').select('*').order('created_at', { ascending: true });
    if (artifactId) query = query.eq('artifact_id', artifactId);
    const { data } = await query;
    setClaims(data ?? []);
    setLoading(false);
  }, [artifactId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { claims, loading, refetch: fetch };
}

export function useTransformations(artifactId?: string) {
  const [transformations, setTransformations] = useState<Transformation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('transformations').select('*').order('created_at', { ascending: false });
    if (artifactId) query = query.eq('artifact_id', artifactId);
    const { data } = await query;
    setTransformations(data ?? []);
    setLoading(false);
  }, [artifactId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { transformations, loading, refetch: fetch };
}

export function useEdges() {
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('edges').select('*').order('created_at', { ascending: true });
    setEdges(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { edges, loading, refetch: fetch };
}

export function useReceipts() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('receipts').select('*').order('created_at', { ascending: false });
    setReceipts(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { receipts, loading, refetch: fetch };
}

export function useEvents(entityId?: string) {
  const [events, setEvents] = useState<JubileeEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('events').select('*').order('created_at', { ascending: false });
    if (entityId) query = query.eq('entity_id', entityId);
    const { data } = await query;
    setEvents(data ?? []);
    setLoading(false);
  }, [entityId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { events, loading, refetch: fetch };
}

export function useProposals() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('proposals').select('*').order('created_at', { ascending: false });
    setProposals(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { proposals, loading, refetch: fetch };
}

export function buildGraphNodes(artifacts: Artifact[]): GraphNode[] {
  return artifacts.map((a) => ({
    id: a.id,
    label: a.title,
    type: a.artifact_type as ArtifactType,
    status: a.status,
    vm_id: a.vm_id,
    x: 0, y: 0, vx: 0, vy: 0,
  }));
}

export function buildGraphEdges(edges: Edge[]): GraphEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source_artifact_id,
    target: e.target_artifact_id,
    edge_type: e.edge_type,
  }));
}

export async function logEvent(event: {
  event_type: string;
  entity_id?: string;
  entity_type?: string;
  actor?: string;
  actor_id?: string;
  capability?: string;
  policy?: string;
  payload?: Record<string, unknown>;
  rationale?: string;
  source_proposal_id?: string;
  witness_strength?: WitnessStrength;
}): Promise<void> {
  await supabase.from('events').insert({
    event_type: event.event_type,
    entity_id: event.entity_id ?? null,
    entity_type: event.entity_type ?? null,
    actor: event.actor ?? 'system',
    actor_id: event.actor_id ?? null,
    capability: event.capability ?? null,
    policy: event.policy ?? null,
    payload: event.payload ?? null,
    rationale: event.rationale ?? null,
    source_proposal_id: event.source_proposal_id ?? null,
    witness_strength: event.witness_strength ?? 5,
  });
}

async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createArtifact(data: {
  vm_id: string;
  title: string;
  content?: string;
  artifact_type: ArtifactType;
  origin?: string;
}): Promise<Artifact | null> {
  const { data: result } = await supabase
    .from('artifacts')
    .insert(data)
    .select()
    .single();

  if (result) {
    await logEvent({
      event_type: 'artifact_created',
      entity_id: result.id,
      entity_type: 'artifact',
      actor: 'human',
      actor_id: 'Human Operator',
      capability: 'manual-capture',
      policy: 'v0.3',
      payload: { title: result.title, type: result.artifact_type, vm_id: result.vm_id, origin: result.origin },
    });
  }

  return result;
}

export async function createTransformation(data: {
  artifact_id: string;
  transform_kind: string;
  reason: string;
  change_description?: string;
  affected_count?: number;
  confidence?: number;
  proposed_by?: string;
  actor?: string;
  actor_id?: string;
  capability?: string;
  policy?: string;
  witness_note?: string;
  generated_from_artifact_id?: string;
}): Promise<{ transformation: Transformation | null; proposalArtifact: Artifact | null }> {
  const inputHash = await hashString(data.artifact_id + data.transform_kind + (data.change_description ?? ''));

  const { data: transformation } = await supabase
    .from('transformations')
    .insert({
      artifact_id: data.artifact_id,
      transform_kind: data.transform_kind,
      reason: data.reason,
      change_description: data.change_description ?? null,
      affected_count: data.affected_count ?? 0,
      confidence: data.confidence ?? 0.5,
      status: 'proposed',
      proposed_by: data.proposed_by ?? 'ai',
      actor: data.actor ?? 'ai',
      actor_id: data.actor_id ?? 'AI Agent',
      capability: data.capability ?? 'transform',
      policy: data.policy ?? 'v0.4',
      input_hash: inputHash,
      witness_note: data.witness_note ?? null,
    })
    .select()
    .single();

  if (!transformation) return { transformation: null, proposalArtifact: null };

  const { data: sourceArtifact } = await supabase
    .from('artifacts')
    .select('*')
    .eq('id', data.artifact_id)
    .maybeSingle();

  const { data: proposalArtifact } = await supabase
    .from('artifacts')
    .insert({
      vm_id: sourceArtifact?.vm_id ?? 'a0000000-0000-0000-0000-000000000001',
      title: `Proposal: ${data.change_description ?? data.transform_kind}`,
      content: data.reason,
      artifact_type: 'claim',
      origin: `${data.actor_id ?? 'AI Agent'} — capability: ${data.capability ?? 'transform'}, policy: ${data.policy ?? 'v0.4'}`,
      status: 'active',
      parent_artifact_id: data.generated_from_artifact_id ?? data.artifact_id,
    })
    .select()
    .single();

  if (proposalArtifact) {
    await supabase.from('proposals').insert({
      transformation_id: transformation.id,
      proposal_artifact_id: proposalArtifact.id,
      generated_from_artifact_id: data.generated_from_artifact_id ?? null,
      modifies_artifact_id: data.artifact_id,
    });

    await supabase.from('edges').insert({
      source_artifact_id: proposalArtifact.id,
      target_artifact_id: data.artifact_id,
      edge_type: 'DERIVES_FROM',
    });

    await logEvent({
      event_type: 'artifact_created',
      entity_id: proposalArtifact.id,
      entity_type: 'artifact',
      actor: data.actor ?? 'ai',
      actor_id: data.actor_id ?? 'AI Agent',
      capability: data.capability ?? 'transform',
      policy: data.policy ?? 'v0.4',
      payload: { title: proposalArtifact.title, is_proposal: true, transformation_id: transformation.id },
    });
  }

  await logEvent({
    event_type: 'transformation_proposed',
    entity_id: transformation.id,
    entity_type: 'transformation',
    actor: data.actor ?? 'ai',
    actor_id: data.actor_id ?? 'AI Agent',
    capability: data.capability ?? 'transform',
    policy: data.policy ?? 'v0.4',
    payload: { kind: data.transform_kind, reason: data.reason, artifact_id: data.artifact_id, confidence: data.confidence ?? 0.5, proposal_artifact_id: proposalArtifact?.id },
  });

  return { transformation, proposalArtifact };
}

export async function resolveTransformation(
  id: string,
  status: 'accepted' | 'rejected' | 'branched',
  options?: { outputHash?: string; rationale?: string; sourceProposalId?: string }
): Promise<void> {
  await supabase
    .from('transformations')
    .update({
      status,
      resolved_at: new Date().toISOString(),
      ...(options?.outputHash ? { output_hash: options.outputHash } : {}),
    })
    .eq('id', id);

  const eventType = status === 'accepted' ? 'transformation_accepted'
    : status === 'rejected' ? 'transformation_rejected'
    : 'transformation_branched';

  await logEvent({
    event_type: eventType,
    entity_id: id,
    entity_type: 'transformation',
    actor: 'human',
    actor_id: 'Human Operator',
    capability: 'approve-transformation',
    policy: 'v0.3',
    payload: { status },
    rationale: options?.rationale,
    source_proposal_id: options?.sourceProposalId,
    witness_strength: 5,
  });
}

export async function createEdge(data: {
  source_artifact_id: string;
  target_artifact_id: string;
  edge_type: string;
}): Promise<void> {
  const { data: result } = await supabase.from('edges').insert(data).select().single();
  if (result) {
    await logEvent({
      event_type: 'edge_created',
      entity_id: result.id,
      entity_type: 'edge',
      actor: 'system',
      payload: { source: data.source_artifact_id, target: data.target_artifact_id, type: data.edge_type },
    });
  }
}

export async function createReceipt(data: {
  from_vm_id: string;
  to_vm_id: string;
  artifact_id: string;
  statement: string;
}): Promise<void> {
  const { data: result } = await supabase.from('receipts').insert(data).select().single();
  if (result) {
    await logEvent({
      event_type: 'receipt_issued',
      entity_id: result.id,
      entity_type: 'receipt',
      actor: 'system',
      payload: { from_vm: data.from_vm_id, to_vm: data.to_vm_id, artifact_id: data.artifact_id, statement: data.statement },
    });
  }
}

export async function createClaim(data: {
  artifact_id: string;
  text: string;
  confidence?: number;
}): Promise<void> {
  const { data: result } = await supabase.from('claims').insert(data).select().single();
  if (result) {
    await logEvent({
      event_type: 'claim_added',
      entity_id: result.id,
      entity_type: 'claim',
      actor: 'human',
      actor_id: 'Human Operator',
      capability: 'assert-claim',
      policy: 'v0.3',
      payload: { artifact_id: data.artifact_id, text: data.text, confidence: data.confidence ?? 1.0 },
    });
  }
}

export async function createVM(data: {
  name: string;
  description?: string;
  color?: string;
  parent_id?: string;
}): Promise<VM | null> {
  const { data: result } = await supabase
    .from('vms')
    .insert(data)
    .select()
    .single();

  if (result) {
    await logEvent({
      event_type: 'vm_created',
      entity_id: result.id,
      entity_type: 'vm',
      actor: 'human',
      actor_id: 'Human Operator',
      capability: 'create-vm',
      policy: 'v0.3',
      payload: { name: result.name, color: result.color, parent_id: result.parent_id },
    });
  }

  return result;
}

// ─── Ideas ───

export function useIdeas() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('ideas').select('*').order('created_at', { ascending: false });
    setIdeas(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { ideas, loading, refetch: fetch };
}

export function useIdeaVersions(ideaId?: string) {
  const [versions, setVersions] = useState<IdeaVersion[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('idea_versions').select('*').order('version_number', { ascending: true });
    if (ideaId) query = query.eq('idea_id', ideaId);
    const { data } = await query;
    setVersions(data ?? []);
    setLoading(false);
  }, [ideaId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { versions, loading, refetch: fetch };
}

export async function createIdea(data: {
  title: string;
  vm_id: string;
  content?: string;
  taxonomy_level?: 'insight' | 'idea' | 'project';
}): Promise<{ idea: Idea | null; artifact: Artifact | null }> {
  const { data: artifact } = await supabase
    .from('artifacts')
    .insert({
      vm_id: data.vm_id,
      title: data.title,
      content: data.content ?? '',
      artifact_type: 'note',
      origin: 'Human capture',
      status: 'active',
    })
    .select()
    .single();

  if (!artifact) return { idea: null, artifact: null };

  const { data: idea } = await supabase
    .from('ideas')
    .insert({
      title: data.title,
      current_version_id: artifact.id,
      lifecycle_status: 'active',
      taxonomy_level: data.taxonomy_level ?? 'idea',
    })
    .select()
    .single();

  if (idea) {
    await supabase.from('idea_versions').insert({
      idea_id: idea.id,
      artifact_id: artifact.id,
      version_number: 1,
    });

    await logEvent({
      event_type: 'artifact_created',
      entity_id: idea.id,
      entity_type: 'idea',
      actor: 'human',
      actor_id: 'Human Operator',
      capability: 'capture-idea',
      policy: 'v0.4',
      payload: { title: idea.title, artifact_id: artifact.id, version: 1 },
      witness_strength: 5,
    });
  }

  return { idea, artifact };
}

export async function evolveIdea(data: {
  idea_id: string;
  current_artifact_id: string;
  new_title?: string;
  new_content: string;
  rationale: string;
  vm_id: string;
}): Promise<Artifact | null> {
  const { data: newArtifact } = await supabase
    .from('artifacts')
    .insert({
      vm_id: data.vm_id,
      title: data.new_title ?? 'Refined version',
      content: data.new_content,
      artifact_type: 'note',
      origin: 'Evolved from previous version',
      status: 'active',
      parent_artifact_id: data.current_artifact_id,
    })
    .select()
    .single();

  if (!newArtifact) return null;

  const { data: versions } = await supabase
    .from('idea_versions')
    .select('version_number')
    .eq('idea_id', data.idea_id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (versions?.version_number ?? 0) + 1;

  await supabase.from('idea_versions').insert({
    idea_id: data.idea_id,
    artifact_id: newArtifact.id,
    version_number: nextVersion,
  });

  await supabase.from('edges').insert({
    source_artifact_id: newArtifact.id,
    target_artifact_id: data.current_artifact_id,
    edge_type: 'DERIVES_FROM',
  });

  await supabase.from('ideas').update({ current_version_id: newArtifact.id }).eq('id', data.idea_id);

  await logEvent({
    event_type: 'transformation_accepted',
    entity_id: newArtifact.id,
    entity_type: 'artifact',
    actor: 'human',
    actor_id: 'Human Operator',
    capability: 'evolve-idea',
    policy: 'v0.4',
    payload: { idea_id: data.idea_id, version: nextVersion, parent_artifact_id: data.current_artifact_id },
    rationale: data.rationale,
    witness_strength: 5,
  });

  return newArtifact;
}

export async function updateIdeaLifecycle(ideaId: string, status: 'active' | 'dormant' | 'merged' | 'abandoned'): Promise<void> {
  await supabase.from('ideas').update({ lifecycle_status: status }).eq('id', ideaId);

  await logEvent({
    event_type: 'transformation_branched',
    entity_id: ideaId,
    entity_type: 'idea',
    actor: 'human',
    actor_id: 'Human Operator',
    capability: 'set-lifecycle',
    policy: 'v0.4',
    payload: { lifecycle_status: status },
    witness_strength: 5,
  });
}

export async function synthesizeIdeas(data: {
  source_idea_ids: string[];
  source_artifact_ids: string[];
  title: string;
  content: string;
  rationale: string;
  vm_id: string;
}): Promise<{ idea: Idea | null; artifact: Artifact | null }> {
  const { data: artifact } = await supabase
    .from('artifacts')
    .insert({
      vm_id: data.vm_id,
      title: data.title,
      content: data.content,
      artifact_type: 'note',
      origin: `Synthesis of ${data.source_idea_ids.length} ideas`,
      status: 'active',
    })
    .select()
    .single();

  if (!artifact) return { idea: null, artifact: null };

  const { data: idea } = await supabase
    .from('ideas')
    .insert({
      title: data.title,
      current_version_id: artifact.id,
      lifecycle_status: 'active',
    })
    .select()
    .single();

  if (idea) {
    await supabase.from('idea_versions').insert({
      idea_id: idea.id,
      artifact_id: artifact.id,
      version_number: 1,
    });

    for (const sourceId of data.source_artifact_ids) {
      await supabase.from('edges').insert({
        source_artifact_id: artifact.id,
        target_artifact_id: sourceId,
        edge_type: 'DERIVES_FROM',
      });
    }

    for (const sourceIdeaId of data.source_idea_ids) {
      await updateIdeaLifecycle(sourceIdeaId, 'merged');
    }

    await logEvent({
      event_type: 'transformation_accepted',
      entity_id: idea.id,
      entity_type: 'idea',
      actor: 'human',
      actor_id: 'Human Operator',
      capability: 'synthesize',
      policy: 'v0.4',
      payload: { title: idea.title, source_ideas: data.source_idea_ids, source_artifacts: data.source_artifact_ids },
      rationale: data.rationale,
      witness_strength: 5,
    });
  }

  return { idea, artifact };
}
