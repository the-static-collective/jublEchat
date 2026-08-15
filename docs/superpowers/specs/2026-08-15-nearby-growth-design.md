# Nearby Growth v0 — Evidence-Backed Discovery

**Status:** approved design

**Issue:** #3

## Problem

The current Nearby Growth panel treats every other active idea at the same taxonomy level as a `Divergent Sibling Node`. Taxonomy equality is useful organization, but it is not evidence that two ideas actually grew near one another.

PR #2 restored durable signed lineage/friction evidence. Nearby Growth can now become a projection over that evidence instead of a resemblance heuristic.

## Governing law

> **Nearby means witnessed relation, not resemblance.**

## Projection

Add a pure `deriveNearbyGrowth(...)` function over existing in-memory `Idea`, `IdeaVersion`, `Artifact`, and `Edge` records.

An active candidate qualifies only when at least one exact relationship is present:

1. **direct relation** — an existing edge connects any artifact in the selected idea lineage to any artifact in the candidate lineage;
2. **shared ancestry** — the two artifact lineages contain an exact common ancestor artifact;
3. **shared friction** — the two current versions share an exact `FrictionRef.id` in either `preserved_tensions` or `unresolved_questions`.

Matching friction text under different IDs does not qualify. Same taxonomy does not qualify.

## Candidate boundary

- selected idea is never returned;
- only `lifecycle_status === "active"` candidates are eligible in v0;
- no database writes occur;
- inputs are treated as immutable;
- result ordering is deterministic by normalized title, then idea ID;
- each result preserves the evidence classes that admitted it.

## UI

Keep the existing `Nearby Growth: Ecological Context` container and `Held Proposal Seeds` behavior.

Replace the heuristic `Divergent Sibling Nodes` subsection with `Evidenced Neighbor Nodes`.

Each neighbor shows its title and small reason badges for the evidence classes that qualified it. When none qualify, render `No evidenced nearby growth yet.` as a legitimate empty projection.

## Non-goals

- embeddings or semantic search;
- AI relationship inference;
- similarity scoring or opaque ranking;
- schema migrations or new persistence;
- changing ledger authority/signatures;
- treating abandoned historical paths as current candidate ideas;
- redesigning the surrounding provenance view.

## Falsifiers

The implementation is wrong if:

- same taxonomy alone creates a result;
- matching friction text with different IDs creates a result;
- an inactive candidate appears;
- an edge or shared ancestor in the two exact lineages is ignored;
- result order changes with input order;
- deriving results mutates the supplied records;
- Held Proposal Seeds changes behavior.
