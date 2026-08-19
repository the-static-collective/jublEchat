# Residual Lineage v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, read-only Residual Lineage projection for rejected proposals and explicitly abandoned historical paths without changing Nearby Growth, harvest authority, or persistence.

**Architecture:** Implement one pure domain module parallel to `nearby-growth.ts`, then wire its result into the existing Garden/idea detail UI as a separate historical subsection. Existing Supabase hooks provide proposals, transformations, events, versions, and artifacts; no schema or server mutation changes are required.

**Tech Stack:** TypeScript 5.5, Node test runner via `tsx`, React 18, existing Supabase read hooks, Vite.

**Spec:** `docs/superpowers/specs/2026-08-19-residual-lineage-design.md`

## Global Constraints

- Do not modify `deriveNearbyGrowth(...)` semantics or result shape.
- Do not add a database migration, event type, canonicalizer, hash path, server mutation route, model call, or external dependency.
- Admission must use exact proposal/transformation/path-disposition evidence only; no title/content/taxonomy similarity.
- A non-current version is not abandoned unless explicit disposition evidence says so.
- A merely unaccepted proposal is not rejected.
- Every residual result carries `authority: 'none'`.
- Held Proposal Seeds remain separate from rejected/abandoned residue.
- Inputs remain immutable and output order deterministic.

---

### Task 1: Pure Residual Lineage projection

**Files:**
- Create: `src/lib/residual-lineage.ts`
- Create: `src/lib/residual-lineage.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `Idea`, `IdeaVersion`, `Artifact`, `Transformation`, `Proposal`, and `JubileeEvent` from `src/lib/types.ts`.
- Produces:

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

export interface DeriveResidualLineageInput {
  selectedIdeaId: string;
  ideas: readonly Idea[];
  versions: readonly IdeaVersion[];
  artifacts: readonly Artifact[];
  transformations: readonly Transformation[];
  proposals: readonly Proposal[];
  events: readonly JubileeEvent[];
}

export function deriveResidualLineage(
  input: DeriveResidualLineageInput,
): ResidualLineageEntry[];
```

- [ ] **Step 1: Write the failing test fixture helpers and rejected-proposal cases**

Create `src/lib/residual-lineage.test.ts` with helpers mirroring the focused style of `nearby-growth.test.ts` and these first assertions:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveResidualLineage } from './residual-lineage';
import type {
  Artifact,
  Idea,
  IdeaVersion,
  JubileeEvent,
  Proposal,
  Transformation,
} from './types';

test('exact rejected proposal on the selected lineage remains queryable with no authority', () => {
  const result = deriveResidualLineage({
    selectedIdeaId: 'idea-a',
    ideas: [idea('idea-a', 'art-current')],
    versions: [version('iv-current', 'idea-a', 'art-current')],
    artifacts: [artifact('art-current'), artifact('proposal-art')],
    transformations: [transformation('tx-rejected', 'art-current', 'rejected')],
    proposals: [proposal('proposal-1', 'tx-rejected', 'proposal-art', 'art-current')],
    events: [],
  });

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    kind: 'rejected_proposal',
    ideaId: 'idea-a',
    sourceArtifactId: 'proposal-art',
    proposalId: 'proposal-1',
    versionId: null,
    eventId: null,
    rationale: 'test reason',
    witnessedAt: '2026-08-19T00:00:01.000Z',
    authority: 'none',
  });
});

test('proposed or accepted transformation is not rejected residue', () => {
  for (const status of ['proposed', 'accepted'] as const) {
    const result = deriveResidualLineage({
      selectedIdeaId: 'idea-a',
      ideas: [idea('idea-a', 'art-current')],
      versions: [version('iv-current', 'idea-a', 'art-current')],
      artifacts: [artifact('art-current'), artifact('proposal-art')],
      transformations: [transformation('tx', 'art-current', status)],
      proposals: [proposal('proposal-1', 'tx', 'proposal-art', 'art-current')],
      events: [],
    });
    assert.deepEqual(result, []);
  }
});
```

The helper constructors must fill every required field from `src/lib/types.ts`; do not weaken domain types with `any`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --import tsx --test src/lib/residual-lineage.test.ts
```

