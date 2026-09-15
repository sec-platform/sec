# Engineering Workspace Compiler — Architecture Overview

This document is a public-facing projection of the project's current architecture. The repository retains the historical name `sec`; that name is not used here as the current project definition or acronym. This overview is intentionally smaller than the canonical design corpus under `docs/**` and does not replace those documents as design authority.

## Core idea

The system separates **engineering meaning** from the particular source files, packages, processes, and tools that realize that meaning.

The central causal chain is:

```text
Outcome / Non-goal
        ↓
Definition / Invariant
        ↓
Semantic Admission
        ↓
Responsibility / Requirement
        ↓
Decision / Exact Binding
        ↓
Admitted Operation
        ↓
Effect Observation
        ↓
Settlement / Readback
        ↓
Claim / Evidence / Verdict
        ↓
Evolution / Publication / Retirement
```

A path, type name, package, generated file, test result, process exit code, or AI response cannot become authoritative merely because it exists. Authority, identity, coverage, revision, effects, and evidence are modeled explicitly.

## Product flow

The Engineering Workspace Compiler supports two major entry paths that converge on the same downstream semantics.

### Existing software

```text
Physical workspace
      ↓
Exact observations
      ↓
Language / symbol / dependency facts
      ↓
Candidate responsibilities and semantics
      ↓
Adopt / reject / preserve unknown
```

### New or intentionally changed software

```text
Intent + constraints + contracts
              ↓
      Validated semantics
              ↓
    Responsibilities / requirements
```

Both converge into a canonical semantic closure:

```text
Canonical engineering semantics
            ↓
Implementation resolution
            ↓
Exact bindings
            ↓
Delta + impact planning
            ↓
Controlled mutation / generation
            ↓
Readback + independent verification
            ↓
Published target workspace
```

## Product domains

The current product design partitions responsibilities into six domains:

1. **Engineering Semantics** — accepted definitions, responsibilities, contracts, policies, and semantic revisions.
2. **Realization** — target selection, eligible implementation candidates, design decisions, exact implementation bindings, and target-artifact generation.
3. **Operation Runtime** — authority grants, execution bindings, resource allocations, attempts, settlement, and operation journals.
4. **Workspace Evolution** — desired/current delta, impact, pure plans, mutation, migration, cutover, rollback, recovery, and retirement.
5. **Assurance** — claims, evidence, coverage, freshness, verdicts, publication, and invalidation.
6. **Delivery and Support** — packaging, publication, deployment, support, deprecation, and withdrawal lifecycle.

These are semantic responsibility boundaries, not directory names or runtime services.

## AI boundary

AI is not intended to be a second source of engineering truth.

An AI-facing interface may:

- interpret or refine intent;
- query canonical engineering facts;
- propose bounded changes;
- explain decisions and evidence;
- invoke operations for which it has explicit authority.

It may not silently replace canonical semantics, manufacture evidence, expand its own authority, or treat generated source code as proof that the requested engineering outcome has been achieved.

## Why source code can become assembly-like

The project does not attempt to eliminate source code or existing languages.

The architectural thesis is that a sufficiently expressive, governed engineering-semantic layer can become the primary surface through which humans and AI describe and evolve systems. Conventional source code can then increasingly act as a lower-level realization format: generated or transformed where appropriate, inspected when necessary, and compiled through existing language ecosystems.

The analogy is architectural rather than literal. Source code remains substantially richer than machine assembly and may continue to be directly authored in many workflows.

## Failure is part of the model

The architecture does not collapse every unsuccessful operation into a generic error. It distinguishes outcomes such as:

- rejected requests;
- unresolved semantics or observations;
- blocked operations;
- conclusive failure;
- recovery-required states;
- verified rollback;
- verified publication.

This distinction matters because a process terminating, timing out, or losing a handle does not prove whether an external effect did or did not occur.

## Canonical design documents

For the detailed and authoritative design, see:

- `docs/product.md`
- `docs/system-architecture.md`
- `docs/implementation-architecture.md`
- `docs/semantic-model.md`
- `docs/compiler-target-ir.md`
- `docs/engineering-constitution.md`
- `docs/agent-constitution.md`
- `docs/README.md`

Public summaries should be updated from those sources rather than independently evolving a second architecture.