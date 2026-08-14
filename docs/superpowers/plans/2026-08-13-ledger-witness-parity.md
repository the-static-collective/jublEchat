# Ledger Witness Parity Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make authoritative Jubilee ledger writes replay to the same integrity hash they were signed with, while durably preserving explicit Still Alive friction through the production harvest path.

**Architecture:** Keep the append-only event model and human-authority boundaries. Normalize the stored signature field back to its empty signing value during hash computation, make server and PostgreSQL persist the exact identifiers/timestamps used to construct signed events, and add durable JSONB projection fields for explicit tensions, questions, and retired-branch references.

**Tech Stack:** TypeScript, Node built-in test runner through `tsx`, Express, Supabase/PostgreSQL, GitHub Actions.

## Global Constraints
- Do not implement Nearby Growth discovery/UI here.
- Do not add embeddings or heuristic tension inference.
- Do not change authenticated-human authority for state advancement.
- Preserve append-only events and server-only mutation.
- Do not redesign global read RLS.
- Add no dependencies.

---

### Task 1: Executable RED contract
**Files:** create `src/lib/ledger-contract.test.ts`, `src/lib/authoritative-events.test.ts`, `.github/workflows/witness-parity.yml`; modify `package.json`.

- [ ] Write a test that computes a signature while `_signature_hash` is empty, stores it, replays the event, and expects `SECURE`. Current code must fail it.
- [ ] Write a test that changes signed payload content and expects `TAMPER_DETECTED`.
- [ ] Write a test for an authoritative harvest payload containing exact `preserved_tensions`, `unresolved_questions`, and `abandoned_paths` arrays.
- [ ] Add `"test:ledger": "node --import tsx --test src/lib/ledger-contract.test.ts src/lib/authoritative-events.test.ts"`.
- [ ] Add PR CI running `npm install`, `npm run test:ledger`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- [ ] Open a draft PR and witness the replay test fail before production edits.

### Task 2: Canonical sign/replay parity
**Files:** modify `src/lib/ledger.ts`; test `src/lib/ledger-contract.test.ts`.

**Interfaces:** produce `canonicalPayloadForHash(payload)` and `signEvent(event, prevHash)`.

- [ ] Implement `canonicalPayloadForHash` as a non-mutating clone that forces `_signature_hash: ''`.
- [ ] Make `computeEventHash` stringify that canonical payload instead of the stored-signature payload.
- [ ] Implement `signEvent` to compute the hash and return a cloned event with that hash stored in payload.
- [ ] Re-run focused tests: fresh sign/replay must be `SECURE`; altered payload must be `TAMPER_DETECTED`.

### Task 3: Shared authoritative payloads
**Files:** create `src/lib/authoritative-events.ts`; modify `server.ts`; test `src/lib/authoritative-events.test.ts`.

**Interfaces:** produce `buildHarvestAcceptedPayload(input)` and `buildBranchDispositionPayload(input)`.

- [ ] Implement pure builders that include `_signature_hash: ''` and preserve all explicit Still Alive arrays unchanged.
- [ ] For harvest, generate one `newArtifactId`, one `eventId`, and one `eventCreatedAt` before signing; include the real artifact ID and expected version in the signed event.
- [ ] For branch disposition, generate one event ID/timestamp and use the same timestamp for event creation and witnessed time.
- [ ] Sign both exact event drafts with `signEvent`.
- [ ] Re-run focused tests.

### Task 4: Durable SQL parity
**Files:** create `supabase/migrations/20260813193000_012_witness_parity_and_still_alive.sql`, `src/lib/sql-contract.test.ts`; modify `package.json`, `server.ts`.

- [ ] First add a SQL contract test that requires JSONB columns `preserved_tensions`, `unresolved_questions`, `abandoned_paths`, plus RPC parameters for pre-generated artifact/event IDs, timestamp, and expected version. Add this file to `test:ledger`; verify RED because migration 012 does not exist.
- [ ] Add the three JSONB columns to `idea_versions` with `NOT NULL DEFAULT '[]'::jsonb` using `ADD COLUMN IF NOT EXISTS`.
- [ ] Create hardened `harvest_proposal_v3` retaining advisory locking, ownership/base checks, CAS, idempotency and execution revocations. Accept exact pre-generated IDs/timestamp/version plus the three JSONB arrays; verify the expected version equals database next version, then persist passed values unchanged.
- [ ] Create a hardened v2 RPC for explicit branch disposition retaining authorization, membership/current-version protection, advisory lock, CAS and revocations; accept exact event ID/timestamp and persist them unchanged.
- [ ] Switch `server.ts` to the new RPCs and pass the exact signed-record inputs.
- [ ] Re-run hash, payload and SQL contract tests.

### Task 5: Remove false-positive evidence and document invariant
**Files:** modify `src/lib/test-boundary.ts`, `INVARIANTS.md`; test `src/lib/ledger-contract.test.ts`.

- [ ] Add a source-level guard requiring removal of unconditional PASS blocks for valid harvest, duplicate idempotency, concurrent harvest serialization, and Save-as-tension persistence.
- [ ] Remove those unconditional PASS blocks while leaving genuinely executed checks intact.
- [ ] Document signature normalization, exact signed-record identity persistence, and durable explicit Still Alive arrays in `INVARIANTS.md`.
- [ ] Run `npm run test:ledger`, `npm run typecheck`, `npm run lint`, `npm run build` through CI.

### Task 6: Review and completion
- [ ] Inspect the complete diff and confirm Nearby Growth UI, semantic search, unrelated RLS changes, and broad refactors are absent.
- [ ] Re-check Actions and unresolved review threads.
- [ ] Update the PR body with exact validation evidence and `Closes #1`.
- [ ] If green and unblocked, complete through the repository-supported merge path; issue #1 closes through the merged PR.
