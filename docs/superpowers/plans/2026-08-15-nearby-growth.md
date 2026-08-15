# Nearby Growth v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace same-taxonomy Nearby Growth guesses with a deterministic reader-visible projection over explicit lineage and friction evidence.

**Architecture:** Put all admission logic in one pure `src/lib/nearby-growth.ts` module. The React surface consumes its result and remains presentation-only. Existing persisted records and ledger authority are unchanged.

**Tech Stack:** TypeScript, React 18, Node test runner via `tsx`, Vite.

## Global Constraints

- Same taxonomy is not evidence.
- Only active candidate ideas are eligible in v0.
- Shared friction means exact `FrictionRef.id`, never text similarity.
- No embeddings, AI inference, schema migration, persistence, or opaque relevance score.
- Result order is deterministic by title then idea ID.
- `Held Proposal Seeds` behavior remains unchanged.

---

### Task 1: Pure Nearby Growth projection

**Files:**
- Create: `src/lib/nearby-growth.test.ts`
- Create: `src/lib/nearby-growth.ts`
- Modify: `package.json`
- Modify: `.github/workflows/witness-parity.yml`

**Interfaces:**
- Consumes: `Idea[]`, `IdeaVersion[]`, `Artifact[]`, `Edge[]`, selected idea ID.
- Produces: `deriveNearbyGrowth(input): NearbyGrowthResult[]`, where each result contains the candidate `idea` and an ordered `evidence` array of `direct_relation | shared_ancestor | shared_friction`.

- [ ] **Step 1: Write failing tests**

Cover: taxonomy-only exclusion; direct lineage edge; shared exact ancestor; exact friction ID; same friction text/different IDs exclusion; inactive exclusion; deterministic order/input immutability.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:nearby-growth`
Expected: FAIL because `./nearby-growth` does not yet exist.

- [ ] **Step 3: Implement the minimum pure projection**

Build artifact lineages by following `parent_artifact_id`; compare exact artifact IDs and explicit current-version friction IDs only; deduplicate evidence classes; sort output by lower-cased title and then ID.

- [ ] **Step 4: Run focused and repository gates**

Run: `npm run test:nearby-growth && npm run test:ledger && npm run typecheck && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 5: Commit**

Commit production/test changes separately from the prior design-plan commits.

### Task 2: Replace heuristic UI subsection

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `deriveNearbyGrowth({ selectedIdeaId, ideas, versions: allIdeaVersions, artifacts, edges })`.
- Produces: existing Nearby Growth panel with `Evidenced Neighbor Nodes`, evidence badges, and the empty copy `No evidenced nearby growth yet.`

- [ ] **Step 1: Add the pure projection import and derive results near the existing provenance calculations**

Do not change `Held Proposal Seeds`.

- [ ] **Step 2: Replace only the same-taxonomy sibling block**

Render every evidenced neighbor deterministically and label the evidence classes. Remove the heuristic `ideas.filter(...taxonomy_level...)` expression.

- [ ] **Step 3: Run repository gates**

Run: `npm run test:nearby-growth && npm run test:ledger && npm run typecheck && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 4: Review the diff for scope**

Verify no persistence, ledger, schema, proposal, or unrelated UI behavior changed.

- [ ] **Step 5: Commit**

Commit the bounded UI integration.

### Task 3: PR evidence and review

**Files:**
- No planned product files.

- [ ] **Step 1: Open/update a PR linked with `Closes #3`**

- [ ] **Step 2: Require exact-head CI**

Witness parity must pass ledger contracts, focused Nearby Growth test, typecheck, lint, and build.

- [ ] **Step 3: Run Riqor/independent review**

Specifically challenge accidental semantic inference, lineage traversal errors, input mutation, and UI scope creep.

- [ ] **Step 4: Resolve valid Develoop/review findings and re-run exact-head gates**

- [ ] **Step 5: Stop at verified ready-to-land state**

PR Completion landing requires fresh explicit per-PR confirmation for the exact ready head SHA.
