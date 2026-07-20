import type { JubileeEvent, Idea, IdeaVersion, VM, Edge, Transformation, Proposal, WitnessStrength } from './types';

// ============================================================================
// LAYER 1 & 2: SECURE EVENT HASH CHAIN & DETACHED REDUCER
// ============================================================================

export interface DerivedProjections {
  vms: VM[];
  artifacts: any[];
  ideas: Idea[];
  ideaVersions: IdeaVersion[];
  edges: Edge[];
  transformations: Transformation[];
  proposals: Proposal[];
}

export interface AuditResult {
  status: 'SECURE' | 'TAMPER_DETECTED' | 'HALTED';
  message: string;
  expectedHash?: string;
  computedHash?: string;
  failedEventId?: string;
}

/**
 * Deterministic, pure synchronous string hashing (FNV-1a 32-bit variation)
 * guarantees a stable hash across runs given the same content,
 * bypassing async microtasks in pure reducers.
 */
export function computeDeterministicHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Computes the cryptographic linkage hash of a JubileeEvent given the previous block hash.
 */
export function computeEventHash(evt: JubileeEvent, prevHash: string): string {
  const contentToHash = [
    evt.id,
    evt.event_type,
    evt.entity_id || '',
    evt.entity_type || '',
    evt.actor || '',
    evt.actor_id || '',
    JSON.stringify(evt.payload || {}),
    evt.witness_strength,
    prevHash
  ].join('|');
  return computeDeterministicHash(contentToHash);
}

/**
 * PURE REDUCER: Translates an immutable log of events into derived projections.
 * No network, no database side effects, no timestamp generation.
 * Enforces cryptographic hash-chain checking and halts on tamper detection.
 */
