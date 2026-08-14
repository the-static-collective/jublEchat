from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one exact match, found {count}")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, label: str) -> str:
    result, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected one regex match, found {count}")
    return result


# ---------------------------------------------------------------------------
# server.ts — sign the exact identities/timestamp that PostgreSQL persists.
# ---------------------------------------------------------------------------
server_path = Path("server.ts")
server = server_path.read_text()
server = replace_once(
    server,
    'import { computeEventHash } from "./src/lib/ledger";\n',
    'import { computeEventHash, signEvent } from "./src/lib/ledger";\n'
    'import {\n'
    '  buildBranchDispositionPayload,\n'
    '  buildHarvestAcceptedPayload,\n'
    '} from "./src/lib/authoritative-events";\n',
    "ledger/authoritative event imports",
)

harvest_marker = '  // Secure Server-side Harvest API (Evolve Idea, handles multiple mutations as an atomic database transaction)\n'
abandon_marker = '  // Dedicated Command Endpoint: Authoritatively declare sibling path abandoned\n'
chat_marker = '  // API endpoint for chat\n'
pre, harvest_rest = server.split(harvest_marker, 1)
harvest_section, abandon_rest = harvest_rest.split(abandon_marker, 1)
abandon_section, post = abandon_rest.split(chat_marker, 1)

harvest_section = sub_once(
    harvest_section,
    r"      // Pre-compute the secure event signature hash\n.*?      const \{ data: rpcResult, error: rpcErr \} = await serverSupabase\.rpc\('harvest_proposal_v2', \{.*?      \}\);\n",
    '''      // Mint the exact artifact/event identity before signing. PostgreSQL must persist
      // these values unchanged so replay verifies the bytes that were actually authorized.
      const newArtifactId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const eventCreatedAt = new Date().toISOString();

      const harvestPayload = buildHarvestAcceptedPayload({
        ideaId: idea_id,
        versionNumber: nextVersion,
        parentArtifactId: current_artifact_id,
        newArtifactId,
        idempotencyKey: finalIdempotencyKey,
        actorId: user.id,
        actorEmail: user.email,
        preservedTensions: preserved_tensions || [],
        unresolvedQuestions: unresolved_questions || [],
        abandonedPaths: abandoned_paths || [],
      });

      const unsignedHarvestEvent = {
        id: eventId,
        event_type: 'transformation_accepted',
        entity_id: newArtifactId,
        entity_type: 'artifact',
        actor: 'human',
        actor_id: user.email,
        capability: 'evolve-idea',
        policy: 'v0.4',
        payload: harvestPayload,
        created_at: eventCreatedAt,
        rationale,
        source_proposal_id: null,
        witness_strength: 5,
      };
      const signedHarvestEvent = signEvent(unsignedHarvestEvent as any, lastHash);
      const computedHash = String((signedHarvestEvent.payload as any)?._signature_hash || '');

      // The database validates current version/head under one global ledger lock, then
      // persists the already-signed IDs, timestamp, payload evidence, and hash exactly.
      const { data: rpcResult, error: rpcErr } = await serverSupabase.rpc('harvest_proposal_v3', {
        p_idea_id: idea_id,
        p_current_artifact_id: current_artifact_id,
        p_new_artifact_id: newArtifactId,
        p_event_id: eventId,
        p_event_created_at: eventCreatedAt,
        p_version_number: nextVersion,
        p_new_title: new_title,
        p_new_content: new_content,
        p_rationale: rationale,
        p_vm_id: vm_id,
        p_actor_id: user.id,
        p_actor_email: user.email,
        p_idempotency_key: finalIdempotencyKey,
        p_expected_last_event_hash: lastHash,
        p_computed_hash: computedHash,
        p_preserved_tensions: harvestPayload.preserved_tensions,
        p_unresolved_questions: harvestPayload.unresolved_questions,
        p_abandoned_paths: harvestPayload.abandoned_paths,
      });
''',
    "harvest authoritative write block",
)

harvest_section = replace_once(
    harvest_section,
    '''        if (rpcErr.message.includes('BASE_VERSION_NO_LONGER_CURRENT')) {
          return res.status(409).json({ error: "BASE_VERSION_NO_LONGER_CURRENT" });
        }
        if (rpcErr.message.includes('LEDGER_HEAD_CHANGED')) {
          return res.status(409).json({ error: "LEDGER_HEAD_CHANGED" });
        }
''',
    '''        if (rpcErr.message.includes('BASE_VERSION_NO_LONGER_CURRENT')) {
          return res.status(409).json({ error: "BASE_VERSION_NO_LONGER_CURRENT" });
        }
        if (rpcErr.message.includes('VERSION_NUMBER_CHANGED')) {
          return res.status(409).json({ error: "VERSION_NUMBER_CHANGED" });
        }
        if (rpcErr.message.includes('LEDGER_HEAD_CHANGED')) {
          return res.status(409).json({ error: "LEDGER_HEAD_CHANGED" });
        }
        if (rpcErr.message.includes('FORBIDDEN_CULTIVATION_RIGHTS')) {
          return res.status(403).json({ error: "Forbidden: You are not authorized to cultivate this idea." });
        }
''',
    "harvest RPC error mapping",
)

