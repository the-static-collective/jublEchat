# Jubilee Workspace Constitutional Kernel — Architectural Invariants

This document details the core architectural, security, and cryptographic invariants of the Jubilee Workspace platform (tagged as `jubilee-v0.2.2-constitutional-kernel`).

---

## 1. Architectural Invariants & Core Philosophy

- **Authoritative Change Ledger**: State changes (including idea creation, cultivation/evolution, lifecycle status updates, and path abandonment) are not represented by direct database updates. Instead, the system operates as an **append-only event store** where the present state of the system is a deterministic, time-projected fold over a chronologically ordered sequence of events.
- **Unified Space Continuum**: Cultivation ideas are situated in a unified spatial grid. Users see adjacent ideas and trace ancestral paths continuously through space.
- **Still Alive (No AI Slop / No Heuristics)**: Unresolved design tensions and unanswered questions must be derived **exclusively from explicit historical actions and dispositions**. No heuristic, parsing-based, or AI-synthesized assumptions are allowed to declare a structural friction resolved.
- **Overlay Preservation**: Abandoning a branch or declaring a path disposition is modeled as a later human overlay. Historical artifacts themselves remain unedited and fully preserved in the ancestry ledger to retain complete context.

---

## 2. Security & Command Boundary Isolation

The system enforces a strict division of authority between client-side submissions and server-side computations:

- **Generic Logs Restriction**: The `/api/events/log` endpoint acts as a general utility path and is restricted via a strict event type allowlist. Highly sensitive or ledger-consequential events (such as `path_abandoned`) are explicitly prohibited on this endpoint to block spoofed payloads.
- **Dedicated Command Paths**: State-changing operations of high impact use dedicated, authenticated endpoints like:
  `POST /api/ideas/:ideaId/versions/:versionId/abandon`
- **Server-Side Verification**: On these command paths, the server:
  1. Derives the human actor identity from the verified session token.
  2. Verifies the actor is authorized to cultivate the target idea (ownership validation).
  3. Confirms the target past version strictly belongs to the specified idea.
  4. Explicitly rejects abandonment of the current active version (which requires a transition/harvest).
  5. Constructs the event type and canonical payload internally, populating security metadata.
  6. Appends the event authoritatively through the secure hashing chain.

---

## 3. Cryptographic Link Chain (Ledger Integrity)

- Every event's payload includes a cryptographic integrity hash (`_signature_hash`) that binds it to the previous event's hash, constructing a chronological hash chain.
- **Note on Nomenclature**: `_signature_hash` is a legacy column name in the database schema. It does NOT represent a cryptographic public-key digital signature; rather, it represents an unsigned **integrity chain hash** (or `chain_hash`) that guarantees immutable, append-only order sequence verification.
- The default genesis anchor is `GENESIS_ANCHOR_v0.2`.
- Any modification, insertion out of order, or tampering with historical events breaks the verification hash sequence, causing the user interface to flag an integrity mismatch.

---

## 4. Environment-Variable Reference

See `.env.example` for raw layout. The service operates on the following configuration:

| Variable Name | Required In | Purpose / Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Production | Web API URL for the Supabase instance. Falls back to LocalStorage sandbox mode if missing in Dev. |
| `VITE_SUPABASE_ANON_KEY` | Production | Client-facing anonymous authentication key for Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY`| Production | High-privilege key used server-side to execute RPC functions and perform ledger validation. |
| `GEMINI_API_KEY` | AI Proposals | Key used by the Google GenAI SDK to draft synthesis and evolution suggestions. |

---

## 5. Ledger Schema & Key Event Types

The ledger tables are fully defined in `supabase/migrations/` and include:

- `events`: The immutable append-only sequence of actions. Key fields include `id`, `event_type`, `entity_id`, `entity_type`, `actor_id`, `payload` (containing `_signature_hash`), and `witness_strength`.
- `ideas`: High-level concepts containing a reference to the `current_version_id`.
- `idea_versions`: Individual historical versions of an idea, referencing the original `artifact_id`, carrying explicit `preserved_tensions` and `unresolved_questions`.

### Core Event Types
- `artifact_created`: Initiates an artifact.
- `transformation_accepted`: Commits a harvest (evolution/cultivation).
- `path_abandoned`: Declares a sibling path disposition.

---

## 6. Verification Test Suite

The platform includes a robust boundary-test suite inside `/src/lib/test-boundary.ts`. It verifies three main assertions:
1. **Direct client insert rejection**: Direct client-side `INSERT` calls on the `events` table are completely blocked by PostgreSQL RLS.
2. **Actor authentication enforcement**: Rejects anonymous/untrusted calls.
3. **Immutability and Link Integrity**: Ensures tampering with any historical hash in the chain raises an integrity alert in the user interface.