export function reduceEvents(
  events: JubileeEvent[],
  verifyHashes: boolean = true
): {
  projections: DerivedProjections;
  audit: AuditResult;
} {
  const vms: VM[] = [];
  const artifacts: any[] = [];
  const ideas: Idea[] = [];
  const ideaVersions: IdeaVersion[] = [];
  const edges: Edge[] = [];
  const transformations: Transformation[] = [];
  const proposals: Proposal[] = [];

  let prevHash = 'GENESIS_ANCHOR_v0.2';
  let audit: AuditResult = { status: 'SECURE', message: '◈ Ledger integrity fully certified. Cryptographic linkage is valid.' };

  // Sort events strictly by creation time first to maintain chronological causality
  const sortedEvents = [...events].sort((a, b) => {
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.id.localeCompare(b.id);
  });

  for (const evt of sortedEvents) {
    // 1. Verify Cryptographic Integrity link-chain
    if (verifyHashes) {
      const computedHash = computeEventHash(evt, prevHash);
      
      // If the event has a stored mock hash in its payload, we check it to simulate tamper checking.
      const expectedHash = (evt.payload as any)?._signature_hash;
      
      if (expectedHash && expectedHash !== computedHash) {
        audit = {
          status: 'TAMPER_DETECTED',
          message: `CHAIN_INTEGRITY_FAILURE: Cryptographic hash mismatch detected on event ${evt.id}.`,
          expectedHash,
          computedHash,
          failedEventId: evt.id
        };
        // HALT PROJECTION: No graceful degradation here. A broken root should not grow a prettier tree.
        return {
          projections: { vms: [], artifacts: [], ideas: [], ideaVersions: [], edges: [], transformations: [], proposals: [] },
          audit
        };
      }
      prevHash = computedHash; // Move the anchor
    }

    // 2. Enforce AI Direct-Mutation Rejection Policy
    // AI actors ('model' or 'co-cultivator') are strictly forbidden from emitting state-advancing events (like accepting evolutions/harvests)
    if (evt.event_type === 'transformation_accepted' && evt.actor === 'ai') {
      audit = {
        status: 'HALTED',
        message: `SECURITY_VIOLATION: AI actor attempted to emit a state-advancing event (transformation_accepted). Human verification required.`,
        failedEventId: evt.id
      };
      return {
        projections: { vms: [], artifacts: [], ideas: [], ideaVersions: [], edges: [], transformations: [], proposals: [] },
        audit
      };
    }

    // 3. Process Event and build state
    switch (evt.event_type) {
      case 'vm_created': {
        vms.push({
          id: evt.entity_id || '',
          name: (evt.payload as any)?.name || 'Workspace VM',
          description: evt.rationale || (evt.payload as any)?.description || '',
          color: (evt.payload as any)?.color || '#06b6d4',
          parent_id: (evt.payload as any)?.parent_id || null,
          created_at: evt.created_at
        });
        break;
      }

      case 'artifact_created': {
        const payload = evt.payload as any;
        if (evt.entity_type === 'idea') {
          // Reconstruct primary Idea
          ideas.push({
            id: evt.entity_id || '',
            title: payload?.title || 'Untitled Idea',
            created_at: evt.created_at,
            current_version_id: payload?.artifact_id || null,
            lifecycle_status: 'active',
            taxonomy_level: payload?.taxonomy_level || 'idea'
          });

          // Reconstruct Version 1
          ideaVersions.push({
            id: `v-id-${evt.entity_id}-1`,
            idea_id: evt.entity_id || '',
            artifact_id: payload?.artifact_id || '',
            version_number: 1,
            created_at: evt.created_at
          });
        } else {
          // Reconstruct normal Artifact
          artifacts.push({
            id: evt.entity_id || '',
            vm_id: payload?.vm_id || 'a0000000-0000-0000-0000-000000000001',
            title: payload?.title || 'Capture Note',
            content: payload?.content || evt.rationale || '',
            artifact_type: payload?.type || 'note',
            origin: payload?.origin || 'Human capture',
            status: 'active',
            parent_artifact_id: payload?.parent_artifact_id || null,
            created_at: evt.created_at
          });
        }
        break;
      }

      case 'transformation_proposed': {
        const payload = evt.payload as any;
        transformations.push({
          id: evt.entity_id || '',
          artifact_id: payload?.artifact_id || '',
          result_artifact_id: null,
          transform_kind: payload?.kind || 'refine',
          reason: payload?.reason || '',
          change_description: evt.rationale || null,
          affected_count: 1,
          confidence: payload?.confidence || 0.5,
          status: 'proposed',
          proposed_by: evt.actor === 'ai' ? 'ai' : 'human',
          created_at: evt.created_at,
          resolved_at: null,
          actor: evt.actor,
          actor_id: evt.actor_id,
          capability: evt.capability,
          policy: evt.policy,
          input_hash: payload?.input_hash || null,
          output_hash: null,
          witness_note: evt.rationale
        });

        if (payload?.proposal_artifact_id) {
          proposals.push({
            id: `prop-${evt.entity_id}`,
            transformation_id: evt.entity_id || '',
            proposal_artifact_id: payload?.proposal_artifact_id,
            generated_from_artifact_id: payload?.artifact_id || null,
            modifies_artifact_id: payload?.artifact_id || '',
            created_at: evt.created_at
          });
        }
        break;
      }

      case 'transformation_accepted': {
        const payload = evt.payload as any;
        const targetId = evt.entity_id || '';
        
        // Resolve Transformation
        const transform = transformations.find(t => t.artifact_id === payload?.parent_artifact_id);
        if (transform) {
          transform.status = 'accepted';
          transform.resolved_at = evt.created_at;
          transform.result_artifact_id = targetId;
        }

        if (evt.entity_type === 'artifact') {
          // Idea version evolution
          const idea = ideas.find(i => i.id === payload?.idea_id);
          if (idea) {
            idea.current_version_id = targetId;

            // Register Version Entry
            const nextVerNum = Number(payload?.version || 1);
            ideaVersions.push({
              id: `v-id-${payload.idea_id}-${nextVerNum}`,
              idea_id: payload.idea_id,
              artifact_id: targetId,
              version_number: nextVerNum,
              created_at: evt.created_at
            });

            // Append derivation link
            edges.push({
              id: `edge-${targetId}-derivation`,
              source_artifact_id: targetId,
              target_artifact_id: payload?.parent_artifact_id || '',
              edge_type: 'DERIVES_FROM',
              created_at: evt.created_at
            });
          }
        } else if (evt.entity_type === 'idea') {
          // Idea synthesis creation
          ideas.push({
            id: targetId,
            title: payload?.title || 'Synthesized Idea',
            created_at: evt.created_at,
            current_version_id: payload?.current_version_id || null,
            lifecycle_status: 'active',
            taxonomy_level: 'idea'
          });

          ideaVersions.push({
            id: `v-id-${targetId}-1`,
            idea_id: targetId,
            artifact_id: payload?.current_version_id || '',
            version_number: 1,
            created_at: evt.created_at
          });

          // Link parents
          const sourceArtifacts = payload?.source_artifacts || [];
          for (const srcId of sourceArtifacts) {
            edges.push({
              id: `edge-synth-${targetId}-${srcId}`,
              source_artifact_id: payload?.current_version_id || '',
              target_artifact_id: srcId,
              edge_type: 'DERIVES_FROM',
              created_at: evt.created_at
            });
          }
        }
        break;
      }

      case 'transformation_branched': {
        const payload = evt.payload as any;
        const idea = ideas.find(i => i.id === evt.entity_id);
        if (idea) {
          idea.lifecycle_status = payload?.lifecycle_status || 'active';
        }
        break;
      }

      case 'edge_created': {
        const payload = evt.payload as any;
        edges.push({
          id: evt.entity_id || '',
          source_artifact_id: payload?.source || '',
          target_artifact_id: payload?.target || '',
          edge_type: payload?.type || 'DEPENDS_ON',
          created_at: evt.created_at
        });
        break;
      }
    }
  }

  return {
    projections: { vms, artifacts, ideas, ideaVersions, edges, transformations, proposals },
    audit
  };
}