abandon_section = sub_once(
    abandon_section,
    r"      const generatedId = crypto\.randomUUID\(\);\n.*?      const \{ data: rpcResult, error: rpcErr \} = await serverSupabase\.rpc\('abandon_path_v1', \{.*?      \}\);\n",
    '''      const eventId = crypto.randomUUID();
      const eventCreatedAt = new Date().toISOString();
      const finalRationale = rationale || 'Consciously abandoned sibling path.';
      const branchPayload = buildBranchDispositionPayload({
        ideaId,
        versionId,
        versionNumber: version.version_number,
        rationale: finalRationale,
        witnessedAt: eventCreatedAt,
        actorId: user.id,
        actorEmail: user.email,
      });

      const unsignedBranchEvent = {
        id: eventId,
        event_type: 'path_abandoned',
        entity_id: versionId,
        entity_type: 'artifact',
        actor: 'human',
        actor_id: user.email,
        capability: 'abandon-path',
        policy: 'v0.4',
        payload: branchPayload,
        created_at: eventCreatedAt,
        rationale: rationale || null,
        source_proposal_id: null,
        witness_strength: 5,
      };
      const signedBranchEvent = signEvent(unsignedBranchEvent as any, lastHash);
      const finalHash = String((signedBranchEvent.payload as any)?._signature_hash || '');

      // Persist the exact branch witness identity and timestamp that were signed above.
      const { data: rpcResult, error: rpcErr } = await serverSupabase.rpc('abandon_path_v2', {
        p_idea_id: ideaId,
        p_version_id: versionId,
        p_rationale: rationale,
        p_actor_id: user.id,
        p_actor_email: user.email,
        p_expected_last_event_hash: lastHash,
        p_computed_hash: finalHash,
        p_event_id: eventId,
        p_event_created_at: eventCreatedAt,
      });
''',
    "abandon authoritative write block",
)

abandon_section = replace_once(
    abandon_section,
    '      res.json({ success: true, eventId: generatedId, hash: finalHash });\n',
    '      res.json({ success: true, eventId, hash: finalHash });\n',
    "abandon response event id",
)

server = pre + harvest_marker + harvest_section + abandon_marker + abandon_section + chat_marker + post
server_path.write_text(server)


# ---------------------------------------------------------------------------
# ledger.ts — canonical signing for new events + bounded legacy replay fallback.
# ---------------------------------------------------------------------------
ledger_path = Path("src/lib/ledger.ts")
ledger = ledger_path.read_text()
ledger = replace_once(
    ledger,
    '''  return computeDeterministicHash(contentToHash);
}

/**
 * Signs an event without mutating the caller's event or payload.
 */
''',
    '''  return computeDeterministicHash(contentToHash);
}

// Historical events were signed before JSON object keys were canonicalized. Keep
// this verifier private and replay-only: new events always use computeEventHash().
function computeLegacyEventHash(evt: JubileeEvent, prevHash: string): string {
  const legacyPayload = {
    ...(evt.payload ?? {}),
    _signature_hash: '',
  };
  const contentToHash = [
    evt.id,
    evt.event_type,
    evt.entity_id || '',
    evt.entity_type || '',
    evt.actor || '',
    evt.actor_id || '',
    JSON.stringify(legacyPayload),
    evt.witness_strength,
    prevHash
  ].join('|');
  return computeDeterministicHash(contentToHash);
}

/**
 * Signs an event without mutating the caller's event or payload.
 */
''',
    "legacy replay helper",
)

ledger = sub_once(
    ledger,
    r"      const computedHash = computeEventHash\(evt, prevHash\);\n\s*// If the event has a stored mock hash in its payload, we check it to simulate tamper checking\.\n      const expectedHash = \(evt\.payload as any\)\?\._signature_hash;\n\s*if \(expectedHash && expectedHash !== computedHash\) \{.*?      prevHash = computedHash; // Move the anchor\n",
    '''      const computedHash = computeEventHash(evt, prevHash);

      // `_signature_hash` stores the chain hash itself, so canonical replay first
      // verifies the normalized/sorted form used by all new writes. A narrowly
      // bounded fallback accepts the historical insertion-order signing form.
      const expectedHash = (evt.payload as any)?._signature_hash;
      let verifiedHash = computedHash;

      if (expectedHash && expectedHash !== computedHash) {
        const legacyComputedHash = computeLegacyEventHash(evt, prevHash);
        if (expectedHash !== legacyComputedHash) {
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
        verifiedHash = legacyComputedHash;
      }
      prevHash = expectedHash || verifiedHash; // Move the exact verified anchor
''',
    "ledger replay verification",
)
ledger_path.write_text(ledger)


# ---------------------------------------------------------------------------
# test-boundary.ts — remove assertions that manufacture PASS without execution.
# ---------------------------------------------------------------------------
boundary_path = Path("src/lib/test-boundary.ts")
boundary = boundary_path.read_text()
for start_comment, end_comment, label in [
    (
        "  // --- ASSERTION 7: Valid harvest RPC -> succeeds atomically ---\n",
        "  // --- ASSERTION 8: Stale ledger head -> LEDGER_HEAD_CHANGED ---\n",
        "fake valid-harvest pass",
    ),
    (
        "  // --- ASSERTION 10: Duplicate idempotency key -> same result, no duplicate ---\n",
        "  // --- ASSERTION 12: Tampered payload or parent hash -> replay integrity failure ---\n",
        "fake idempotency/concurrency passes",
    ),
    (
        "  // --- ASSERTION 14: Save as tension advances version from v0.2 to v0.3 ---\n",
        "  // --- ASSERTION 15: Export Project Brief Critical-Path Smoke Test ---\n",
        "fake save-as-tension pass",
    ),
]:
    if start_comment not in boundary or end_comment not in boundary:
        raise RuntimeError(f"{label}: boundary markers missing")
    before, rest = boundary.split(start_comment, 1)
    _, after = rest.split(end_comment, 1)
    boundary = before + end_comment + after
boundary_path.write_text(boundary)

print("Applied witness parity GREEN patch successfully.")
