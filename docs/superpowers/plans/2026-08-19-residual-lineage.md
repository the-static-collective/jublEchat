# Residual Lineage v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, read-only Residual Lineage projection for rejected proposals and explicitly abandoned historical paths without changing Nearby Growth, harvest authority, or persistence.

**Architecture:** Add one pure domain module parallel to `nearby-growth.ts`, then render its output as a separate historical subsection in the existing Garden. Existing read hooks already expose proposals, transformations, events, versions, and artifacts; v0 requires no schema or server mutation change.

**Tech Stack:** TypeScript 5.5, Node test runner via `tsx`, React 18, existing Supabase read hooks, Vite.

**Spec:** `docs/superpowers/specs/2026-08-19-residual-lineage-design.md`

## Global Constraints

- Do not modify `deriveNearbyGrowth(...)` semantics or result shape.
- Do not add a migration, event type, canonicalizer, hash path, server mutation route, model call, or external dependency.
- Admission uses exact proposal/transformation/path-disposition evidence only; never title/content/taxonomy similarity.
- A non-current version is not abandoned unless explicit disposition evidence says so.
- A merely unaccepted proposal is not rejected.
- Every residual result carries `authority: 'none'`.
- Held Proposal Seeds remain separate from rejected/abandoned residue.
- Inputs remain immutable and output order deterministic.
- v0 exposes **historical residue**, not an executable influence path. Human-selected residual influence is a later slice.

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

- [ ] **Step 1: Write the rejected-proposal RED tests**

Create `src/lib/residual-lineage.test.ts` with typed fixture helpers matching all required fields from `src/lib/types.ts`. Do not use `any` in the helpers.

Add:

```ts
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

  assert.deepEqual(result, [{
    kind: 'rejected_proposal',
    ideaId: 'idea-a',
    sourceArtifactId: 'proposal-art',
    proposalId: 'proposal-1',
    versionId: null,
    eventId: null,
    rationale: 'test reason',
    witnessedAt: '2026-08-19T00:00:01.000Z',
    authority: 'none',
  }]);
});

test('every non-rejected transformation status stays out of rejected residue', () => {
  for (const status of ['proposed', 'accepted', 'branched'] as const) {
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

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --import tsx --test src/lib/residual-lineage.test.ts
```

Expected: FAIL because `./residual-lineage` does not exist.

- [ ] **Step 3: Implement exact lineage collection and rejected-proposal derivation**

Create `src/lib/residual-lineage.ts`.

Collect the selected artifact ancestry from `Idea.current_version_id` through `Artifact.parent_artifact_id`, stopping on missing parents or repeats.

A proposal qualifies only when its exact linked transformation exists, `transformation.status === 'rejected'`, and one exact source relation touches the selected lineage:

```ts
const proposalTouchesSelectedLineage =
  selectedLineage.has(proposal.modifies_artifact_id) ||
  (proposal.generated_from_artifact_id !== null &&
    selectedLineage.has(proposal.generated_from_artifact_id)) ||
  selectedLineage.has(transformation.artifact_id);
```

Emit:

```ts
{
  kind: 'rejected_proposal',
  ideaId: selectedIdea.id,
  sourceArtifactId: proposal.proposal_artifact_id,
  proposalId: proposal.id,
  versionId: null,
  eventId: null,
  rationale: transformation.reason || null,
  witnessedAt: transformation.resolved_at ?? transformation.created_at ?? null,
  authority: 'none',
}
```

Missing acceptance is never treated as rejection.

- [ ] **Step 4: Run the focused test and confirm rejected-proposal GREEN**

Run:

```bash
node --import tsx --test src/lib/residual-lineage.test.ts
```

Expected: current rejected-proposal tests PASS.

- [ ] **Step 5: Add path-abandonment RED tests**

Add:

```ts
test('path_abandoned event exposes a historical version without rewriting it', ...)
test('non-current version without explicit disposition is not abandoned residue', ...)
test('current version is never returned as abandoned residue', ...)
test('abandoned_paths projection resolves by exact version_number, not by guessing its id semantics', ...)
```

The event fixture must follow `buildBranchDispositionPayload(...)` exactly:

```ts
payload: {
  idea_id: 'idea-a',
  version_id: 'art-old',
  version_number: 1,
  actor_kind: 'human',
  rationale: 'This branch no longer carries the chosen direction.',
  witnessed_at: '2026-08-19T00:00:02.000Z',
  actor: {
    source: 'authenticated_session',
    id: 'human-1',
    email: null,
  },
  _signature_hash: 'fixture-hash',
}
```