Expected: FAIL because `./residual-lineage` does not exist.

- [ ] **Step 3: Implement exact selected-lineage collection and rejected-proposal derivation**

Create `src/lib/residual-lineage.ts`.

Use the same parent-artifact walk shape as Nearby Growth, but keep it local to this module for v0. A proposal qualifies only when its linked transformation is exactly `rejected` and one of the exact transformation/proposal lineage refs intersects the selected artifact lineage:

```ts
const proposalTouchesSelectedLineage =
  selectedLineage.has(proposal.modifies_artifact_id) ||
  (proposal.generated_from_artifact_id !== null &&
    selectedLineage.has(proposal.generated_from_artifact_id)) ||
  selectedLineage.has(transformation.artifact_id);
```

Emit the proposal artifact as `sourceArtifactId`, transformation `reason` as rationale, and `resolved_at ?? created_at` as `witnessedAt`.

Do not classify missing acceptance as rejection.

- [ ] **Step 4: Run focused tests and confirm GREEN for rejected proposals**

Run:

```bash
node --import tsx --test src/lib/residual-lineage.test.ts
```

Expected: PASS for the first rejected-proposal tests.

- [ ] **Step 5: Add RED tests for explicit abandoned paths**

Add tests that prove:

```ts
test('path_abandoned event makes the historical version visible without changing its identity', ...)
test('non-current version without explicit disposition is not abandoned residue', ...)
test('current version is never returned as abandoned residue', ...)
```

Use a `path_abandoned` `JubileeEvent` whose payload exactly follows `buildBranchDispositionPayload(...)`:

```ts
payload: {
  idea_id: 'idea-a',
  version_id: 'art-old',
  version_number: 1,
  actor_kind: 'human',
  rationale: 'This branch no longer carries the chosen direction.',
  witnessed_at: '2026-08-19T00:00:02.000Z',
  actor: { source: 'authenticated_session', id: 'human-1', email: null },
  _signature_hash: 'fixture-hash',
}
```

Expected abandoned result:

```ts
{
  kind: 'abandoned_path',
  ideaId: 'idea-a',
  sourceArtifactId: 'art-old',
  proposalId: null,
  versionId: 'iv-old',
  eventId: 'event-abandon',
  rationale: 'This branch no longer carries the chosen direction.',
  witnessedAt: '2026-08-19T00:00:02.000Z',
  authority: 'none',
}
```

- [ ] **Step 6: Implement explicit abandoned-path derivation**

Build exact maps for versions/artifacts. Admit a `path_abandoned` event only when:

```ts
event.event_type === 'path_abandoned'
payload.idea_id === selectedIdeaId
payload.version_id resolves to a non-current IdeaVersion.artifact_id for selectedIdeaId
```

Also support existing explicit `currentVersion.abandoned_paths` refs when an entry can be resolved unambiguously by ID or `version_number` to a historical selected-idea version. Never infer abandonment from non-current status alone.

If both the event and the current-version projection name the same historical path, deduplicate by the historical version/artifact identity and prefer the exact event's `eventId`, rationale, and witnessed time.

- [ ] **Step 7: Add determinism, no-similarity, and immutability tests**

Add tests proving:

```ts
test('matching title content or taxonomy cannot create residue', ...)
test('result order is deterministic across shuffled inputs', ...)
test('derivation does not mutate source records', ...)
```

Sort final results by fixed kind order (`rejected_proposal`, then `abandoned_path`) and stable identifying ref (`proposalId ?? versionId ?? sourceArtifactId ?? ''`).

- [ ] **Step 8: Add repository script and run the Task 1 gate**

Add to `package.json`:

```json
"test:residual-lineage": "node --import tsx --test src/lib/residual-lineage.test.ts"
```

Run:

```bash
npm run test:residual-lineage
npm run test:nearby-growth
npm run test:ledger
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/lib/residual-lineage.ts src/lib/residual-lineage.test.ts package.json
git commit -m "feat: derive residual lineage without authority"
```

---

