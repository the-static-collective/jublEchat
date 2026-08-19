# Residual Lineage v0 — Refused History Without Authority

**Status:** approved design

**Issue:** #5

## Problem

`deriveNearbyGrowth(...)` correctly limits current neighbors to exact positive evidence among active ideas: direct lineage relation, exact shared ancestry, or exact shared friction. That law should not be weakened merely because Jubilee also preserves rejected proposals and abandoned historical paths.

At the same time, rejected and abandoned material is not meaningless. It is part of the idea's ancestry and may matter to later human interpretation or future proposal work. The missing surface is a read-only projection that makes this residue inspectable without pretending it is current, supported, accepted, or authoritative.

## Governing law

> **What was refused may remain available to attention. It does not become authority, current state, or evidence that the refused effect occurred.**

## Architectural decision

Add a **separate pure projection**, `deriveResidualLineage(...)`, instead of adding residue evidence classes to `deriveNearbyGrowth(...)`.

This preserves four distinct questions:

```text
Held Proposal Seeds  -> what is not yet decided?
Nearby Growth        -> what active ideas are positively related now?
Residual Lineage     -> what was rejected or later abandoned?
Why Current?         -> why is this form presently current?
```

Residual Lineage is product-local. Full Measure's Collision / residual-influence work, Project0 Snap-State, and GitBook Refusal Topology are evidence that the distinction recurs, but their types and semantics are not dependencies of this implementation.

## Input boundary

The projection consumes existing in-memory domain records only:

- `Idea`;
- `IdeaVersion`;
- `Artifact`;
- `Transformation`;
- `Proposal`;
- `JubileeEvent`.

No database, network, model, or new persistence layer belongs in the module.

The selected idea lineage is established from exact artifact parentage using the same product-local ancestry conventions already used by Nearby Growth.

## Residue classes

### Rejected proposal

A proposal qualifies only when exact records establish all of the following:

1. the proposal or its modified/generated artifact belongs to the selected idea lineage;
2. its linked transformation exists;
3. that transformation has status `rejected`;
4. the proposal remains independently identifiable.

Missing acceptance is not rejection. Matching title, content, taxonomy, or rationale is not lineage evidence.

### Abandoned path

A historical version qualifies only when explicit disposition evidence identifies it as abandoned.

Accepted sources are:

- an exact `path_abandoned` event tied to the selected idea and historical version/artifact; or
- the current explicit `IdeaVersion.abandoned_paths` projection when it resolves to a known historical version.

A version is not abandoned merely because it is old, non-current, or has a successor.

## Output contract

The v0 read model is intentionally small:

```ts
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
```

Every output explicitly carries `authority: 'none'` so downstream UI or future adapters cannot confuse presence with standing.

Results order deterministically by `kind`, then stable identifying ref. Input order is never semantic.

## UI

Keep existing `Nearby Growth: Ecological Context` structure, but add a sibling subsection titled **Residual Lineage** after the positive-neighbor section.

Each row communicates history, not recommendation:

- `Rejected proposal` or `Path later declared abandoned`;
- title or compact source label when available;
- rationale when explicitly recorded;
- witness/date metadata when present;
- no confidence score and no relevance rank.

Empty state:

```text
No residual lineage recorded.
```

Do not move residue entries into `Evidenced Neighbor Nodes`. Do not merge them with `Held Proposal Seeds`.

## Failure behavior

Malformed or incomplete records are ignored only when they cannot establish the exact residue relation. The projection must never fabricate a rejected/abandoned classification from partial evidence.

If contradictory exact evidence claims both accepted/current and rejected/abandoned standing for the same candidate, omit that residue entry in v0 rather than choosing a winner. A later issue may make contradiction diagnostics explicit.

## Compatibility

- `deriveNearbyGrowth(...)` and its output remain unchanged.
- No event type, database schema, canonical hash path, or server authority changes.
- No changes to harvest, capture, synthesis, or path-abandonment command semantics.
- Existing `Held Proposal Seeds` behavior remains unchanged.

## Non-goals

- no automatic AI prompt injection from residue;
- no reconsider/resurrection command;
- no semantic similarity or embeddings;
- no shared cross-project residue package;
- no new persistence table;
- no promotion of residue into source truth, current state, or evidence;
- no claim that rejected material is currently relevant or desirable.

## Falsifiers

The implementation is wrong if:

- an old version becomes abandoned without explicit disposition;
- a merely unaccepted proposal becomes rejected;
- same title/content/taxonomy creates residue;
- residue appears in active Nearby Growth;
- a residue entry can advance current state;
- input ordering changes output;
- derivation mutates supplied records;
- Full Measure/Project0 types are imported to make the product-local proof work.

## Follow-on door

Only after this read model is proved should Jubilee test **human-selected residual influence**: selecting one residue may seed a new proposal while the residue itself remains `authority: none` and mechanically incapable of direct state advancement. That experiment is deliberately outside v0.