Expected event-backed result:

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

Build maps for selected-idea versions by artifact ID and by `version_number`.

Admit a `path_abandoned` event only when:

```ts
event.event_type === 'path_abandoned'
payload.idea_id === selectedIdeaId
payload.version_id resolves to an IdeaVersion.artifact_id owned by selectedIdeaId
resolved artifact is not selectedIdea.current_version_id
```

For the existing `currentVersion.abandoned_paths` projection, use `AbandonedPathRef.version_number` as the mapping coordinate. Do **not** assume `AbandonedPathRef.id` is an artifact ID or IdeaVersion ID. Resolve only when the `version_number` maps unambiguously to one historical version of the selected idea.

If an exact `path_abandoned` event and `abandoned_paths` projection name the same historical version, emit one entry and prefer the event's `eventId`, rationale, and witnessed time.

- [ ] **Step 7: Add falsifier, determinism, and immutability tests**

Add:

```ts
test('matching title content or taxonomy cannot create residue', ...)
test('result order is deterministic across shuffled inputs', ...)
test('derivation does not mutate source records', ...)
test('residual derivation does not change deriveNearbyGrowth output', ...)
```

Final sort:

```ts
const kindOrder: Record<ResidualLineageKind, number> = {
  rejected_proposal: 0,
  abandoned_path: 1,
};
```

Sort by kind order and then `proposalId ?? versionId ?? sourceArtifactId ?? ''` using deterministic string comparison.

- [ ] **Step 8: Add the focused script and run the Task 1 gate**

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
- Consumes: `deriveResidualLineage(...)`, `useTransformations()`, `useProposals()`, existing ideas/versions/artifacts/events.
- Produces: one separate historical `Residual Lineage` subsection; no commands and no writes.

- [ ] **Step 1: Load existing read surfaces and derive residue**

Extend imports:

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

Inside `AppContent()`:

```ts
const { transformations } = useTransformations();
const { proposals } = useProposals();

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

- [ ] **Step 2: Render the separate historical subsection**

In the existing `Nearby Growth: Ecological Context` area, retain `Held Proposal Seeds` and `Evidenced Neighbor Nodes` unchanged, then add **Residual Lineage**.

Render each entry as either:

```text
Rejected proposal
```

or:

```text
Path later declared abandoned
```

Show only explicit rationale/date metadata when present, then the fixed footer:

```text
Historical residue · no authority
```

Do not add a button, confidence meter, relevance score, auto-selection, prompt injection, or other action in v0.

Empty state:

```text
No residual lineage recorded.
```

- [ ] **Step 3: Verify the UI remains read-only**

Run:

```bash
npm run typecheck
npm run lint
npm run build
```

Inspect the diff and confirm Residual Lineage added no new call to `createIdea`, `evolveIdea`, `logEvent`, `synthesizeIdeas`, Supabase mutation, or `/api/*` mutation route.

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
- Produces: CI protection against later residue/current-state collapse.

- [ ] **Step 1: Add the focused contract to the existing verify job**

After the Nearby Growth step add:

```yaml
      - name: Residual Lineage contract
        run: npm run test:residual-lineage
```

Do not alter the existing Node version, install step, ledger gate, Nearby Growth gate, typecheck, lint, or build commands.

- [ ] **Step 2: Run the full repository contract locally**

Run:

```bash
npm run test:ledger
npm run test:nearby-growth
npm run test:residual-lineage
npm run typecheck
npm run lint
npm run build
```

Expected: all PASS. Existing non-failing lint warnings may remain only if unchanged by this slice.

- [ ] **Step 3: Review the exact diff against the design falsifiers**

Confirm:

```text
no migration
no server.ts change
no canonical hashing change
no Nearby Growth result-shape change
no model/network call in residual-lineage.ts
no mutation action in Residual Lineage UI
no Full Measure / Project0 source import
```

- [ ] **Step 4: Commit CI coverage**

```bash
git add .github/workflows/witness-parity.yml
git commit -m "test: gate residual lineage contract"
```

- [ ] **Step 5: Require exact-head GitHub Actions evidence**

Push the implementation branch and wait for **Witness parity / verify** on the exact PR head.

Ready-for-review evidence must show:

```text
Ledger contracts          PASS
Nearby Growth contract    PASS
Residual Lineage contract PASS
Typecheck                 PASS
Lint                      PASS
Build                     PASS
```

Do not merge on prose-only inspection when the exact-head workflow has not passed.