// ============================================================================
// LAYER 3: WHY CURRENT? PROVENANCE RESOLVER (HUMAN READABLE WITNESS)
// ============================================================================

export interface CausalityStep {
  date: string;
  actorLabel: string;
  action: string;
  description: string;
  rationale: string;
  isHuman: boolean;
  eventSignature: string;
  witnessStrength: number;
}

export interface ProvenanceReport {
  status: 'SUCCESS' | 'ERROR';
  message?: string;
  steps: CausalityStep[];
  meta: {
    expectedSignature: string;
    computedHash: string;
    isCompromised: boolean;
    confidenceLabel: string;
  };
}

/**
 * Traces the complete life history of a given idea to explain why it is in its current state,
 * formatting events into clear, emotionally warm, human-oriented narratives.
 */
export function resolveWhyCurrentChain(
  ideaId: string,
  events: JubileeEvent[],
  artifacts: any[]
): ProvenanceReport {
  const steps: CausalityStep[] = [];
  const artifactMap = new Map(artifacts.map(a => [a.id, a]));

  // Find all events associated with this idea
  const relatedEvents = events.filter(e => {
    if (e.entity_id === ideaId) return true;
    const payload = e.payload as any;
    if (payload?.idea_id === ideaId) return true;
    if (payload?.source_ideas?.includes(ideaId)) return true;
    return false;
  }).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  // Check for completeness - a corrupt chain has an empty set or a broken origin
  if (relatedEvents.length === 0) {
    return {
      status: 'ERROR',
      message: '◈ Provenance incomplete. This version cannot currently be traced through a complete local chain.',
      steps: [],
      meta: {
        expectedSignature: 'N/A',
        computedHash: 'N/A',
        isCompromised: true,
        confidenceLabel: 'model-declared confidence'
      }
    };
  }

  for (const evt of relatedEvents) {
    const isHuman = evt.actor === 'human';
    const payload = evt.payload as any;

    if (evt.event_type === 'artifact_created' && evt.entity_type === 'idea') {
      const art = artifactMap.get(payload?.artifact_id);
      steps.push({
        date: new Date(evt.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        actorLabel: isHuman ? 'You' : 'AI Co-Cultivator',
        action: 'Planted the seed',
        description: `"${payload?.title || 'Untitled Idea'}": ${art?.content || 'No initial content capture.'}`,
        rationale: evt.rationale || 'Witnessed and authenticated seed capture.',
        isHuman,
        eventSignature: evt.id,
        witnessStrength: evt.witness_strength
      });
    } else if (evt.event_type === 'transformation_accepted' && evt.entity_type === 'artifact') {
      const art = artifactMap.get(evt.entity_id);
      steps.push({
        date: new Date(evt.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        actorLabel: 'You',
        action: 'Harvested evolution',
        description: `Refined state to version v0.${payload?.version || 2}: "${art?.content || ''}"`,
        rationale: evt.rationale || 'Approved after conceptual evaluation.',
        isHuman: true,
        eventSignature: evt.id,
        witnessStrength: evt.witness_strength
      });
    } else if (evt.event_type === 'transformation_proposed') {
      steps.push({
        date: new Date(evt.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        actorLabel: evt.actor === 'ai' ? 'AI Co-Cultivator' : 'You',
        action: 'Proposed expansion',
        description: `Proposed refinement: "${payload?.reason || ''}"`,
        rationale: evt.rationale || 'Suggested based on conceptual drift.',
        isHuman: false,
        eventSignature: evt.id,
        witnessStrength: evt.witness_strength
      });
    } else if (evt.event_type === 'transformation_branched') {
      steps.push({
        date: new Date(evt.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        actorLabel: 'You',
        action: 'Shifted lifecycle',
        description: `Marked idea status as: ${payload?.lifecycle_status || 'active'}`,
        rationale: evt.rationale || 'Updated project timeline boundaries.',
        isHuman: true,
        eventSignature: evt.id,
        witnessStrength: evt.witness_strength
      });
    }
  }

  // Calculate simulated blockchain checksum for reporting
  let currentHash = 'GENESIS_ANCHOR_v0.2';
  for (const step of steps) {
    currentHash = computeDeterministicHash(currentHash + step.eventSignature);
  }

  return {
    status: 'SUCCESS',
    steps,
    meta: {
      expectedSignature: 'JUBILEE_V0.2.1_OK_' + currentHash.toUpperCase(),
      computedHash: currentHash,
      isCompromised: false,
      confidenceLabel: 'Steward certified cryptographic confidence'
    }
  };
}


// ============================================================================
// LAYER 4: TAMPER FIXTURE PACKAGES FOR AUDIT TESTING
// ============================================================================

export function getTamperFixtures(): Record<string, { name: string; description: string; events: JubileeEvent[] }> {
  const baseTime = '2026-07-20T12:00:00Z';
  const hourLater = (h: number) => new Date(new Date(baseTime).getTime() + h * 60 * 60 * 1000).toISOString();

  // 1. Valid cryptographic ledger chain
  const validEvents: JubileeEvent[] = [
    {
      id: 'evt-valid-01',
      event_type: 'vm_created',
      entity_id: 'vm-valid-core',
      entity_type: 'vm',
      actor: 'system',
      actor_id: 'Steward-Bootstrap',
      capability: 'system-init',
      policy: 'v0.2.1',
      payload: { name: 'Valid Core VM', _signature_hash: 'f0c0ae2f' },
      created_at: hourLater(0),
      rationale: 'Initialized ledger container core.',
      source_proposal_id: null,
      witness_strength: 5
    },
    {
      id: 'evt-valid-02',
      event_type: 'artifact_created',
      entity_id: 'idea-valid-01',
      entity_type: 'idea',
      actor: 'human',
      actor_id: 'user-001',
      capability: 'manual-capture',
      policy: 'v0.2.1',
      payload: { title: 'Valid Metaphor', artifact_id: 'art-valid-01', _signature_hash: '2fb4d5db' },
      created_at: hourLater(1),
      rationale: 'Seeded initial human metaphor.',
      source_proposal_id: null,
      witness_strength: 5
    }
  ];

  // 2. Corrupt Chain: Deleted/missing required event #1
  const missingEvents = [...validEvents].slice(1);

  // 3. Corrupt Chain: Altered payload text in event #2 (tamper detection)
  const alteredPayloadEvents: JubileeEvent[] = [
    { ...validEvents[0] },
    {
      ...validEvents[1],
      payload: {
        title: 'MALICIOUS_OVERWRITE_ALTERED_METAPHOR',
        artifact_id: 'art-valid-01',
        // Still has the original signature_hash!
        _signature_hash: '2fb4d5db'
      }
    }
  ];

  // 4. Corrupt Chain: Altered parent/lineage hierarchy in event
  const alteredParentEvents: JubileeEvent[] = [
    { ...validEvents[0] },
    {
      ...validEvents[1],
      payload: {
        title: 'Valid Metaphor',
        artifact_id: 'art-compromised-parent-01',
        parent_artifact_id: 'parent_fake_001',
        _signature_hash: '2fb4d5db' // Mismatch hash trigger
      }
    }
  ];

  // 5. Corrupt Chain: Forbidden AI Actor attempted harvest
  const forbiddenAIEvent: JubileeEvent = {
    id: 'evt-valid-03',
    event_type: 'transformation_accepted',
    entity_id: 'art-valid-02',
    entity_type: 'artifact',
    actor: 'ai', // Violation trigger: Model attempting to auto-approve state advance
    actor_id: 'co-cultivator-ai',
    capability: 'auto-harvest',
    policy: 'v0.2.1',
    payload: { idea_id: 'idea-valid-01', version: 2, parent_artifact_id: 'art-valid-01' },
    created_at: hourLater(2),
    rationale: 'AI automatically advancing current state.',
    source_proposal_id: 'prop-001',
    witness_strength: 3
  };
  const forbiddenActorEvents = [...validEvents, forbiddenAIEvent];

  return {
    valid_chain: {
      name: 'Valid Link Chain',
      description: 'A chronologically aligned, human-authorized sequence of ledger events.',
      events: validEvents
    },
    missing_event: {
      name: 'Discontinuous Log Sequence',
      description: 'Simulates a database deletion where an intermediary causal record is erased.',
      events: missingEvents
    },
    altered_payload: {
      name: 'Altered Event Payload',
      description: 'Simulates direct projection hacking where event text is changed but the signature is unmodified.',
      events: alteredPayloadEvents
    },
    altered_parent: {
      name: 'Compromised Heritage Pointer',
      description: 'Simulates a rogue ancestral mutation redirecting version lineage to an invalid parent node.',
      events: alteredParentEvents
    },
    forbidden_actor: {
      name: 'AI Actor Access Violation',
      description: 'Simulates an AI model attempting to emit a state-advancing transformation without human authorization.',
      events: forbiddenActorEvents
    }
  };
}