### Task 2: Read-only Garden integration

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `deriveResidualLineage(...)`, `useTransformations()`, `useProposals()`, plus the existing ideas/versions/artifacts/events.
- Produces: one separate `Residual Lineage` UI subsection; no commands and no writes.

- [ ] **Step 1: Add the missing read hooks and pure derivation**

In `src/App.tsx`, extend imports:

```ts
import {
  useIdeas,
  useIdeaVersions,
  useArtifacts,
  useEvents,
  useEdges,
  useTransformations,
  useProposals,
  createIdea,
  evolveIdea,
  logEvent,
  synthesizeIdeas,
} from './lib/hooks';
import { deriveResidualLineage } from './lib/residual-lineage';
```

Inside `AppContent()` load the existing read hooks:

```ts
const { transformations } = useTransformations();
const { proposals } = useProposals();
```

Then derive only from already-loaded state:

```ts
const residualLineage = useMemo(
  () => selectedIdea
    ? deriveResidualLineage({
        selectedIdeaId: selectedIdea.id,
        ideas,
        versions: allIdeaVersions,
        artifacts,
        transformations,
        proposals,
        events,
      })
    : [],
  [selectedIdea, ideas, allIdeaVersions, artifacts, transformations, proposals, events],
);
```

- [ ] **Step 2: Render Residual Lineage as a separate historical subsection**

Locate the existing `Nearby Growth: Ecological Context` / `Evidenced Neighbor Nodes` area. Add a sibling heading **Residual Lineage** after positive neighbors and without changing `Held Proposal Seeds`.

For each entry render:

```text
Rejected proposal
or
Path later declared abandoned

<explicit rationale when present>
<date/witness metadata when present>
Historical influence only · no authority
```

Do not add a button, confidence meter, relevance score, or selection behavior in v0.

Empty state must render exactly:

```text
No residual lineage recorded.
```

- [ ] **Step 3: Verify UI integration does not change the product authority path**

Run:

```bash
npm run typecheck
npm run lint
npm run build
```

Expected: PASS. Inspect the diff and confirm no call to `createIdea`, `evolveIdea`, `logEvent`, `synthesizeIdeas`, or Supabase mutation was added as part of Residual Lineage rendering.

- [ ] **Step 4: Commit Task 2**

```bash
git add src/App.tsx
git commit -m "feat: show residual lineage beside nearby growth"
```

---

### Task 3: CI gate and exact-head verification

**Files:**
- Modify: `.github/workflows/witness-parity.yml`

**Interfaces:**
- Consumes: `npm run test:residual-lineage` from Task 1.
- Produces: repository CI protection against future residue/authority collapse.

- [ ] **Step 1: Add Residual Lineage to the existing verify job**

Insert after Nearby Growth:

```yaml
      - name: Residual Lineage contract
        run: npm run test:residual-lineage
```

Do not change Node version, install behavior, or existing gates.

- [ ] **Step 2: Run the full local contract before pushing**

Run:

```bash
npm run test:ledger
npm run test:nearby-growth
npm run test:residual-lineage
npm run typecheck
npm run lint
npm run build
```

Expected: all commands PASS. Existing repository lint warnings may remain only if they are already non-failing and unchanged.

- [ ] **Step 3: Review the exact diff against the spec falsifiers**

Confirm mechanically:

```text
no migration
no server.ts change
no canonical hashing change
no Nearby Growth result-shape change
no model/network call in residual-lineage.ts
no direct state mutation from Residual Lineage UI
no Full Measure / Project0 source import
```

- [ ] **Step 4: Commit CI coverage**

```bash
git add .github/workflows/witness-parity.yml
git commit -m "test: gate residual lineage contract"
```

- [ ] **Step 5: Push and require exact-head GitHub Actions evidence**

Push the implementation branch and wait for **Witness parity / verify** on the exact PR head.

The implementation is ready for review only when Actions reports:

```text
Ledger contracts          PASS
Nearby Growth contract    PASS
Residual Lineage contract PASS
Typecheck                 PASS
Lint                      PASS
Build                     PASS
```

Do not merge on prose-only inspection if the exact-head workflow has not passed.
